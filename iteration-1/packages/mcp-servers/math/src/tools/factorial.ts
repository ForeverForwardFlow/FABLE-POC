/**
 * Factorial Tool
 *
 * Calculates the factorial of a non-negative integer.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

// Input schema - always define with Zod
export const FactorialInput = z.object({
  n: z.number().int().nonnegative().describe('Non-negative integer to calculate factorial'),
});

// Output type
export interface FactorialOutput {
  result: number;
  operation: string;
}

/**
 * Factorial tool implementation.
 *
 * @param input - Validated input
 * @returns Factorial result
 */
export async function factorialTool(input: z.infer<typeof FactorialInput>): Promise<FactorialOutput> {
  const validated = FactorialInput.parse(input);

  // Calculate factorial
  let result = 1;
  for (let i = 2; i <= validated.n; i++) {
    result *= i;
  }

  return {
    result,
    operation: `${validated.n}! = ${result}`,
  };
}

// Self-register the tool
registerTool({
  name: 'factorial',
  description: 'Calculate the factorial of a non-negative integer',
  inputSchema: FactorialInput.shape,
  zodSchema: FactorialInput,
  handler: factorialTool as (input: unknown) => Promise<unknown>,
});
