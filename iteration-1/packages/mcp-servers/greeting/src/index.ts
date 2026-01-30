#!/usr/bin/env node
/**
 * MCP Greeting Server (stdio transport)
 *
 * Local entry point using stdio transport for spawning as a subprocess.
 * For remote HTTP deployment, see worker.ts.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGreetingServer } from './server-setup.js';

// Start server with stdio transport
async function main() {
  const server = createGreetingServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp-greeting] Server started');
}

main().catch((error) => {
  console.error('[mcp-greeting] Fatal error:', error);
  process.exit(1);
});
