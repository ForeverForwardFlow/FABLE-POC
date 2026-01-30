/**
 * MCP Greeting Server Setup
 *
 * Shared server configuration used by both stdio (local) and HTTP (remote) transports.
 * Uses auto-registration pattern - tools self-register when imported.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Import tools to trigger registration
import './tools/index.js';

// Import registry functions
import { getRegisteredTools, callRegisteredTool } from './tool-registry.js';

/**
 * Create and configure the MCP greeting server.
 *
 * This function sets up the server with all tool handlers.
 * The transport is not connected here - that's done by the caller.
 *
 * @returns Configured MCP Server instance
 */
export function createGreetingServer(): Server {
  const server = new Server(
    {
      name: 'mcp-greeting',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool listing handler - uses registry
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: getRegisteredTools(),
    };
  });

  // Register tool call handler - uses registry
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return callRegisteredTool(name, args);
  });

  return server;
}
