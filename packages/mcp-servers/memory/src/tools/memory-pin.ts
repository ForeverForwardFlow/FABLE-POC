/**
 * memory_pin tool
 *
 * Pin or unpin a memory to prevent/allow decay.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';
import { getService } from '../memory-service.js';

export const MemoryPinInput = z.object({
  id: z.string().uuid().describe('ID of the memory to pin/unpin'),
  pinned: z.boolean().optional().describe('Pin state (default: true to pin)'),
});

export async function memoryPinTool(input: z.infer<typeof MemoryPinInput>) {
  const service = getService();

  const memory = service.getMemory(input.id);
  if (!memory) {
    return { success: false, error: `Memory not found: ${input.id}` };
  }

  const pinned = input.pinned ?? true;
  service.pinMemory(input.id, pinned);

  return {
    success: true,
    memory: {
      id: memory.id,
      type: memory.type,
      content: memory.content.slice(0, 100) + (memory.content.length > 100 ? '...' : ''),
      pinned,
    },
    message: pinned
      ? 'Memory pinned - will not decay over time'
      : 'Memory unpinned - will decay if not accessed',
  };
}

registerTool({
  name: 'memory_pin',
  description: `Pin or unpin a memory.

Pinned memories never decay over time regardless of their type.
Use this for memories that should always remain highly relevant.`,
  inputSchema: MemoryPinInput,
  handler: memoryPinTool,
});
