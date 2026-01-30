/**
 * Count Words Tool
 *
 * Counts the number of words in a text string.
 *
 * PATTERN: Each tool file self-registers by calling registerTool().
 * This eliminates the need to modify shared files when adding new tools.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

// Input schema - always define with Zod
export const CountWordsInput = z.object({
  text: z.string(),
});

// Output type
export interface CountWordsOutput {
  text: string;
  wordCount: number;
  characterCount: number;
  characterCountNoSpaces: number;
}

/**
 * Count words tool implementation.
 *
 * @param input - Validated input
 * @returns Word count response
 */
export async function countWordsTool(input: z.infer<typeof CountWordsInput>): Promise<CountWordsOutput> {
  const validated = CountWordsInput.parse(input);

  const { text } = validated;

  // Count words by splitting on whitespace and filtering empty strings
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  const wordCount = text.trim() === '' ? 0 : words.length;

  // Count characters
  const characterCount = text.length;
  const characterCountNoSpaces = text.replace(/\s/g, '').length;

  return {
    text,
    wordCount,
    characterCount,
    characterCountNoSpaces,
  };
}

// Self-register the tool
// This is called when the file is imported, automatically adding the tool to the registry
registerTool({
  name: 'count_words',
  description: 'Count the number of words and characters in a text string.',
  inputSchema: CountWordsInput,
  handler: countWordsTool,
});
