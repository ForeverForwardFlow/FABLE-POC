/**
 * SQLite Storage Layer for Memory Server
 *
 * Handles persistent storage of memories, relationships, and embeddings.
 */

import Database from 'better-sqlite3';
import { Memory, MemoryRelation, MemorySearchResult, ANCHORED_TYPES } from '@fable/shared';
import { generateId, now } from '@fable/shared';

export interface StorageConfig {
  dbPath: string;
  decayRate?: number;  // How much importance decays per day for non-anchored types
}

export class MemoryStorage {
  private db: Database.Database;
  private decayRate: number;

  constructor(config: StorageConfig) {
    this.db = new Database(config.dbPath);
    this.decayRate = config.decayRate ?? 0.01;  // 1% per day default
    this.initialize();
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    this.db.exec(`
      -- Memories table
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        scope TEXT NOT NULL,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        context TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        project TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        importance REAL NOT NULL DEFAULT 0.5,
        pinned INTEGER NOT NULL DEFAULT 0,
        embedding_id TEXT
      );

      -- Embeddings table (vectors stored as JSON array)
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL UNIQUE,
        vector TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      -- Relations table (knowledge graph edges)
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (from_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (to_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
      CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
      CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(type);
    `);
  }

  /**
   * Create a new memory
   */
  createMemory(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessedAt' | 'accessCount'>): Memory {
    const id = generateId();
    const timestamp = now();

    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, type, scope, source, content, context, tags, project,
        created_at, updated_at, accessed_at, access_count, importance, pinned
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      memory.type,
      memory.scope,
      memory.source,
      memory.content,
      memory.context ?? null,
      JSON.stringify(memory.tags ?? []),
      memory.project ?? null,
      timestamp,
      timestamp,
      timestamp,
      0,
      memory.importance ?? 0.5,
      memory.pinned ? 1 : 0
    );

