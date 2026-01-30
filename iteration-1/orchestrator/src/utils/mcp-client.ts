/**
 * MCP Client Utilities
 *
 * Connects to MCP servers built by workers, allowing the orchestrator
 * to use newly-created capabilities.
 *
 * Supports both:
 * - Local servers via stdio transport
 * - Remote servers via HTTP transport
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ─── Local Server Types ──────────────────────────────────────────────────────

export interface McpServer {
  name: string;
  path: string;
  packageJson: { name: string; main?: string };
}

export interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  server: McpServer;
}

// ─── Remote Server Types ─────────────────────────────────────────────────────

export interface RemoteMcpServer {
  name: string;
  url: string;
  apiKey: string;
}

export interface RemoteMcpConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  server: RemoteMcpServer;
}

/**
 * Discover MCP servers in the mcp-servers directory.
 *
 * @param basePath - Base path to search (defaults to packages/mcp-servers)
 * @returns List of discovered MCP servers
 */
export function discoverMcpServers(basePath?: string): McpServer[] {
  const searchPath = basePath || resolve(process.cwd(), '../../mcp-servers');

  if (!existsSync(searchPath)) {
    return [];
  }

  const servers: McpServer[] = [];
  const entries = readdirSync(searchPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'template') continue; // Skip template

    const serverPath = join(searchPath, entry.name);
    const packageJsonPath = join(serverPath, 'package.json');
    const distPath = join(serverPath, 'dist', 'index.js');

    if (existsSync(packageJsonPath) && existsSync(distPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      servers.push({
        name: entry.name,
        path: serverPath,
        packageJson,
      });
    }
  }

  return servers;
}

/**
 * Connect to an MCP server.
 *
 * Spawns the server as a subprocess and connects via stdio.
 *
 * @param server - Server to connect to
 * @returns Connection with client and process handles
 */
export async function connectToMcpServer(server: McpServer): Promise<McpConnection> {
  const entryPoint = join(server.path, 'dist', 'index.js');

  // Create transport - StdioClientTransport handles process spawning internally
  const transport = new StdioClientTransport({
    command: 'node',
    args: [entryPoint],
    cwd: server.path,
  });

  const client = new Client(
    {
      name: 'fable-orchestrator',
      version: '0.1.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  return {
    client,
    transport,
    server,
  };
}

/**
 * List tools available from an MCP server.
 *
 * @param connection - Active MCP connection
 * @returns List of available tools
 */
export async function listTools(
  connection: McpConnection
): Promise<Array<{ name: string; description?: string }>> {
  const result = await connection.client.listTools();
  return result.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

/**
 * Call a tool on an MCP server.
 *
 * @param connection - Active MCP connection
 * @param toolName - Name of the tool to call
 * @param args - Arguments to pass to the tool
 * @returns Tool result
 */
export async function callTool(
  connection: McpConnection,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const result = await connection.client.callTool({
    name: toolName,
    arguments: args,
  });

  // Extract text content from result
  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content.find((c) => c.type === 'text');
    if (textContent && 'text' in textContent) {
      try {
        return JSON.parse(textContent.text);
      } catch {
        return textContent.text;
      }
    }
  }

  return result;
}

/**
 * Disconnect from an MCP server.
 *
 * Closes the client connection. The transport handles process cleanup.
 *
 * @param connection - Connection to close
 */
export async function disconnectFromMcpServer(connection: McpConnection): Promise<void> {
  await connection.client.close();
  // Transport handles process cleanup when client closes
}

/**
 * Convenience function to call a tool on a local server by name.
 *
 * Handles connection/disconnection automatically.
 *
 * @param serverName - Name of the server (directory name in mcp-servers)
 * @param toolName - Name of the tool to call
 * @param args - Arguments to pass to the tool
 * @param basePath - Optional base path for server discovery
 * @returns Tool result
 */
export async function useBuiltTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  basePath?: string
): Promise<unknown> {
  const searchPath = basePath || resolve(process.cwd(), '../../mcp-servers');
  const servers = discoverMcpServers(searchPath);
  const server = servers.find((s) => s.name === serverName);

  if (!server) {
    throw new Error(`MCP server '${serverName}' not found in ${searchPath}`);
  }

  const connection = await connectToMcpServer(server);

  try {
    return await callTool(connection, toolName, args);
  } finally {
    await disconnectFromMcpServer(connection);
  }
}

// ─── Remote Server Functions ─────────────────────────────────────────────────

/**
 * Connect to a remote MCP server via HTTP.
 *
 * @param server - Remote server configuration
 * @returns Connection with client handle
 */
export async function connectToRemoteMcpServer(
  server: RemoteMcpServer
): Promise<RemoteMcpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${server.apiKey}`,
      },
    },
  });

  const client = new Client(
    {
      name: 'fable-orchestrator',
      version: '0.1.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  return {
    client,
    transport,
    server,
  };
}

/**
 * List tools available from a remote MCP server.
 *
 * @param connection - Active remote MCP connection
 * @returns List of available tools
 */
export async function listRemoteTools(
  connection: RemoteMcpConnection
): Promise<Array<{ name: string; description?: string }>> {
  const result = await connection.client.listTools();
  return result.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

/**
 * Call a tool on a remote MCP server.
 *
 * @param connection - Active remote MCP connection
 * @param toolName - Name of the tool to call
 * @param args - Arguments to pass to the tool
 * @returns Tool result
 */
export async function callRemoteTool(
  connection: RemoteMcpConnection,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const result = await connection.client.callTool({
    name: toolName,
    arguments: args,
  });

  // Extract text content from result
  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content.find((c) => c.type === 'text');
    if (textContent && 'text' in textContent) {
      try {
        return JSON.parse(textContent.text);
      } catch {
        return textContent.text;
      }
    }
  }

  return result;
}

/**
 * Disconnect from a remote MCP server.
 *
 * @param connection - Connection to close
 */
export async function disconnectFromRemoteMcpServer(
  connection: RemoteMcpConnection
): Promise<void> {
  await connection.client.close();
}

/**
 * Convenience function to call a tool on a remote server.
 *
 * Handles connection/disconnection automatically.
 *
 * @param server - Remote server configuration
 * @param toolName - Name of the tool to call
 * @param args - Arguments to pass to the tool
 * @returns Tool result
 */
export async function useRemoteTool(
  server: RemoteMcpServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const connection = await connectToRemoteMcpServer(server);

  try {
    return await callRemoteTool(connection, toolName, args);
  } finally {
    await disconnectFromRemoteMcpServer(connection);
  }
}
