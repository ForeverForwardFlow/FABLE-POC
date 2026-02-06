/**
 * memory_session_start tool
 *
 * Retrieve relevant context for a new session.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';
import { getService } from '../memory-service.js';

export const MemorySessionStartInput = z.object({
  project: z.string().optional().describe('Current project identifier'),
  limit: z.number().int().min(1).max(20).optional().describe('Maximum memories to retrieve (default: 10)'),
});

export async function memorySessionStartTool(input: z.infer<typeof MemorySessionStartInput>) {
  const service = getService();
  const limit = input.limit ?? 10;

  // Get recent memories
  const recent = service.getRecentMemories(limit, input.project);

  // Categorize for easier consumption
  const categorized = {
    preferences: recent.filter(m => m.type === 'preference'),
    insights: recent.filter(m => m.type === 'insight'),
    gotchas: recent.filter(m => m.type === 'gotcha'),
    patterns: recent.filter(m => m.type === 'pattern'),
    status: recent.filter(m => m.type === 'status'),
    capabilities: recent.filter(m => m.type === 'capability'),
  };

  const formatMemory = (m: typeof recent[0]) => ({
    id: m.id,
    content: m.content,
    context: m.context,
    importance: m.importance,
    updatedAt: m.updatedAt,
  });

  return {
    success: true,
    project: input.project ?? 'global',
    totalMemories: recent.length,
    semanticSearchEnabled: service.hasSemanticSearch(),
    context: {
      // User preferences should be known
      preferences: categorized.preferences.map(formatMemory),

      // Recent insights about decisions
      insights: categorized.insights.map(formatMemory),

      // Gotchas to avoid
      gotchas: categorized.gotchas.map(formatMemory),

      // Where we left off
      status: categorized.status.map(formatMemory),

      // Available capabilities
      capabilities: categorized.capabilities.map(formatMemory),

      // Patterns that work
      patterns: categorized.patterns.map(formatMemory),
    },
    message: `Session context loaded: ${recent.length} relevant memories`,
  };
}

registerTool({
  name: 'memory_session_start',
  description: `Retrieve relevant context at the start of a session.

Call this after reading CLAUDE.md to load persistent memories including:
- User preferences
- Recent insights and decisions
- Gotchas to avoid
- Current status/where we left off
- Available capabilities
- Useful patterns

This helps maintain continuity across sessions.`,
  inputSchema: MemorySessionStartInput,
  handler: memorySessionStartTool,
});
