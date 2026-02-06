#!/usr/bin/env node
/**
 * FABLE MCP Memory Sidecar
 *
 * Stdio MCP server that bridges to the Memory Lambda via HTTP.
 * Runs as a sidecar container in ECS, providing memory tools to Claude Code.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const MEMORY_LAMBDA_URL = process.env.MEMORY_LAMBDA_URL;
const BUILD_ID = process.env.FABLE_BUILD_ID || 'unknown';
const ORG_ID = process.env.FABLE_ORG_ID || '00000000-0000-0000-0000-000000000001';

if (!MEMORY_LAMBDA_URL) {
  console.error('MEMORY_LAMBDA_URL environment variable is required');
  process.exit(1);
}

// Memory tool definitions
const MEMORY_TOOLS = [
  {
    name: 'mcp__memory__memory_create',
    description: 'Create a new persistent memory. Use this to capture insights, gotchas, preferences, patterns, capabilities, or status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['insight', 'gotcha', 'preference', 'pattern', 'capability', 'status'],
          description: 'Type of memory'
        },
        content: { type: 'string', description: 'The memory content - what should be remembered' },
        scope: { type: 'string', enum: ['private', 'project', 'global'], description: 'Visibility scope' },
        source: { type: 'string', enum: ['user_stated', 'ai_corrected', 'ai_inferred'], description: 'Source of memory' },
        importance: { type: 'number', minimum: 0, maximum: 1, description: 'Initial importance (0-1)' },
        pinned: { type: 'boolean', description: 'Pin memory to prevent decay' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        context: { type: 'object', description: 'Additional context' },
        project: { type: 'string', description: 'Project identifier' },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'mcp__memory__memory_search',
    description: 'Search for relevant memories using semantic similarity and keyword matching.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query - describe what you are looking for' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum results' },
        types: { type: 'array', items: { type: 'string' }, description: 'Filter by memory types' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        project: { type: 'string', description: 'Filter by project' },
      },
      required: ['query'],
    },
  },
  {
    name: 'mcp__memory__memory_session_start',
    description: 'Retrieve relevant context at the start of a session. Returns prioritized memories.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Current project identifier' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum memories to retrieve' },
      },
    },
  },
  {
    name: 'mcp__memory__memory_boost',
    description: "Increase a memory's importance score when it proves useful.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'ID of the memory to boost' },
        amount: { type: 'number', minimum: 0.01, maximum: 0.5, description: 'Boost amount' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mcp__memory__memory_pin',
    description: 'Pin or unpin a memory. Pinned memories never decay.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'ID of the memory to pin/unpin' },
        pinned: { type: 'boolean', description: 'Pin state' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mcp__memory__memory_relate',
    description: 'Create a relationship between two memories.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fromId: { type: 'string', description: 'ID of the source memory' },
        toId: { type: 'string', description: 'ID of the target memory' },
        type: {
          type: 'string',
          enum: ['supersedes', 'relates_to', 'caused_by', 'fixed_by', 'implements'],
          description: 'Relationship type'
        },
      },
      required: ['fromId', 'toId', 'type'],
    },
  },
];

// Map tool names to Lambda actions
const toolToAction: Record<string, string> = {
  'mcp__memory__memory_create': 'create',
  'mcp__memory__memory_search': 'search',
  'mcp__memory__memory_session_start': 'session_start',
  'mcp__memory__memory_boost': 'boost',
  'mcp__memory__memory_pin': 'pin',
  'mcp__memory__memory_relate': 'relate',
};

// Call the Memory Lambda
async function callMemoryLambda(action: string, payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(MEMORY_LAMBDA_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-fable-build-id': BUILD_ID,
      'x-fable-org-id': ORG_ID,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: `memory_${action}`,
        arguments: payload,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Memory Lambda returned ${response.status}: ${await response.text()}`);
  }

  const result = await response.json() as { error?: { message?: string }; result?: unknown };

  if (result.error) {
    throw new Error(result.error.message || 'Unknown error from Memory Lambda');
  }

  return result.result;
}

// Create and run the MCP server
async function main() {
  const server = new Server(
    {
      name: 'fable-memory',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: MEMORY_TOOLS };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const action = toolToAction[name];
    if (!action) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await callMemoryLambda(action, args as Record<string, unknown>);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('FABLE MCP Memory Sidecar running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
