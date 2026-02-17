import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client, Pool } from 'pg';

const secretsClient = new SecretsManagerClient({});
const bedrockClient = new BedrockRuntimeClient({ region: 'us-west-2' });

const AURORA_SECRET_ARN = process.env.AURORA_SECRET_ARN!;
const AURORA_ENDPOINT = process.env.AURORA_ENDPOINT!;
const AURORA_DATABASE = process.env.AURORA_DATABASE || 'fable';

// Connection pool for reuse across invocations
let pool: Pool | null = null;

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

async function getPool(): Promise<Pool> {
  if (!pool) {
    const credentials = await getCredentials();
    pool = new Pool({
      host: AURORA_ENDPOINT,
      port: 5432,
      database: AURORA_DATABASE,
      user: credentials.username,
      password: credentials.password,
      ssl: { rejectUnauthorized: false }, // Aurora is in private VPC, CA cert not bundled in Lambda runtime
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

// Generate embedding using Bedrock Titan
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await bedrockClient.send(new InvokeModelCommand({
    modelId: 'amazon.titan-embed-text-v1',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      inputText: text,
    }),
  }));

  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}

// Memory types
export interface Memory {
  id: string;
  type: 'insight' | 'gotcha' | 'preference' | 'pattern' | 'capability' | 'status';
  content: string;
  scope: 'user' | 'org' | 'global';
  source: 'user_stated' | 'ai_corrected' | 'ai_inferred';
  importance: number;
  pinned: boolean;
  tags: string[];
  context?: Record<string, unknown>;
  userId?: string;
  orgId?: string;
  createdAt: string;
  similarity?: number;
}

export interface CreateMemoryInput {
  type: Memory['type'];
  content: string;
  scope?: Memory['scope'];
  source?: Memory['source'];
  importance?: number;
  pinned?: boolean;
  tags?: string[];
  context?: Record<string, unknown>;
  userId?: string;
  orgId?: string;
}

export interface SearchMemoriesInput {
  query: string;
  userId?: string;
  orgId?: string;
  scopes?: Memory['scope'][];
  types?: Memory['type'][];
  limit?: number;
}

// Event types
interface MemoryEvent {
  action: 'create' | 'search' | 'list' | 'get' | 'update' | 'delete' | 'boost' | 'relate' | 'session_start' | 'pin' | 'decay';
  payload: unknown;
}

interface McpRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
}

interface FunctionUrlEvent {
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string>;
}

// Check if event is an MCP JSON-RPC request
function isMcpRequest(event: unknown): event is McpRequest {
  return typeof event === 'object' && event !== null && 'jsonrpc' in event && (event as McpRequest).jsonrpc === '2.0';
}

// Check if event is from Lambda Function URL
function isFunctionUrlEvent(event: unknown): event is FunctionUrlEvent {
  return typeof event === 'object' && event !== null && 'body' in event;
}

// Map MCP method names to internal actions
const mcpMethodMap: Record<string, string> = {
  // Direct method names
  'memory_create': 'create',
  'memory_search': 'search',
  'memory_session_start': 'session_start',
  'memory_boost': 'boost',
  'memory_pin': 'pin',
  'memory_relate': 'relate',
  'memory_list': 'list',
  'memory_get': 'get',
  // Simplified names (after prefix stripping)
  'create': 'create',
  'search': 'search',
  'session_start': 'session_start',
  'boost': 'boost',
  'pin': 'pin',
  'relate': 'relate',
  'list': 'list',
  'get': 'get',
  // MCP protocol methods
  'tools/call': 'mcp_tool_call',
  'tools/list': 'mcp_tools_list',
  'initialize': 'mcp_initialize',
};

