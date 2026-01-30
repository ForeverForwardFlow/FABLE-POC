/**
 * Greeting Tool
 *
 * A simple tool that takes a name and returns a greeting.
 */

import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

// Input schema - always define with Zod
export const GreetInput = z.object({
  name: z.string().min(1, 'Name cannot be empty'),
});

// Output type
export interface GreetOutput {
  greeting: string;
  name: string;
  timestamp: string;
}

/**
 * Greet tool implementation.
 *
 * @param input - Validated input
 * @returns Greeting response
 */
export async function greetTool(input: z.infer<typeof GreetInput>): Promise<GreetOutput> {
  const validated = GreetInput.parse(input);

  const greeting = `Hello, ${validated.name}!`;

  return {
    greeting,
    name: validated.name,
    timestamp: new Date().toISOString(),
  };
}

// Self-register the tool
registerTool({
  name: 'greet',
  description: 'Greet a user by name',
  inputSchema: GreetInput,
  handler: greetTool,
});
