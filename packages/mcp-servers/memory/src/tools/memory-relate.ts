/**
 * memory_relate tool
 *
 * Create relationships between memories.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';
import { getService } from '../memory-service.js';
import { RelationType } from '@fable/shared';

export const MemoryRelateInput = z.object({
  fromId: z.string().uuid().describe('ID of the source memory'),
  toId: z.string().uuid().describe('ID of the target memory'),
  type: RelationType.describe('Relationship type: supersedes, relates_to, caused_by, fixed_by, implements'),
});

export async function memoryRelateTool(input: z.infer<typeof MemoryRelateInput>) {
  const service = getService();

  // Verify both memories exist
  const from = service.getMemory(input.fromId);
  const to = service.getMemory(input.toId);

  if (!from) {
    return { success: false, error: `Source memory not found: ${input.fromId}` };
  }
  if (!to) {
    return { success: false, error: `Target memory not found: ${input.toId}` };
  }

  const relation = service.createRelation(input.fromId, input.toId, input.type);

  return {
    success: true,
    relation: {
      id: relation.id,
      type: relation.type,
      from: { id: from.id, content: from.content.slice(0, 50) + '...' },
      to: { id: to.id, content: to.content.slice(0, 50) + '...' },
    },
    message: `Relation created: ${from.type} --[${relation.type}]--> ${to.type}`,
  };
}

registerTool({
  name: 'memory_relate',
  description: `Create a relationship between two memories.

Relationship types:
- supersedes: New understanding replaces old (lowers old memory ranking)
- relates_to: Concepts are connected
- caused_by: A gotcha/problem was caused by a decision
- fixed_by: A problem was solved by a pattern
- implements: A capability implements a pattern`,
  inputSchema: MemoryRelateInput,
  handler: memoryRelateTool,
});