// MCP tool definitions for discovery
const mcpTools = [
  {
    name: 'mcp__memory__memory_create',
    description: 'Create a new persistent memory. Use this to capture insights, gotchas, preferences, patterns, capabilities, or status.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['insight', 'gotcha', 'preference', 'pattern', 'capability', 'status'], description: 'Type of memory' },
        content: { type: 'string', description: 'The memory content - what should be remembered' },
        scope: { type: 'string', enum: ['private', 'project', 'global'], description: 'Visibility scope' },
        source: { type: 'string', enum: ['user_stated', 'ai_corrected', 'ai_inferred'], description: 'Source of memory' },
        importance: { type: 'number', minimum: 0, maximum: 1, description: 'Initial importance (0-1)' },
        pinned: { type: 'boolean', description: 'Pin memory to prevent decay' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        context: { type: 'object', description: 'Additional context' },
        project: { type: 'string', description: 'Project identifier' },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'mcp__memory__memory_search',
    description: 'Search for relevant memories using semantic similarity and keyword matching.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query - describe what you are looking for' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum results' },
        types: { type: 'array', items: { type: 'string' }, description: 'Filter by memory types' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        project: { type: 'string', description: 'Filter by project' },
      },
      required: ['query'],
    },
  },
  {
    name: 'mcp__memory__memory_session_start',
    description: 'Retrieve relevant context at the start of a session. Returns prioritized memories.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Current project identifier' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum memories to retrieve' },
      },
    },
  },
  {
    name: 'mcp__memory__memory_boost',
    description: 'Increase a memory\'s importance score when it proves useful.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', description: 'ID of the memory to boost' },
        amount: { type: 'number', minimum: 0.01, maximum: 0.5, description: 'Boost amount' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mcp__memory__memory_pin',
    description: 'Pin or unpin a memory. Pinned memories never decay.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', description: 'ID of the memory to pin/unpin' },
        pinned: { type: 'boolean', description: 'Pin state' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mcp__memory__memory_relate',
    description: 'Create a relationship between two memories.',
    inputSchema: {
      type: 'object',
      properties: {
        fromId: { type: 'string', format: 'uuid', description: 'ID of the source memory' },
        toId: { type: 'string', format: 'uuid', description: 'ID of the target memory' },
        type: { type: 'string', enum: ['supersedes', 'relates_to', 'caused_by', 'fixed_by', 'implements'], description: 'Relationship type' },
      },
      required: ['fromId', 'toId', 'type'],
    },
  },
];

export const handler = async (event: unknown): Promise<{ statusCode: number; body: string; headers?: Record<string, string> }> => {
  console.log('Memory Lambda invoked:', JSON.stringify(event).substring(0, 500));

  const db = await getPool();

  try {
    let action: string;
    let payload: unknown;
    let mcpId: string | number | undefined;
    let isMcp = false;

    // Handle Function URL events (body is JSON string)
    let parsedEvent = event;
    if (isFunctionUrlEvent(event) && event.body) {
      try {
        parsedEvent = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid JSON body' }),
          headers: { 'Content-Type': 'application/json' },
        };
      }
    }

    // Handle MCP JSON-RPC format
    if (isMcpRequest(parsedEvent)) {
      isMcp = true;
      mcpId = parsedEvent.id;
      const method = parsedEvent.method;

      // Handle MCP tools/call format
      if (method === 'tools/call' && parsedEvent.params) {
        const toolName = (parsedEvent.params as { name?: string }).name || '';
        // Strip prefixes: mcp__memory__memory_create -> create
        const normalizedName = toolName.replace('mcp__memory__', '').replace('memory_', '');
        action = mcpMethodMap[normalizedName] || normalizedName;
        payload = (parsedEvent.params as { arguments?: unknown }).arguments || {};
      } else {
        action = mcpMethodMap[method] || method.replace('memory_', '');
        payload = parsedEvent.params || {};
      }
    } else {
      // Handle direct Lambda invocation format
      const memEvent = parsedEvent as MemoryEvent;
      action = memEvent.action;
      payload = memEvent.payload;
    }

    console.log('Processing action:', action);

    let result: { statusCode: number; body: string };

    switch (action) {
      case 'create':
        result = await createMemory(db, payload as CreateMemoryInput);
        break;

      case 'search':
        result = await searchMemories(db, payload as SearchMemoriesInput);
        break;

      case 'session_start':
        result = await sessionStart(db, payload as { project?: string; limit?: number });
        break;

      case 'list':
        result = await listMemories(db, payload as { userId?: string; orgId?: string; limit?: number });
        break;

      case 'get':
        result = await getMemory(db, payload as { id: string });
        break;

      case 'boost':
        result = await boostMemory(db, payload as { id: string; amount?: number });
        break;

      case 'pin':
        result = await pinMemory(db, payload as { id: string; pinned?: boolean });
        break;

      case 'relate':
        result = await relateMemories(db, payload as { fromId: string; toId: string; type: string });
        break;

      case 'decay':
        result = await decayMemories(db);
        break;

      // MCP Protocol handlers
      case 'mcp_initialize':
        result = {
          statusCode: 200,
          body: JSON.stringify({
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'fable-memory', version: '1.0.0' },
          }),
        };
        break;

      case 'mcp_tools_list':
        result = {
          statusCode: 200,
          body: JSON.stringify({ tools: mcpTools }),
        };
        break;

      default:
        result = { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
    }

    // Wrap response in MCP format if needed
    if (isMcp) {
      const parsed = JSON.parse(result.body);
      if (result.statusCode === 200) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: mcpId,
            result: parsed,
          }),
        };
      } else {
        return {
          statusCode: result.statusCode,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: mcpId,
            error: { code: -32000, message: parsed.error || 'Unknown error' },
          }),
        };
      }
    }

    return { ...result, headers: { 'Content-Type': 'application/json' } };
  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }), headers: { 'Content-Type': 'application/json' } };
  }
};

