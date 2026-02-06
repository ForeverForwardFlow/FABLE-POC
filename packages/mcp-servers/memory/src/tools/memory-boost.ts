/**
 * memory_boost tool
 *
 * Increase a memory's importance.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';
import { getService } from '../memory-service.js';

export const MemoryBoostInput = z.object({
  id: z.string().uuid().describe('ID of the memory to boost'),
  amount: z.number().min(0.01).max(0.5).optional().describe('Boost amount (default: 0.1)'),
});

export async function memoryBoostTool(input: z.infer<typeof MemoryBoostInput>) {
  const service = getService();

  const memory = service.getMemory(input.id);
  if (!memory) {
    return { success: false, error: `Memory not found: ${input.id}` };
  }

  const oldImportance = memory.importance;
  service.boostMemory(input.id, input.amount ?? 0.1);

  // Get updated memory
  const updated = service.getMemory(input.id);

  return {
    success: true,
    memory: {
      id: memory.id,
      type: memory.type,
      content: memory.content.slice(0, 100) + (memory.content.length > 100 ? '...' : ''),
      oldImportance,
      newImportance: updated?.importance ?? oldImportance,
    },
    message: `Memory importance boosted: ${oldImportance.toFixed(2)} → ${(updated?.importance ?? oldImportance).toFixed(2)}`,
  };
}

registerTool({
  name: 'memory_boost',
  description: `Increase a memory's importance score.

Use this when a memory proves particularly useful or relevant.
Higher importance means the memory ranks higher in search results.`,
  inputSchema: MemoryBoostInput,
  handler: memoryBoostTool,
});
