# Task: Implement count_words tool

## Context

This is a monorepo with the following structure:
- `packages/orchestrator/` - Main orchestrator (do NOT modify)
- `packages/shared/` - Shared types and utilities
- `packages/mcp-servers/` - MCP server implementations
  - `template/` - A working template server with auto-registration pattern

## Objective
Implement the count_words tool for the MCP server.

IMPORTANT: Use the auto-registration pattern!

Create src/tools/count_words.ts following this pattern:
```typescript
import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

export const CountWordsInput = z.object({
  // Define input schema
});

export async function count_wordsTool(input: z.infer<typeof CountWordsInput>) {
  const validated = CountWordsInput.parse(input);
  // Implementation
  return { result: ... };
}

// Self-register the tool
registerTool({
  name: 'count_words',
  description: '...',
  inputSchema: CountWordsInput,
  handler: count_wordsTool,
});
```

DO NOT modify:
- src/tools/index.ts (auto-generated during integration)
- server-setup.ts
- Any other tool files

## File Ownership (IMPORTANT!)

This task uses spatial decomposition. You have EXCLUSIVE ownership of specific files.
Other workers are running in parallel - do NOT touch files outside your ownership.

You may CREATE these files:
- packages/mcp-servers/*/src/tools/count_words.ts
- packages/mcp-servers/*/__tests__/count_words.test.ts


DO NOT create or modify any other files! This ensures parallel workers don't conflict.

## Specific Instructions

1. **Use auto-registration pattern**: Tools self-register by calling registerTool() when imported
2. **Use existing patterns**: Look at the template code to understand the patterns
3. **Keep it simple**: This is a POC - implement the minimum viable solution
4. **Commit your work**: Make a git commit when the task is complete

## Acceptance Criteria
- [ ] src/tools/count_words.ts created with Zod schema
- [ ] Tool uses registerTool() for self-registration
- [ ] Tests written in __tests__/count_words.test.ts
- [ ] npm run build && npm run test passes

## Verification
Before signaling completion, run from the repo root:
```bash
npm run build && npm run test && npm run lint
```

All commands must exit with code 0.

## When Done
When ALL acceptance criteria pass and verification commands succeed, output:
```
<promise>TASK_COMPLETE</promise>
```

IMPORTANT: Only output the promise tag when the task is TRULY complete. If tests fail or criteria aren't met, fix the issues first. You are in an iteration loop that will continue until you output the promise tag.
