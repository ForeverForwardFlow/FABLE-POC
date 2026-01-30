/**
 * MCP Client Tests
 *
 * Tests the ability to discover, connect to, and use MCP servers.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import {
  discoverMcpServers,
  connectToMcpServer,
  listTools,
  callTool,
  disconnectFromMcpServer,
  useBuiltTool,
  type McpConnection,
} from '../src/utils/mcp-client.js';

describe('MCP Client', () => {
  let connection: McpConnection | null = null;

  afterEach(async () => {
    if (connection) {
      await disconnectFromMcpServer(connection);
      connection = null;
    }
  });

  describe('discoverMcpServers', () => {
    it('should discover MCP servers in mcp-servers directory', () => {
      const basePath = resolve(__dirname, '../../mcp-servers');
      const servers = discoverMcpServers(basePath);

      expect(servers.length).toBeGreaterThan(0);
      expect(servers.some((s) => s.name === 'greeting')).toBe(true);
    });

    it('should skip the template directory', () => {
      const basePath = resolve(__dirname, '../../mcp-servers');
      const servers = discoverMcpServers(basePath);

      expect(servers.some((s) => s.name === 'template')).toBe(false);
    });
  });

  describe('connectToMcpServer', () => {
    it('should connect to a discovered server', async () => {
      const basePath = resolve(__dirname, '../../mcp-servers');
      const servers = discoverMcpServers(basePath);
      const greetingServer = servers.find((s) => s.name === 'greeting');

      expect(greetingServer).toBeDefined();

      connection = await connectToMcpServer(greetingServer!);
      expect(connection.client).toBeDefined();
    });
  });

  describe('listTools', () => {
    it('should list tools from connected server', async () => {
      const basePath = resolve(__dirname, '../../mcp-servers');
      const servers = discoverMcpServers(basePath);
      const greetingServer = servers.find((s) => s.name === 'greeting')!;

      connection = await connectToMcpServer(greetingServer);
      const tools = await listTools(connection);

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'greet')).toBe(true);
    });
  });

  describe('callTool', () => {
    it('should call the greet tool and get a response', async () => {
      const basePath = resolve(__dirname, '../../mcp-servers');
      const servers = discoverMcpServers(basePath);
      const greetingServer = servers.find((s) => s.name === 'greeting')!;

      connection = await connectToMcpServer(greetingServer);
      const result = (await callTool(connection, 'greet', { name: 'FABLE' })) as {
        greeting: string;
      };

      expect(result.greeting).toBe('Hello, FABLE!');
    });

    it('should call the countdown tool and get a response', async () => {
      const basePath = resolve(__dirname, '../../mcp-servers');
      const servers = discoverMcpServers(basePath);
      const greetingServer = servers.find((s) => s.name === 'greeting')!;

      connection = await connectToMcpServer(greetingServer);
      const result = (await callTool(connection, 'countdown', { start: 3 })) as {
        countdown: number[];
      };

      expect(result.countdown).toEqual([3, 2, 1, 0]);
    });
  });

  describe('useBuiltTool', () => {
    it('should call a tool with automatic connection management', async () => {
      const basePath = resolve(__dirname, '../../mcp-servers');
      const result = (await useBuiltTool(
        'greeting',
        'greet',
        { name: 'Convenience' },
        basePath
      )) as {
        greeting: string;
      };

      expect(result.greeting).toBe('Hello, Convenience!');
    });
  });
});
