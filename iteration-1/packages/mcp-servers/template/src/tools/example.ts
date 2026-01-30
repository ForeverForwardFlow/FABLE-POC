/**
 * Example Tool - Echo
 *
 * A simple example tool that echoes back input.
 * Replace this with your actual tool implementation.
 *
 * PATTERN: Each tool file self-registers by calling registerTool().
 * This eliminates the need to modify shared files when adding new tools.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

// Input schema - always define with Zod
export const EchoInput = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
  uppercase: z.boolean().default(false),
});

// Output type
export interface EchoOutput {
  echo: string;
  length: number;
  timestamp: string;
}

/**
 * Echo tool implementation.
 *
 * @param input - Validated input
 * @returns Echo response
 */
export async function echoTool(input: z.infer<typeof EchoInput>): Promise<EchoOutput> {
  const validated = EchoInput.parse(input);

  let echo = validated.message;
  if (validated.uppercase) {
    echo = echo.toUpperCase();
  }

  return {
    echo,
    length: echo.length,
    timestamp: new Date().toISOString(),
  };
}

// Self-register the tool
// This is called when the file is imported, automatically adding the tool to the registry
registerTool({
  name: 'echo',
  description: 'Echo back the input. A simple example tool.',
  inputSchema: EchoInput,
  handler: echoTool,
});
