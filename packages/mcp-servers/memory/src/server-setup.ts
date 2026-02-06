/**
 * Memory Server Setup
 *
 * Shared server configuration for both stdio and HTTP transports.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { initializeService, MemoryServiceConfig } from './memory-service.js';
import { getRegisteredTools, callRegisteredTool } from './tool-registry.js';

// Import tools to trigger registration
import './tools/index.js';

/**
 * Create and configure the memory MCP server.
 */
export function createMemoryServer(config: MemoryServiceConfig): Server {
  // Initialize the memory service
  initializeService(config);

  const server = new Server(
    {
      name: 'mcp-memory',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: getRegisteredTools() };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return callRegisteredTool(name, args);
  });

  return server;
}
