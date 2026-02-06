/**
 * Tool Registry for Memory Server
 *
 * Auto-registration system for MCP tools.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createMcpErrorResponse } from '@fable/shared';

export interface ToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TInput;
  handler: (input: z.infer<TInput>) => Promise<unknown>;
}

interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const registry = new Map<string, ToolDefinition>();

export function registerTool<TInput extends z.ZodTypeAny>(
  definition: ToolDefinition<TInput>
): void {
  registry.set(definition.name, definition as unknown as ToolDefinition);
}

export function getRegisteredTools(): McpToolSchema[] {
  const tools: McpToolSchema[] = [];

  for (const [, definition] of registry) {
    const jsonSchema = zodToJsonSchema(definition.inputSchema, {
      $refStrategy: 'none',
    });
    const { $schema: _, ...schemaProps } = jsonSchema as Record<string, unknown>;

    tools.push({
      name: definition.name,
      description: definition.description,
      inputSchema: schemaProps,
    });
  }

  return tools;
}

export async function callRegisteredTool(
  name: string,
  args: unknown
): Promise<{ content: Array<{ type: string; text: string }>; isError?: true }> {
  const definition = registry.get(name);

  if (!definition) {
    return createMcpErrorResponse(new Error(`Unknown tool: ${name}`));
  }

  try {
    const validatedInput = definition.inputSchema.parse(args);
    const result = await definition.handler(validatedInput);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return createMcpErrorResponse(error);
  }
}
