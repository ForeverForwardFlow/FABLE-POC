---
name: multi-tool-builder
description: >
  Builds a package of related tools that work together (e.g., CRUD operations, suite of analyzers).
  Use when the build request describes multiple related functions, a "suite", a "set of tools",
  or when a single concept naturally decomposes into multiple operations.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Multi-Tool Builder

You are building multiple related tools as a cohesive package. Each tool is a separate Lambda function, but they share common code and are deployed together.

## Project Structure

```
my-tool-suite/
├── src/
│   ├── shared/
│   │   └── utils.ts       ← Shared utilities across tools
│   ├── tool-one/
│   │   └── index.ts       ← Lambda handler for tool-one
│   ├── tool-two/
│   │   └── index.ts       ← Lambda handler for tool-two
│   └── tool-three/
│       └── index.ts       ← Lambda handler for tool-three
├── tests/
│   ├── tool-one.test.ts
│   ├── tool-two.test.ts
│   └── tool-three.test.ts
├── package.json
├── tsconfig.json
└── jest.config.js
```

## Build Script

Each tool needs its own bundle. Use a build script that creates separate outputs:

```json
{
  "scripts": {
    "build": "node build.js",
    "test": "jest --verbose"
  }
}
```

```javascript
// build.js
const esbuild = require('esbuild');
const tools = ['tool-one', 'tool-two', 'tool-three'];

Promise.all(tools.map(tool =>
  esbuild.build({
    entryPoints: [`src/${tool}/index.ts`],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: `dist/${tool}/index.js`,
    format: 'cjs',
  })
)).then(() => console.log('All tools built'));
```

## Packaging

Each tool gets its own zip for independent Lambda deployment:

```bash
for tool in tool-one tool-two tool-three; do
  (cd dist/$tool && zip -j ../../${tool}.zip index.js)
  aws s3 cp ${tool}.zip "s3://${ARTIFACTS_BUCKET}/tools/${tool}/lambda.zip"
done
```

## Output Format

List all tools in the `tools` array. Each gets its own Lambda:

```json
{
  "status": "success",
  "tools": [
    {
      "toolName": "contact-create",
      "description": "Creates a new contact",
      "s3Key": "tools/contact-create/lambda.zip",
      "schema": { ... },
      "testCases": [ ... ],
      "uiDefinition": { ... }
    },
    {
      "toolName": "contact-lookup",
      "description": "Looks up a contact by name or email",
      "s3Key": "tools/contact-lookup/lambda.zip",
      "schema": { ... },
      "testCases": [ ... ],
      "uiDefinition": { ... }
    }
  ]
}
```

## Shared Code Pattern

Put common logic in `src/shared/`:

```typescript
// src/shared/utils.ts
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function formatName(first: string, last: string): string {
  return `${first.trim()} ${last.trim()}`;
}
```

Import in each tool:
```typescript
// src/contact-create/index.ts
import { validateEmail, formatName } from '../shared/utils';
```

esbuild bundles the shared code into each tool's output automatically — no runtime dependency issues.

## Workflow Integration

Multi-tool suites are ideal for workflows that chain tools together:

```json
{
  "workflows": [
    {
      "name": "Daily Contact Report",
      "prompt": "Use contact-lookup to find all contacts added today, then use contact-stats to generate a summary report",
      "tools": ["contact-lookup", "contact-stats"],
      "trigger": { "type": "cron", "schedule": "0 17 * * ? *" }
    }
  ]
}
```

## Design Principles

1. **Each tool does one thing well** — Don't create a monolithic tool with a "mode" parameter
2. **Consistent naming** — Use a common prefix: `contact-create`, `contact-lookup`, `contact-delete`
3. **Consistent error format** — All tools in the suite should return errors the same way
4. **Independent deployability** — Each tool is a separate Lambda, can be updated independently
5. **Shared uiDefinition style** — Same icon family, consistent card layouts across the suite
