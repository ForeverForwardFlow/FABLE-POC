/**
 * memory_search tool
 *
 * Search memories with semantic and keyword matching.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';
import { getService } from '../memory-service.js';
import { MemoryType, MemoryScope } from '@fable/shared';

export const MemorySearchInput = z.object({
  query: z.string().min(1).describe('Search query - describe what you are looking for'),
  types: z.array(MemoryType).optional().describe('Filter by memory types'),
  scopes: z.array(MemoryScope).optional().describe('Filter by scopes'),
  project: z.string().optional().describe('Filter by project (also includes global memories)'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  limit: z.number().int().min(1).max(50).optional().describe('Maximum results (default: 10)'),
  minImportance: z.number().min(0).max(1).optional().describe('Minimum importance threshold'),
  includeSuperseded: z.boolean().optional().describe('Include memories that have been superseded'),
});

export async function memorySearchTool(input: z.infer<typeof MemorySearchInput>) {
  const service = getService();

  const results = await service.searchMemories({
    query: input.query,
    types: input.types,
    scopes: input.scopes,
    project: input.project,
    tags: input.tags,
    limit: input.limit ?? 10,
    minImportance: input.minImportance,
    includeSuperseded: input.includeSuperseded ?? false,
  });

  return {
    success: true,
    count: results.length,
    semanticSearchEnabled: service.hasSemanticSearch(),
    results: results.map(r => ({
      id: r.memory.id,
      type: r.memory.type,
      scope: r.memory.scope,
      content: r.memory.content,
      context: r.memory.context,
      tags: r.memory.tags,
      importance: r.memory.importance,
      score: Math.round(r.score * 100) / 100,
      supersededBy: r.supersededBy,
      createdAt: r.memory.createdAt,
      accessCount: r.memory.accessCount,
    })),
  };
}

registerTool({
  name: 'memory_search',
  description: `Search for relevant memories using semantic similarity and keyword matching.

Results are ranked by relevance and importance. Use this to:
- Find context before starting work on a topic
- Recall past decisions and their reasoning
- Check for existing patterns or gotchas
- Retrieve user preferences`,
  inputSchema: MemorySearchInput,
  handler: memorySearchTool,
});
