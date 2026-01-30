/**
 * Timestamp Tool
 *
 * A simple tool that returns the current UTC timestamp in ISO format
 * along with Unix epoch milliseconds.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

// Input schema - empty object as per requirements
export const TimestampInput = z.object({});

// Output type
export interface TimestampOutput {
  iso: string;
  epoch: number;
}

/**
 * Timestamp tool implementation.
 *
 * @param input - Validated input (empty object)
 * @returns Timestamp response with ISO string and epoch milliseconds
 */
export async function timestampTool(
  input: z.infer<typeof TimestampInput>
): Promise<TimestampOutput> {
  TimestampInput.parse(input);

  const now = new Date();

  return {
    iso: now.toISOString(),
    epoch: now.getTime(),
  };
}

// Self-register the tool
registerTool({
  name: 'timestamp',
  description: 'Get the current UTC timestamp in ISO format and Unix epoch milliseconds',
  inputSchema: TimestampInput,
  handler: timestampTool,
});
