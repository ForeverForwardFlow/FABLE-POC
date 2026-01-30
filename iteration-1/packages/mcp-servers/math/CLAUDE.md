# Math MCP Server

A simple MCP server providing basic mathematical operations.

## Overview

This server provides tools for performing mathematical calculations.

## Structure

```
src/
├── index.ts       # Server entry, tool registration
├── tools/         # One file per tool
│   └── example.ts
└── types.ts       # Zod schemas for inputs/outputs
```

## Requirements

1. Every tool must have a Zod input schema
2. Write operations must support `dry_run: true` parameter
3. Handle errors gracefully — return structured errors, don't throw
4. All external API calls must be mocked in tests

## Implementing a Tool

```typescript
// src/tools/my-tool.ts
import { z } from 'zod';

export const MyToolInput = z.object({
  query: z.string().min(1),
  dry_run: z.boolean().default(false),
});

export async function myTool(input: z.infer<typeof MyToolInput>) {
  const validated = MyToolInput.parse(input);

  if (validated.dry_run) {
    return { would_do: 'description', dry_run: true };
  }

  // Implementation here
  return { result: 'data' };
}
```

## Testing

Write tests in `__tests__/`. Mock external APIs.

```bash
npm run test        # Run tests
npm run test:watch  # Watch mode
```

## Verification

Before signaling completion:

```bash
npm run build && npm run test && npm run lint
```

## When Done

When ALL acceptance criteria pass, output: TASK_COMPLETE
