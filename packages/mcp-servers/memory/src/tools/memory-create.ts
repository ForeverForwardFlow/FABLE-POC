/**
 * memory_create tool
 *
 * Create a new persistent memory.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';
import { getService } from '../memory-service.js';
import { MemoryType, MemoryScope, MemorySource } from '@fable/shared';

export const MemoryCreateInput = z.object({
  type: MemoryType.describe('Type of memory (insight, gotcha, preference, pattern, capability, status)'),
  content: z.string().min(1).describe('The memory content - what should be remembered'),
  context: z.string().optional().describe('Additional context (e.g., file path, project area)'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  project: z.string().optional().describe('Project identifier (for project-scoped memories)'),
  scope: MemoryScope.optional().describe('Visibility scope (private, project, global). Defaults based on type.'),
  source: MemorySource.optional().describe('Source of memory (user_stated, ai_corrected, ai_inferred). Default: ai_inferred'),
  importance: z.number().min(0).max(1).optional().describe('Initial importance (0-1). Default: 0.5'),
  pinned: z.boolean().optional().describe('Pin memory to prevent decay'),
  supersedes: z.string().uuid().optional().describe('ID of memory this supersedes (replaces)'),
});

export async function memoryCreateTool(input: z.infer<typeof MemoryCreateInput>) {
  const service = getService();
  const memory = await service.createMemory({
    ...input,
    source: input.source ?? 'ai_inferred',
  });

  return {
    success: true,
    memory: {
      id: memory.id,
      type: memory.type,
      scope: memory.scope,
      content: memory.content,
      createdAt: memory.createdAt,
    },
    message: `Memory created: ${memory.type} (${memory.scope} scope)`,
  };
}

registerTool({
  name: 'memory_create',
  description: `Create a new persistent memory. Use this to capture:
- insights: Why decisions were made
- gotchas: What went wrong and how to avoid it
- preferences: How the user likes things done
- patterns: Successful approaches to problems
- capabilities: Tools/features that have been built
- status: Current state, where we left off

Memories persist across sessions and are searchable via semantic similarity.`,
  inputSchema: MemoryCreateInput,
  handler: memoryCreateTool,
});
