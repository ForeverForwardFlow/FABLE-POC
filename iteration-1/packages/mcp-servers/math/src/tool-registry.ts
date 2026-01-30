/**
 * Tool Registry for Auto-Registration Pattern
 *
 * Tools self-register by calling registerTool() when their module is imported.
 * This allows for automatic tool discovery without manually maintaining lists.
 */

import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  zodSchema: z.ZodTypeAny;
  handler: (input: unknown) => Promise<unknown>;
}

const tools = new Map<string, ToolDefinition>();

/**
 * Register a tool for auto-discovery.
 * Called by tool modules during import.
 */
export function registerTool(definition: ToolDefinition): void {
  if (tools.has(definition.name)) {
    throw new Error(`Tool "${definition.name}" is already registered`);
  }
  tools.set(definition.name, definition);
}

/**
 * Get all registered tools.
 */
export function getRegisteredTools(): ToolDefinition[] {
  return Array.from(tools.values());
}

/**
 * Get a specific tool by name.
 */
export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name);
}

/**
 * Clear all registered tools (useful for testing).
 */
export function clearRegistry(): void {
  tools.clear();
}
