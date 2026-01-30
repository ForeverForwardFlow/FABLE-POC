/**
 * Uppercase Tool
 *
 * A simple tool that takes a string and returns it in uppercase.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

// Input schema - always define with Zod
export const UppercaseInput = z.object({
  text: z.string().min(1, 'Text cannot be empty'),
});

// Output type
export interface UppercaseOutput {
  original: string;
  uppercase: string;
  length: number;
}

/**
 * Uppercase tool implementation.
 *
 * @param input - Validated input
 * @returns Uppercase text response
 */
export async function uppercaseTool(input: z.infer<typeof UppercaseInput>): Promise<UppercaseOutput> {
  const validated = UppercaseInput.parse(input);

  const uppercase = validated.text.toUpperCase();

  return {
    original: validated.text,
    uppercase,
    length: validated.text.length,
  };
}

// Self-register the tool
registerTool({
  name: 'uppercase',
  description: 'Convert a string to uppercase',
  inputSchema: UppercaseInput,
  handler: uppercaseTool,
});