// Map tool-facing scope values to database enum values
function mapScopeToDb(scope: string | undefined): 'user' | 'org' | 'global' {
  if (!scope) return 'user';
  const scopeMap: Record<string, 'user' | 'org' | 'global'> = {
    'private': 'user',
    'user': 'user',
    'project': 'org',
    'org': 'org',
    'global': 'global',
  };
  return scopeMap[scope] || 'user';
}

async function createMemory(db: Pool, input: CreateMemoryInput): Promise<{ statusCode: number; body: string }> {
  // Generate embedding for the content
  const embedding = await generateEmbedding(input.content);

  const result = await db.query(`
    INSERT INTO memories (
      type, content, embedding, scope, source, importance, pinned, tags, context, user_id, org_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
    )
    RETURNING id, type, content, scope, source, importance, pinned, tags, context, user_id, org_id, created_at
  `, [
    input.type,
    input.content,
    `[${embedding.join(',')}]`,
    mapScopeToDb(input.scope),
    input.source || 'ai_inferred',
    input.importance || 0.5,
    input.pinned || false,
    input.tags || [],
    input.context ? JSON.stringify(input.context) : null,
    input.userId || '00000000-0000-0000-0000-000000000001',
    input.orgId || '00000000-0000-0000-0000-000000000001',
  ]);

  const memory = result.rows[0];
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      memory: formatMemory(memory),
    }),
  };
}

async function searchMemories(db: Pool, input: SearchMemoriesInput): Promise<{ statusCode: number; body: string }> {
  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(input.query);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  const rawScopes = input.scopes || ['user', 'org', 'global'];
  const scopes = rawScopes.map(s => mapScopeToDb(s));
  const limit = input.limit || 10;
  const userId = input.userId || '00000000-0000-0000-0000-000000000001';
  const orgId = input.orgId || '00000000-0000-0000-0000-000000000001';

  // Use the search function we created
  const result = await db.query(`
    SELECT * FROM search_memories($1::vector, $2::uuid, $3::uuid, $4::memory_scope[], $5)
  `, [embeddingStr, userId, orgId, scopes, limit]);

  const memories = result.rows.map(row => ({
    id: row.id,
    type: row.type,
    content: row.content,
    scope: row.scope,
    importance: parseFloat(row.importance),
    similarity: row.similarity,
    createdAt: row.created_at,
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      query: input.query,
      memories,
    }),
  };
}

async function listMemories(db: Pool, input: { userId?: string; orgId?: string; limit?: number }): Promise<{ statusCode: number; body: string }> {
  const userId = input.userId || '00000000-0000-0000-0000-000000000001';
  const orgId = input.orgId || '00000000-0000-0000-0000-000000000001';
  const limit = input.limit || 50;

  const result = await db.query(`
    SELECT id, type, content, scope, source, importance, pinned, tags, context, user_id, org_id, created_at
    FROM memories
    WHERE superseded_by IS NULL
      AND (user_id = $1 OR org_id = $2 OR scope = 'global')
    ORDER BY created_at DESC
    LIMIT $3
  `, [userId, orgId, limit]);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      memories: result.rows.map(formatMemory),
    }),
  };
}

