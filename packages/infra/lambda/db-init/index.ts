import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Client } from 'pg';

const secretsClient = new SecretsManagerClient({});

const AURORA_SECRET_ARN = process.env.AURORA_SECRET_ARN!;
const AURORA_ENDPOINT = process.env.AURORA_ENDPOINT!;
const AURORA_DATABASE = process.env.AURORA_DATABASE || 'fable';

interface DbCredentials {
  username: string;
  password: string;
}

async function getCredentials(): Promise<DbCredentials> {
  const response = await secretsClient.send(new GetSecretValueCommand({
    SecretId: AURORA_SECRET_ARN,
  }));
  return JSON.parse(response.SecretString!);
}

const SCHEMA_SQL = `
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Memory types enum
DO $$ BEGIN
  CREATE TYPE memory_type AS ENUM (
    'insight', 'gotcha', 'preference', 'pattern', 'capability', 'status'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Memory scope enum
DO $$ BEGIN
  CREATE TYPE memory_scope AS ENUM ('user', 'org', 'global');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Memory source enum
DO $$ BEGIN
  CREATE TYPE memory_source AS ENUM ('user_stated', 'ai_corrected', 'ai_inferred');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Main memories table
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type memory_type NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),  -- For semantic search (Titan embedding size)

  -- Ownership
  user_id UUID REFERENCES users(id),
  org_id UUID REFERENCES organizations(id),
  scope memory_scope NOT NULL DEFAULT 'user',

  -- Metadata
  source memory_source NOT NULL DEFAULT 'ai_inferred',
  importance DECIMAL(3,2) DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  pinned BOOLEAN DEFAULT false,
  tags TEXT[],
  context JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  accessed_at TIMESTAMPTZ DEFAULT NOW(),

  -- Supersession
  superseded_by UUID REFERENCES memories(id),
  supersedes UUID REFERENCES memories(id)
);

-- Memory relations table
CREATE TABLE IF NOT EXISTS memory_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  to_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relation_type VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_memory_id, to_memory_id, relation_type)
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memories_org ON memories(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING GIN(tags);

-- Create vector index (IVFFlat) - only if table has data, otherwise skip
-- We'll create this after first embeddings are inserted
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_memories_embedding') THEN
    -- Create a basic index, IVFFlat requires training data
    CREATE INDEX idx_memories_embedding ON memories USING hnsw (embedding vector_cosine_ops);
  END IF;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Could not create vector index: %', SQLERRM;
END $$;

-- Semantic search function
CREATE OR REPLACE FUNCTION search_memories(
  p_query_embedding vector(1536),
  p_user_id UUID,
  p_org_id UUID,
  p_scopes memory_scope[],
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  type memory_type,
  content TEXT,
  scope memory_scope,
  importance DECIMAL(3,2),
  similarity FLOAT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.type,
    m.content,
    m.scope,
    m.importance,
    1 - (m.embedding <=> p_query_embedding) as similarity,
    m.created_at
  FROM memories m
  WHERE
    m.superseded_by IS NULL
    AND m.scope = ANY(p_scopes)
    AND m.embedding IS NOT NULL
    AND (
      (m.scope = 'user' AND m.user_id = p_user_id)
      OR (m.scope = 'org' AND m.org_id = p_org_id)
      OR (m.scope = 'global')
    )
  ORDER BY
    CASE m.scope
      WHEN 'user' THEN 1
      WHEN 'org' THEN 2
      WHEN 'global' THEN 3
    END,
    (1 - (m.embedding <=> p_query_embedding)) * m.importance DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Memory decay function (run periodically)
CREATE OR REPLACE FUNCTION decay_memories()
RETURNS INT AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE memories
  SET importance = GREATEST(0.1, importance * 0.95)
  WHERE
    pinned = false
    AND accessed_at < NOW() - INTERVAL '30 days'
    AND type IN ('status', 'insight');

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;

-- Insert default organization for development
INSERT INTO organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization')
ON CONFLICT DO NOTHING;

-- Insert default user for development
INSERT INTO users (id, org_id, email)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'anonymous@fable.dev')
ON CONFLICT DO NOTHING;
`;

export const handler = async (event: { action?: string }): Promise<{ statusCode: number; body: string }> => {
  console.log('DB Init Lambda invoked', event);

  const credentials = await getCredentials();

  const client = new Client({
    host: AURORA_ENDPOINT,
    port: 5432,
    database: AURORA_DATABASE,
    user: credentials.username,
    password: credentials.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to Aurora');

    if (event.action === 'check') {
      // Just check connection and return table info
      const result = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Connection successful',
          tables: result.rows.map(r => r.table_name),
        }),
      };
    }

    // Run schema initialization
    console.log('Running schema initialization...');
    await client.query(SCHEMA_SQL);
    console.log('Schema initialized successfully');

    // Verify tables were created
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Schema initialized successfully',
        tables: result.rows.map(r => r.table_name),
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error initializing schema',
        error: String(error),
      }),
    };
  } finally {
    await client.end();
  }
};
