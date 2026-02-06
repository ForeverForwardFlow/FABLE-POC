/**
 * FABLE Shared Types
 *
 * Memory system types based on design decisions in memory-system-design.md
 */

import { z } from 'zod';

// ============================================================================
// Memory Types
// ============================================================================

/**
 * Memory type determines behavior (anchored vs decaying) and default scope
 */
export const MemoryType = z.enum([
  'insight',     // Why a decision was made (anchored, project scope)
  'gotcha',      // What went wrong, how to avoid (decaying, project scope)
  'preference',  // How user/org likes things done (anchored, private scope)
  'pattern',     // Successful approach to problem type (decaying, global scope)
  'capability',  // Built tool/server - FABLE specific (anchored, global scope)
  'status',      // Where we left off, current state (decaying, project scope)
]);
export type MemoryType = z.infer<typeof MemoryType>;

/**
 * Types that don't decay over time
 */
export const ANCHORED_TYPES: MemoryType[] = ['insight', 'preference', 'capability'];

/**
 * Types that decay (lower ranking over time if not accessed)
 */
export const DECAYING_TYPES: MemoryType[] = ['status', 'gotcha', 'pattern'];

// ============================================================================
// Scope
// ============================================================================

/**
 * Scope determines who can see the memory
 */
export const MemoryScope = z.enum([
  'private',  // Only owner (personal preferences)
  'project',  // Anyone with repo access (architecture decisions)
  'global',   // Cross-project (general patterns, capabilities)
]);
export type MemoryScope = z.infer<typeof MemoryScope>;

/**
 * Default scope by memory type
 */
export const DEFAULT_SCOPE: Record<MemoryType, MemoryScope> = {
  insight: 'project',
  gotcha: 'project',
  preference: 'private',
  pattern: 'global',
  capability: 'global',
  status: 'project',
};

// ============================================================================
// Source
// ============================================================================

/**
 * Source indicates where the memory came from (affects conflict resolution)
 * Higher in list = higher authority
 */
export const MemorySource = z.enum([
  'user_stated',   // User explicitly said this
  'ai_corrected',  // AI updated after user correction
  'ai_inferred',   // AI learned/inferred this
]);
export type MemorySource = z.infer<typeof MemorySource>;

/**
 * Source priority for conflict resolution (higher = more authoritative)
 */
export const SOURCE_PRIORITY: Record<MemorySource, number> = {
  user_stated: 3,
  ai_corrected: 2,
  ai_inferred: 1,
};

// ============================================================================
// Relationships
// ============================================================================

/**
 * Relationship types for knowledge graph edges
 */
export const RelationType = z.enum([
  'supersedes',   // New memory replaces old understanding
  'relates_to',   // Connected concepts
  'caused_by',    // This gotcha caused by that decision
  'fixed_by',     // This problem solved by that pattern
  'implements',   // This capability implements that pattern
]);
export type RelationType = z.infer<typeof RelationType>;

// ============================================================================
// Memory Schema
// ============================================================================

/**
 * Core memory record
 */
export const Memory = z.object({
  id: z.string().uuid(),
  type: MemoryType,
  scope: MemoryScope,
  source: MemorySource,

  // Content
  content: z.string().min(1),
  context: z.string().optional(),  // Additional context (e.g., file path, project)
  tags: z.array(z.string()).default([]),

  // Metadata
  project: z.string().optional(),  // Project identifier for project-scoped memories
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  accessedAt: z.string().datetime(),
  accessCount: z.number().int().min(0).default(0),

  // Importance/decay
  importance: z.number().min(0).max(1).default(0.5),
  pinned: z.boolean().default(false),  // Pinned memories never decay

  // Embedding for semantic search (stored separately but referenced here)
  embeddingId: z.string().optional(),
});
export type Memory = z.infer<typeof Memory>;

/**
 * Memory relationship (edge in knowledge graph)
 */
export const MemoryRelation = z.object({
  id: z.string().uuid(),
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  type: RelationType,
  createdAt: z.string().datetime(),
});
export type MemoryRelation = z.infer<typeof MemoryRelation>;

// ============================================================================
// Search & Query
// ============================================================================

/**
 * Search options for memory retrieval
 */
export const MemorySearchOptions = z.object({
  query: z.string().min(1),
  types: z.array(MemoryType).optional(),
  scopes: z.array(MemoryScope).optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).default(10),
  minImportance: z.number().min(0).max(1).optional(),
  includeSuperseded: z.boolean().default(false),
});
export type MemorySearchOptions = z.infer<typeof MemorySearchOptions>;

/**
 * Search result with relevance score
 */
export const MemorySearchResult = z.object({
  memory: Memory,
  score: z.number().min(0).max(1),
  supersededBy: z.string().uuid().optional(),
});
export type MemorySearchResult = z.infer<typeof MemorySearchResult>;

// ============================================================================
// Create/Update Operations
// ============================================================================

/**
 * Input for creating a new memory
 */
export const CreateMemoryInput = z.object({
  type: MemoryType,
  content: z.string().min(1),
  context: z.string().optional(),
  tags: z.array(z.string()).optional(),
  project: z.string().optional(),
  scope: MemoryScope.optional(),  // Defaults based on type
  source: MemorySource.default('ai_inferred'),
  importance: z.number().min(0).max(1).optional(),
  pinned: z.boolean().optional(),
  supersedes: z.string().uuid().optional(),  // ID of memory this supersedes
});
export type CreateMemoryInput = z.infer<typeof CreateMemoryInput>;

/**
 * Input for relating two memories
 */
export const RelateMemoriesInput = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  type: RelationType,
});
export type RelateMemoriesInput = z.infer<typeof RelateMemoriesInput>;
