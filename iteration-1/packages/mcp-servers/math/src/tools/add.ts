/**
 * Add Tool
 *
 * Adds two numbers together.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

// Input schema - always define with Zod
export const AddInput = z.object({
  a: z.number().describe('First number to add'),
  b: z.number().describe('Second number to add'),
});

// Output type
export interface AddOutput {
  result: number;
  operation: string;
}

/**
 * Add tool implementation.
 *
 * @param input - Validated input
 * @returns Addition result
 */
export async function addTool(input: z.infer<typeof AddInput>): Promise<AddOutput> {
  const validated = AddInput.parse(input);

  const result = validated.a + validated.b;

  return {
    result,
    operation: `${validated.a} + ${validated.b} = ${result}`,
  };
}

// Self-register the tool
registerTool({
  name: 'add',
  description: 'Adds two numbers together',
  inputSchema: AddInput.shape,
  zodSchema: AddInput,
  handler: async (input: unknown) => addTool(input as z.infer<typeof AddInput>),
});
