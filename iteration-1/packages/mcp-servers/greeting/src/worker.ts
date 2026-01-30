/**
 * MCP Greeting Server (HTTP transport for Cloudflare Workers)
 *
 * Remote entry point using Streamable HTTP transport.
 * For local stdio transport, see index.ts.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createGreetingServer } from './server-setup.js';

/**
 * Cloudflare Worker environment bindings
 */
interface Env {
  MCP_API_KEY: string;
  /** Comma-separated list of allowed CORS origins. Defaults to '*' for POC. */
  ALLOWED_ORIGINS?: string;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Compares two strings in a way that takes the same amount of time
 * regardless of where differences occur.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still need to do work to prevent length-based timing attacks
    let _unused = 0;
    for (let i = 0; i < a.length; i++) {
      _unused |= a.charCodeAt(i) ^ b.charCodeAt(i % b.length || 0);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Get allowed CORS origin from request and environment.
 * Returns the requesting origin if it's in the allowed list, otherwise null.
 */
function getAllowedOrigin(requestOrigin: string | null, env: Env): string {
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || ['*'];

  // If wildcard is allowed, return wildcard
  if (allowedOrigins.includes('*')) {
    return '*';
  }

  // Check if the requesting origin is in the allowed list
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  // Default to first allowed origin (for preflight responses)
  return allowedOrigins[0] || '';
}

/**
 * Handle CORS preflight requests
 */
function handleCors(origin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Add CORS headers to response
 */
function addCorsHeaders(response: Response, origin: string): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', origin);
  newHeaders.set('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * Cloudflare Worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get('Origin');
    const allowedOrigin = getAllowedOrigin(requestOrigin, env);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', server: 'mcp-greeting' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Only handle /mcp endpoint
    if (url.pathname !== '/mcp') {
      return new Response('Not Found', { status: 404 });
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors(allowedOrigin);
    }

    // Authenticate - require Bearer token with constant-time comparison
    const authHeader = request.headers.get('Authorization');
    const expectedAuth = `Bearer ${env.MCP_API_KEY}`;
    if (!authHeader || !constantTimeCompare(authHeader, expectedAuth)) {
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
    }

    // Create stateless transport with JSON responses (simpler for POC)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
      enableJsonResponse: true,
    });

    // Create and configure server
    const server = createGreetingServer();

    try {
      // Connect server to transport
      await server.connect(transport);

      // Handle the request
      const response = await transport.handleRequest(request);

      // Add CORS headers and return
      return addCorsHeaders(response, allowedOrigin);
    } finally {
      // Clean up
      await server.close();
    }
  },
};
