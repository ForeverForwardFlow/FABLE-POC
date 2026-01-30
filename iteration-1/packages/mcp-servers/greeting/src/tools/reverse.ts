/**
 * Reverse Tool
 *
 * A simple tool that takes a string and returns it reversed.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

// Input schema - always define with Zod
export const ReverseInput = z.object({
  text: z.string().min(1, 'Text cannot be empty'),
});

// Output type
export interface ReverseOutput {
  original: string;
  reversed: string;
  length: number;
}

/**
 * Reverse tool implementation.
 *
 * @param input - Validated input
 * @returns Reversed text response
 */
export async function reverseTool(input: z.infer<typeof ReverseInput>): Promise<ReverseOutput> {
  const validated = ReverseInput.parse(input);

  const reversed = validated.text.split('').reverse().join('');

  return {
    original: validated.text,
    reversed,
    length: validated.text.length,
  };
}

// Self-register the tool
registerTool({
  name: 'reverse',
  description: 'Reverse a string',
  inputSchema: ReverseInput,
  handler: reverseTool,
});
