/**
 * Multiply Tool
 *
 * Multiplies two numbers together.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

// Input schema - always define with Zod
export const MultiplyInput = z.object({
  a: z.number().describe('First number to multiply'),
  b: z.number().describe('Second number to multiply'),
});

// Output type
export interface MultiplyOutput {
  result: number;
  operation: string;
}

/**
 * Multiply tool implementation.
 *
 * @param input - Validated input
 * @returns Multiplication result
 */
export async function multiplyTool(input: z.infer<typeof MultiplyInput>): Promise<MultiplyOutput> {
  const validated = MultiplyInput.parse(input);

  const result = validated.a * validated.b;

  return {
    result,
    operation: `${validated.a} × ${validated.b} = ${result}`,
  };
}

// Self-register the tool
registerTool({
  name: 'multiply',
  description: 'Multiplies two numbers together',
  inputSchema: MultiplyInput.shape,
  zodSchema: MultiplyInput,
  handler: async (input: unknown) => multiplyTool(input as z.infer<typeof MultiplyInput>),
});
