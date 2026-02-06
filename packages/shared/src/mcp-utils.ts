/**
 * MCP Utility Functions
 *
 * Shared helpers for MCP server responses
 */

/**
 * Create a successful MCP response
 */
export function createMcpResponse(data: unknown): {
  content: Array<{ type: string; text: string }>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Create an MCP error response
 */
export function createMcpErrorResponse(error: unknown): {
  content: Array<{ type: string; text: string }>;
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current ISO timestamp
 */
export function now(): string {
  return new Date().toISOString();
}