    return {
      ...memory,
      id,
      tags: memory.tags ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
      accessedAt: timestamp,
      accessCount: 0,
      importance: memory.importance ?? 0.5,
      pinned: memory.pinned ?? false,
    };
  }

  /**
   * Get a memory by ID
   */
  getMemory(id: string): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
    return row ? this.rowToMemory(row) : null;
  }

  /**
   * Update a memory's access timestamp and count
   */
  recordAccess(id: string): void {
    this.db.prepare(`
      UPDATE memories
      SET accessed_at = ?, access_count = access_count + 1
      WHERE id = ?
    `).run(now(), id);
  }

  /**
   * Boost a memory's importance
   */
  boostImportance(id: string, amount: number = 0.1): void {
    this.db.prepare(`
      UPDATE memories
      SET importance = MIN(1.0, importance + ?)
      WHERE id = ?
    `).run(amount, id);
  }

  /**
   * Pin/unpin a memory
   */
  setPinned(id: string, pinned: boolean): void {
    this.db.prepare('UPDATE memories SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  }

  /**
   * Delete a memory
   */
  deleteMemory(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Store embedding for a memory
   */
  storeEmbedding(memoryId: string, vector: number[], model: string): string {
    const id = generateId();
    this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (id, memory_id, vector, model, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, memoryId, JSON.stringify(vector), model, now());

    this.db.prepare('UPDATE memories SET embedding_id = ? WHERE id = ?').run(id, memoryId);
    return id;
  }

  /**
   * Get embedding for a memory
   */
  getEmbedding(memoryId: string): number[] | null {
    const row = this.db.prepare('SELECT vector FROM embeddings WHERE memory_id = ?').get(memoryId) as { vector: string } | undefined;
    return row ? JSON.parse(row.vector) : null;
  }

  /**
   * Get all embeddings for similarity search
   */
  getAllEmbeddings(): Array<{ memoryId: string; vector: number[] }> {
    const rows = this.db.prepare('SELECT memory_id, vector FROM embeddings').all() as Array<{ memory_id: string; vector: string }>;
    return rows.map(row => ({
      memoryId: row.memory_id,
      vector: JSON.parse(row.vector),
    }));
  }

  /**
   * Create a relation between two memories
   */
  createRelation(fromId: string, toId: string, type: string): MemoryRelation {
    const id = generateId();
    const timestamp = now();

    this.db.prepare(`
      INSERT INTO relations (id, from_id, to_id, type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, fromId, toId, type, timestamp);

    return { id, fromId, toId, type: type as MemoryRelation['type'], createdAt: timestamp };
  }

  /**
   * Check if a memory is superseded
   */
  getSupersededBy(memoryId: string): string | null {
    const row = this.db.prepare(`
      SELECT from_id FROM relations
      WHERE to_id = ? AND type = 'supersedes'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(memoryId) as { from_id: string } | undefined;
    return row?.from_id ?? null;
  }

  /**
   * Get relations for a memory
   */
  getRelations(memoryId: string): MemoryRelation[] {
    const rows = this.db.prepare(`
      SELECT * FROM relations WHERE from_id = ? OR to_id = ?
    `).all(memoryId, memoryId) as RelationRow[];
    return rows.map(this.rowToRelation);
  }

  /**
   * Search memories by criteria (without semantic search)
   */
  searchMemories(options: {
    types?: string[];
    scopes?: string[];
    project?: string;
    tags?: string[];
    limit?: number;
    includeSuperseded?: boolean;
  }): Memory[] {
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params: unknown[] = [];

    if (options.types?.length) {
      sql += ` AND type IN (${options.types.map(() => '?').join(',')})`;
      params.push(...options.types);
    }

    if (options.scopes?.length) {
      sql += ` AND scope IN (${options.scopes.map(() => '?').join(',')})`;
      params.push(...options.scopes);
    }

    if (options.project) {
      sql += ' AND (project = ? OR scope = ?)';
      params.push(options.project, 'global');
    }

    // Order by importance (with decay for non-anchored) and recency
    sql += ' ORDER BY importance DESC, updated_at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as MemoryRow[];
    let memories = rows.map(row => this.rowToMemory(row));

    // Filter superseded if requested
    if (!options.includeSuperseded) {
      const supersededIds = new Set(
        memories
          .map(m => this.getSupersededBy(m.id))
          .filter((id): id is string => id !== null)
      );
      memories = memories.filter(m => !supersededIds.has(m.id));
    }

    return memories;
  }

  /**
   * Get recent memories (for session start)
   */
  getRecentMemories(limit: number = 10, project?: string): Memory[] {
    let sql = `
      SELECT * FROM memories
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (project) {
      sql += ' AND (project = ? OR scope = ?)';
      params.push(project, 'global');
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map(row => this.rowToMemory(row));
  }

  /**
   * Apply decay to non-anchored memories
   */
  applyDecay(): number {
    const result = this.db.prepare(`
      UPDATE memories
      SET importance = MAX(0.1, importance - ?)
      WHERE pinned = 0
        AND type NOT IN (${ANCHORED_TYPES.map(() => '?').join(',')})
        AND importance > 0.1
    `).run(this.decayRate, ...ANCHORED_TYPES);
    return result.changes;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      type: row.type as Memory['type'],
      scope: row.scope as Memory['scope'],
      source: row.source as Memory['source'],
      content: row.content,
      context: row.context ?? undefined,
      tags: JSON.parse(row.tags),
      project: row.project ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count,
      importance: row.importance,
      pinned: row.pinned === 1,
      embeddingId: row.embedding_id ?? undefined,
    };
  }

  private rowToRelation(row: RelationRow): MemoryRelation {
    return {
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      type: row.type as MemoryRelation['type'],
      createdAt: row.created_at,
    };
  }
}

// Row types for SQLite results
interface MemoryRow {
  id: string;
  type: string;
  scope: string;
  source: string;
  content: string;
  context: string | null;
  tags: string;
  project: string | null;
  created_at: string;
  updated_at: string;
  accessed_at: string;
  access_count: number;
  importance: number;
  pinned: number;
  embedding_id: string | null;
}

interface RelationRow {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  created_at: string;
}
