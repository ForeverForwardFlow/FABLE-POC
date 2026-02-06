#!/usr/bin/env node
/**
 * MCP Memory Server (stdio transport)
 *
 * Persistent AI memory with semantic search.
 *
 * Environment variables:
 * - MEMORY_DB_PATH: SQLite database path (default: ~/.claude/memory/global.db)
 * - OPENAI_API_KEY: Required for semantic search (optional, falls back to keyword)
 * - MEMORY_DECAY_RATE: Daily decay rate for non-anchored memories (default: 0.01)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMemoryServer } from './server-setup.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function getDefaultDbPath(): string {
  const claudeDir = path.join(os.homedir(), '.claude', 'memory');

  // Ensure directory exists
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  return path.join(claudeDir, 'global.db');
}

async function main() {
  const dbPath = process.env.MEMORY_DB_PATH ?? getDefaultDbPath();
  const decayRate = process.env.MEMORY_DECAY_RATE
    ? parseFloat(process.env.MEMORY_DECAY_RATE)
    : 0.01;

  console.error(`[mcp-memory] Starting server`);
  console.error(`[mcp-memory] Database: ${dbPath}`);
  console.error(`[mcp-memory] Semantic search: ${process.env.OPENAI_API_KEY ? 'enabled' : 'disabled (set OPENAI_API_KEY)'}`);

  const server = createMemoryServer({
    storage: {
      dbPath,
      decayRate,
    },
    embeddings: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[mcp-memory] Server started');
}

main().catch((error) => {
  console.error('[mcp-memory] Fatal error:', error);
  process.exit(1);
});
