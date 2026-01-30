/**
 * Remote MCP Client Integration Tests
 *
 * These tests connect to a deployed MCP server via HTTP.
 * They are skipped if MCP_GREETING_API_KEY is not set.
 *
 * To run these tests:
 * 1. Deploy the greeting server: npm run deploy --workspace=@fable/mcp-greeting
 * 2. Set MCP_API_KEY secret: wrangler secret put MCP_API_KEY
 * 3. Set environment variables:
 *    export MCP_GREETING_API_KEY=your-key
 *    export MCP_GREETING_URL=https://mcp-greeting.your-subdomain.workers.dev/mcp
 * 4. Run tests: npm run test --workspace=@fable/orchestrator
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  connectToRemoteMcpServer,
  disconnectFromRemoteMcpServer,
  listRemoteTools,
  callRemoteTool,
  useRemoteTool,
  type RemoteMcpConnection,
  type RemoteMcpServer,
} from '../src/utils/mcp-client.js';

// Configuration from environment
const apiKey = process.env.MCP_GREETING_API_KEY;
const url = process.env.MCP_GREETING_URL || 'http://localhost:8787/mcp';
const hasConfig = Boolean(apiKey);

describe('Remote MCP Client', () => {
  let connection: RemoteMcpConnection | null = null;
  let server: RemoteMcpServer;

  beforeAll(async () => {
    if (!hasConfig) {
      console.log('Skipping remote MCP tests - MCP_GREETING_API_KEY not set');
      return;
    }

    server = {
      name: 'greeting',
      url,
      apiKey: apiKey!,
    };

    connection = await connectToRemoteMcpServer(server);
  });

  afterAll(async () => {
    if (connection) {
      await disconnectFromRemoteMcpServer(connection);
    }
  });

  it.skipIf(!hasConfig)('should connect to remote server', () => {
    expect(connection).not.toBeNull();
    expect(connection?.client).toBeDefined();
  });

  it.skipIf(!hasConfig)('should list tools from remote server', async () => {
    const tools = await listRemoteTools(connection!);

    expect(tools).toBeInstanceOf(Array);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === 'greet')).toBe(true);
  });

  it.skipIf(!hasConfig)('should call greet tool remotely', async () => {
    const result = await callRemoteTool(connection!, 'greet', { name: 'Remote' });

    expect(result).toHaveProperty('greeting');
    expect((result as { greeting: string }).greeting).toBe('Hello, Remote!');
  });

  it.skipIf(!hasConfig)('should call uppercase tool remotely', async () => {
    const result = await callRemoteTool(connection!, 'uppercase', { text: 'hello world' });

    expect(result).toHaveProperty('uppercase');
    expect((result as { uppercase: string }).uppercase).toBe('HELLO WORLD');
  });
});

describe('Remote MCP Convenience Functions', () => {
  const server: RemoteMcpServer = {
    name: 'greeting',
    url,
    apiKey: apiKey || '',
  };

  it.skipIf(!hasConfig)('should use useRemoteTool helper', async () => {
    const result = await useRemoteTool(server, 'greet', { name: 'Helper' });

    expect(result).toHaveProperty('greeting');
    expect((result as { greeting: string }).greeting).toBe('Hello, Helper!');
  });

  it.skipIf(!hasConfig)('should handle countdown tool', async () => {
    const result = await useRemoteTool(server, 'countdown', { start: 3 });

    expect(result).toHaveProperty('countdown');
    expect((result as { countdown: number[] }).countdown).toEqual([3, 2, 1, 0]);
  });
});
