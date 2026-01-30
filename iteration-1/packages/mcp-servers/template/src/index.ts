#!/usr/bin/env node
/**
 * MCP Server Template
 *
 * This is a template MCP server using the auto-registration pattern.
 * Copy this directory to create new servers.
 *
 * ARCHITECTURE:
 * - Each tool in src/tools/ self-registers via registerTool()
 * - This file just loads all tools and starts the server
 * - No manual registration code needed here!
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Import tools to trigger registration
import './tools/index.js';

// Import registry functions
import { getRegisteredTools, callRegisteredTool } from './tool-registry.js';

// Create server instance
const server = new Server(
  {
    name: 'mcp-template',
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp-template] Server started');
}

main().catch((error) => {
  console.error('[mcp-template] Fatal error:', error);
  process.exit(1);
});
