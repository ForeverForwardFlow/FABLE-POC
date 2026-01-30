/**
 * Truncate Tool
 *
 * Truncates a string to a specified maximum length, optionally adding a suffix.
 *
 * PATTERN: Each tool file self-registers by calling registerTool().
 * This eliminates the need to modify shared files when adding new tools.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

// Input schema - always define with Zod
export const TruncateInput = z.object({
  text: z.string(),
  maxLength: z.number().int().positive().min(1, 'maxLength must be at least 1'),
  suffix: z.string().default('...'),
});

// Output type
export interface TruncateOutput {
  original: string;
  truncated: string;
  wasTruncated: boolean;
  originalLength: number;
  truncatedLength: number;
}

/**
 * Truncate tool implementation.
 *
 * @param input - Validated input
 * @returns Truncate response
 */
export async function truncateTool(input: z.infer<typeof TruncateInput>): Promise<TruncateOutput> {
  const validated = TruncateInput.parse(input);

  const { text, maxLength, suffix } = validated;

  // If text is already within max length, return as-is
  if (text.length <= maxLength) {
    return {
      original: text,
      truncated: text,
      wasTruncated: false,
      originalLength: text.length,
      truncatedLength: text.length,
    };
  }

  // Truncate and add suffix
  const truncatedText = text.slice(0, maxLength - suffix.length) + suffix;

  return {
    original: text,
    truncated: truncatedText,
    wasTruncated: true,
    originalLength: text.length,
    truncatedLength: truncatedText.length,
  };
}

// Self-register the tool
// This is called when the file is imported, automatically adding the tool to the registry
registerTool({
  name: 'truncate',
  description: 'Truncate a string to a maximum length, optionally adding a suffix (default "...").',
  inputSchema: TruncateInput,
  handler: truncateTool,
});
