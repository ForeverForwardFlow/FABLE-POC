/**
 * Tool Registry
 *
 * Auto-registration system for MCP tools.
 * Tools register themselves when imported, eliminating the need
 * for manual registration in shared files.
 *
 * This enables parallel worker development - each worker only touches
 * its own tool file, and tools are automatically available.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createMcpErrorResponse } from '@fable/shared';

/**
 * Tool definition interface.
 * Each tool file exports a definition matching this interface.
 */
export interface ToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Tool name (used in MCP calls) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Zod schema for input validation */
  inputSchema: TInput;
  /** Tool implementation function */
  handler: (input: z.infer<TInput>) => Promise<unknown>;
}

/**
 * MCP tool schema format for ListTools response
 */
interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Tool registry - stores all registered tools
 */
const registry = new Map<string, ToolDefinition>();

/**
 * Register a tool with the registry.
 * Called by each tool file when it's imported.
 *
 * @param definition - Tool definition to register
 */
export function registerTool<TInput extends z.ZodTypeAny>(
  definition: ToolDefinition<TInput>
): void {
  if (registry.has(definition.name)) {
    console.warn(`[tool-registry] Warning: Tool "${definition.name}" already registered, overwriting`);
  }
  registry.set(definition.name, definition as unknown as ToolDefinition);
}

/**
 * Get all registered tools in MCP format.
 * Used by ListToolsRequestSchema handler.
 *
 * @returns Array of tool schemas for MCP
 */
export function getRegisteredTools(): McpToolSchema[] {
  const tools: McpToolSchema[] = [];

  for (const [, definition] of registry) {
    // Convert Zod schema to JSON Schema for MCP
    const jsonSchema = zodToJsonSchema(definition.inputSchema, {
      $refStrategy: 'none',
    });

    // Extract just the schema properties (remove $schema, etc.)
    const { $schema: _, ...schemaProps } = jsonSchema as Record<string, unknown>;

    tools.push({
      name: definition.name,
      description: definition.description,
      inputSchema: schemaProps,
    });
  }

  return tools;
}

/**
 * Call a registered tool by name.
 * Used by CallToolRequestSchema handler.
 *
 * @param name - Tool name to call
 * @param args - Arguments to pass to the tool
 * @returns MCP response format
 */
export async function callRegisteredTool(
  name: string,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const definition = registry.get(name);

  if (!definition) {
    return createMcpErrorResponse(new Error(`Unknown tool: ${name}`));
  }

  try {
    // Validate input with Zod schema
    const validatedInput = definition.inputSchema.parse(args);

    // Call the handler
    const result = await definition.handler(validatedInput);

    // Return in MCP format
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return createMcpErrorResponse(error);
  }
}

/**
 * Check if a tool is registered.
 *
 * @param name - Tool name to check
 * @returns Whether the tool is registered
 */
export function hasRegisteredTool(name: string): boolean {
  return registry.has(name);
}

/**
 * Get count of registered tools.
 * Useful for debugging and testing.
 */
export function getRegisteredToolCount(): number {
  return registry.size;
}

/**
 * Clear all registered tools.
 * Primarily for testing purposes.
 */
export function clearRegistry(): void {
  registry.clear();
}
