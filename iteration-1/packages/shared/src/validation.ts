/**
 * Validation Utilities
 *
 * Common validation helpers and error handling.
 */

import { z } from 'zod';

// ─── Custom Error Classes ────────────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class OrchestratorError extends Error {
  constructor(
    message: string,
    public readonly phase?: string,
    public readonly taskId?: string
  ) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

// ─── Error Sanitization ──────────────────────────────────────────────────────

/**
 * Sanitize error messages to remove sensitive data.
 * Redacts emails, tokens, and file paths.
 */
export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message
      // Redact email addresses
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
      // Redact bearer tokens
      .replace(/Bearer\s+[A-Za-z0-9-._~+/]+=*/g, 'Bearer [token]')
      // Redact access tokens in URLs
      .replace(/access_token=[^&\s]+/g, 'access_token=[redacted]')
      // Redact API keys
      .replace(/api[_-]?key[=:]\s*["']?[A-Za-z0-9-_]+["']?/gi, 'api_key=[redacted]')
      // Redact absolute paths
      .replace(/\/Users\/[^/\s]+/g, '/Users/[user]')
      .replace(/\/home\/[^/\s]+/g, '/home/[user]')
  );
}

// ─── Common Schemas ──────────────────────────────────────────────────────────

export const NonEmptyString = z.string().min(1, 'String cannot be empty');

export const PositiveInt = z.number().int().positive();

export const BranchName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-/]*[a-z0-9]$/, 'Invalid branch name format');

// ─── Validation Helpers ──────────────────────────────────────────────────────

/**
 * Validate input against a Zod schema.
 * Returns validated data or throws ValidationError.
 */
export function validate<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    const firstError = result.error.errors[0];
    throw new ValidationError(
      firstError?.message || 'Validation failed',
      firstError?.path.join('.'),
      { errors: result.error.errors }
    );
  }

  return result.data;
}

/**
 * Create a standardized MCP error response.
 */
export function createMcpErrorResponse(error: unknown): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
} {
  const message = sanitizeError(error);

  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}
