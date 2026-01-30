#!/usr/bin/env node
/**
 * Math MCP Server
 *
 * Provides basic mathematical operations as MCP tools.
 * Uses auto-registration pattern for tool discovery.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMathServer } from './server-setup.js';

// Create server instance with auto-registered tools
const server = createMathServer();

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp-math] Server started');
}

main().catch((error) => {
  console.error('[mcp-math] Fatal error:', error);
  process.exit(1);
});