async function getMemory(db: Pool, input: { id: string }): Promise<{ statusCode: number; body: string }> {
  const result = await db.query(`
    SELECT id, type, content, scope, source, importance, pinned, tags, context, user_id, org_id, created_at
    FROM memories
    WHERE id = $1
  `, [input.id]);

  if (result.rows.length === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Memory not found' }) };
  }

  // Update accessed_at
  await db.query('UPDATE memories SET accessed_at = NOW() WHERE id = $1', [input.id]);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      memory: formatMemory(result.rows[0]),
    }),
  };
}

async function boostMemory(db: Pool, input: { id: string; amount?: number }): Promise<{ statusCode: number; body: string }> {
  const amount = input.amount || 0.1;

  const result = await db.query(`
    UPDATE memories
    SET importance = LEAST(1.0, importance + $2), updated_at = NOW()
    WHERE id = $1
    RETURNING id, importance
  `, [input.id, amount]);

  if (result.rows.length === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Memory not found' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      id: result.rows[0].id,
      importance: parseFloat(result.rows[0].importance),
    }),
  };
}

async function relateMemories(db: Pool, input: { fromId: string; toId: string; type: string }): Promise<{ statusCode: number; body: string }> {
  await db.query(`
    INSERT INTO memory_relations (from_memory_id, to_memory_id, relation_type)
    VALUES ($1, $2, $3)
    ON CONFLICT (from_memory_id, to_memory_id, relation_type) DO NOTHING
  `, [input.fromId, input.toId, input.type]);

  // If supersedes relation, mark old memory
  if (input.type === 'supersedes') {
    await db.query('UPDATE memories SET superseded_by = $1 WHERE id = $2', [input.fromId, input.toId]);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
}

async function sessionStart(db: Pool, input: { project?: string; limit?: number }): Promise<{ statusCode: number; body: string }> {
  const limit = input.limit || 10;
  const project = input.project;

  // Query for relevant memories at session start
  // Prioritize by type (status first, then gotchas, then patterns) and importance
  let query = `
    SELECT id, type, content, scope, importance, pinned, tags, created_at
    FROM memories
    WHERE superseded_by IS NULL
  `;
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (project) {
    query += ` AND (scope = 'global' OR (context->>'project' = $${paramIndex}))`;
    params.push(project);
    paramIndex++;
  }

  query += `
    ORDER BY
      CASE type
        WHEN 'status' THEN 1
        WHEN 'gotcha' THEN 2
        WHEN 'pattern' THEN 3
        WHEN 'preference' THEN 4
        WHEN 'capability' THEN 5
        ELSE 6
      END,
      pinned DESC,
      importance DESC,
      created_at DESC
    LIMIT $${paramIndex}
  `;
  params.push(limit);

  const result = await db.query(query, params);

  const memories = result.rows.map(row => ({
    id: row.id,
    type: row.type,
    content: row.content,
    scope: row.scope,
    importance: parseFloat(row.importance),
    pinned: row.pinned,
    tags: row.tags,
    createdAt: row.created_at,
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      project: project || 'global',
      memories,
    }),
  };
}

async function pinMemory(db: Pool, input: { id: string; pinned?: boolean }): Promise<{ statusCode: number; body: string }> {
  const pinned = input.pinned !== false; // Default to true

  const result = await db.query(`
    UPDATE memories
    SET pinned = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING id, pinned
  `, [input.id, pinned]);

  if (result.rows.length === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Memory not found' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      id: result.rows[0].id,
      pinned: result.rows[0].pinned,
    }),
  };
}

async function decayMemories(db: Pool): Promise<{ statusCode: number; body: string }> {
  const result = await db.query(`SELECT decay_memories() AS affected`);
  const affected = result.rows[0]?.affected || 0;
  console.log(`Memory decay: ${affected} memories decayed`);
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, affected }),
  };
}

function formatMemory(row: Record<string, unknown>): Memory {
  return {
    id: row.id as string,
    type: row.type as Memory['type'],
    content: row.content as string,
    scope: row.scope as Memory['scope'],
    source: row.source as Memory['source'],
    importance: parseFloat(row.importance as string),
    pinned: row.pinned as boolean,
    tags: row.tags as string[],
    context: row.context as Record<string, unknown>,
    userId: row.user_id as string,
    orgId: row.org_id as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}
