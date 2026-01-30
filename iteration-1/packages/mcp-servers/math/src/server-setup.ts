/**
 * MCP Math Server Setup
 *
 * Shared server configuration used by both stdio (local) and HTTP (remote) transports.
 * Uses auto-registration pattern for tool discovery.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpErrorResponse } from '@fable/shared';

// Import tools to trigger registration
import './tools/index.js';

import { getRegisteredTools, getTool } from './tool-registry.js';

/**
 * Create and configure the MCP math server.
 *
 * This function sets up the server with all registered tools.
 * The transport is not connected here - that's done by the caller.
 *
 * @returns Configured MCP Server instance
 */
export function createMathServer(): Server {
  const server = new Server(
    {
      name: 'mcp-math',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const registeredTools = getRegisteredTools();

    return {
      tools: registeredTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      })),
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const tool = getTool(name);

      if (!tool) {
        return createMcpErrorResponse(new Error(`Unknown tool: ${name}`));
      }

      const validatedInput = tool.zodSchema.parse(args);
      const result = await tool.handler(validatedInput);

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return createMcpErrorResponse(error);
    }
  });

  return server;
}
