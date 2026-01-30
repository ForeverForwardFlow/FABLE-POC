/**
 * Type Definitions
 *
 * Shared types for this MCP server.
 * Define Zod schemas here for input validation.
 */

import { z } from 'zod';

// Re-export tool schemas
export { GreetInput } from './tools/greet.js';
export { CountdownInput } from './tools/countdown.js';
export { ReverseInput } from './tools/reverse.js';
export { UppercaseInput } from './tools/uppercase.js';
export { TimestampInput } from './tools/timestamp.js';

// Common schemas
export const PaginationParams = z.object({
  limit: z.number().int().positive().max(100).default(10),
  offset: z.number().int().nonnegative().default(0),
});

export const DryRunParam = z.object({
  dry_run: z.boolean().default(false),
});

// Helper to merge schemas with dry_run support
export function withDryRun<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.merge(DryRunParam);
}
