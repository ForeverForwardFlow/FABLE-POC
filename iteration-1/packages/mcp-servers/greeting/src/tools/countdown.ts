/**
 * Countdown Tool
 *
 * A tool that counts down from a given number to zero.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

// Maximum allowed countdown value to prevent resource exhaustion
const MAX_COUNTDOWN_VALUE = 10000;

// Input schema - always define with Zod
export const CountdownInput = z.object({
  start: z
    .number()
    .int()
    .positive('Start number must be a positive integer')
    .max(MAX_COUNTDOWN_VALUE, `Start number cannot exceed ${MAX_COUNTDOWN_VALUE}`),
});

// Output type
export interface CountdownOutput {
  countdown: number[];
  start: number;
  count: number;
}

/**
 * Countdown tool implementation.
 *
 * @param input - Validated input
 * @returns Countdown response with array of numbers from start to 0
 */
export async function countdownTool(
  input: z.infer<typeof CountdownInput>
): Promise<CountdownOutput> {
  const validated = CountdownInput.parse(input);

  // Generate countdown array from start to 0
  const countdown: number[] = [];
  for (let i = validated.start; i >= 0; i--) {
    countdown.push(i);
  }

  return {
    countdown,
    start: validated.start,
    count: countdown.length,
  };
}

// Self-register the tool
registerTool({
  name: 'countdown',
  description: 'Count down from a number to zero',
  inputSchema: CountdownInput,
  handler: countdownTool,
});
