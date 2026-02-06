/**
 * Memory Service
 *
 * High-level interface combining storage and embeddings.
 */

import { MemoryStorage, StorageConfig } from './storage.js';
import { EmbeddingsService, EmbeddingsConfig, keywordSimilarity } from './embeddings.js';
import {
  Memory,
  MemoryRelation,
  MemorySearchResult,
  CreateMemoryInput,
  MemorySearchOptions,
  DEFAULT_SCOPE,
  SOURCE_PRIORITY,
} from '@fable/shared';

export interface MemoryServiceConfig {
  storage: StorageConfig;
  embeddings?: EmbeddingsConfig;
}

export class MemoryService {
  private storage: MemoryStorage;
  private embeddings: EmbeddingsService;

  constructor(config: MemoryServiceConfig) {
    this.storage = new MemoryStorage(config.storage);
    this.embeddings = new EmbeddingsService(config.embeddings);
  }

  /**
   * Create a new memory with optional embedding
   */
  async createMemory(input: CreateMemoryInput): Promise<Memory> {
    // Apply default scope based on type
    const scope = input.scope ?? DEFAULT_SCOPE[input.type];

    const memory = this.storage.createMemory({
      type: input.type,
      scope,
      source: input.source ?? 'ai_inferred',
      content: input.content,
      context: input.context,
      tags: input.tags ?? [],
      project: input.project,
      importance: input.importance ?? 0.5,
      pinned: input.pinned ?? false,
    });

    // Generate embedding if available
    if (this.embeddings.isAvailable()) {
      try {
        const vector = await this.embeddings.embed(memory.content);
        this.storage.storeEmbedding(memory.id, vector, this.embeddings.getModel());
      } catch (error) {
        console.error('Failed to generate embedding:', error);
      }
    }

    // Handle supersession
    if (input.supersedes) {
      this.storage.createRelation(memory.id, input.supersedes, 'supersedes');
    }

    return memory;
  }

  /**
   * Search memories with semantic and keyword matching
   */
  async searchMemories(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const candidates = this.storage.searchMemories({
      types: options.types,
      scopes: options.scopes,
      project: options.project,
      tags: options.tags,
      limit: options.limit * 3,  // Get more candidates for re-ranking
      includeSuperseded: options.includeSuperseded,
    });

    // Score candidates
    let scored: MemorySearchResult[];

    if (this.embeddings.isAvailable()) {
      // Semantic search
      try {
        const queryVector = await this.embeddings.embed(options.query);
        const allEmbeddings = this.storage.getAllEmbeddings();

        const embeddingMap = new Map(allEmbeddings.map(e => [e.memoryId, e.vector]));

        scored = candidates.map(memory => {
          const vector = embeddingMap.get(memory.id);
          const semanticScore = vector
            ? this.embeddings.cosineSimilarity(queryVector, vector)
            : 0;
          const keywordScore = keywordSimilarity(options.query, memory.content);

          // Combine scores (weight semantic higher)
          const score = semanticScore * 0.7 + keywordScore * 0.3;

          // Apply importance weighting
          const adjustedScore = score * (0.5 + memory.importance * 0.5);

          return {
            memory,
            score: adjustedScore,
            supersededBy: this.storage.getSupersededBy(memory.id) ?? undefined,
          };
        });
      } catch (error) {
        console.error('Semantic search failed, falling back to keyword:', error);
        scored = this.keywordOnlySearch(candidates, options.query);
      }
    } else {
      // Keyword-only search
      scored = this.keywordOnlySearch(candidates, options.query);
    }

    // Sort by score and limit
    scored.sort((a, b) => b.score - a.score);

    // Filter by minimum importance if specified
    if (options.minImportance !== undefined) {
      scored = scored.filter(r => r.memory.importance >= options.minImportance!);
    }

    // Record access for returned memories
    const results = scored.slice(0, options.limit);
    for (const result of results) {
      this.storage.recordAccess(result.memory.id);
    }

    return results;
  }

  /**
   * Get memory by ID
   */
  getMemory(id: string): Memory | null {
    const memory = this.storage.getMemory(id);
    if (memory) {
      this.storage.recordAccess(id);
    }
    return memory;
  }

  /**
   * Create relation between memories
   */
  createRelation(fromId: string, toId: string, type: MemoryRelation['type']): MemoryRelation {
    return this.storage.createRelation(fromId, toId, type);
  }

  /**
   * Get relations for a memory
   */
  getRelations(memoryId: string): MemoryRelation[] {
    return this.storage.getRelations(memoryId);
  }

  /**
   * Boost memory importance
   */
  boostMemory(id: string, amount?: number): void {
    this.storage.boostImportance(id, amount);
  }

  /**
   * Pin/unpin memory
   */
  pinMemory(id: string, pinned: boolean = true): void {
    this.storage.setPinned(id, pinned);
  }

  /**
   * Delete memory
   */
  deleteMemory(id: string): boolean {
    return this.storage.deleteMemory(id);
  }

  /**
   * Get recent memories (for session start injection)
   */
  getRecentMemories(limit?: number, project?: string): Memory[] {
    return this.storage.getRecentMemories(limit, project);
  }

  /**
   * Apply decay to decaying memory types
   */
  applyDecay(): number {
    return this.storage.applyDecay();
  }

  /**
   * Check if semantic search is available
   */
  hasSemanticSearch(): boolean {
    return this.embeddings.isAvailable();
  }

  /**
   * Close the service
   */
  close(): void {
    this.storage.close();
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private keywordOnlySearch(candidates: Memory[], query: string): MemorySearchResult[] {
    return candidates.map(memory => {
      const score = keywordSimilarity(query, memory.content) * (0.5 + memory.importance * 0.5);
      return {
        memory,
        score,
        supersededBy: this.storage.getSupersededBy(memory.id) ?? undefined,
      };
    });
  }
}

// Singleton for use by tools
let serviceInstance: MemoryService | null = null;

export function initializeService(config: MemoryServiceConfig): MemoryService {
  if (serviceInstance) {
    serviceInstance.close();
  }
  serviceInstance = new MemoryService(config);
  return serviceInstance;
}

export function getService(): MemoryService {
  if (!serviceInstance) {
    throw new Error('Memory service not initialized. Call initializeService first.');
  }
  return serviceInstance;
}
