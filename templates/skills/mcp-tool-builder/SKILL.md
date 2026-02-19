---
name: mcp-tool-builder
description: >
  Builds MCP tools as AWS Lambda functions with TypeScript, test suites, and rich UI definitions.
  Use when the build request describes a new tool, utility, analyzer, calculator, or any callable function.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# MCP Tool Builder

You are building a Lambda-based MCP tool. Follow this pattern exactly.

## Project Setup

Create a standard TypeScript project:

```
my-tool/
├── src/
│   └── index.ts       ← Lambda handler
├── tests/
│   └── index.test.ts  ← Jest tests
├── package.json
├── tsconfig.json
├── jest.config.js
└── dist/
    └── index.js       ← esbuild output (bundled)
```

### package.json
```json
{
  "name": "my-tool",
  "version": "1.0.0",
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --outfile=dist/index.js --format=cjs",
    "test": "jest --verbose"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0",
    "ts-jest": "^29.1.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### jest.config.js
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
};
```

## Lambda Handler Pattern

```typescript
// src/index.ts
interface ToolEvent {
  arguments: Record<string, unknown>;
}

export const handler = async (event: ToolEvent) => {
  const args = event.arguments;
  // ... your logic here ...
  return { /* result fields */ };
};
```

**Key rules:**
- Input comes from `event.arguments` (NOT `event.body` or `event.input`)
- Return a plain object — it gets JSON.stringify'd automatically
- No need for statusCode/headers — this is invoked via Lambda SDK, not HTTP
- Handle edge cases (empty input, missing fields) gracefully

## Build & Package

```bash
npm install
npm run build
npm test
cd dist && zip -j ../lambda.zip index.js && cd ..
aws s3 cp lambda.zip "s3://${ARTIFACTS_BUCKET}/tools/${TOOL_NAME}/lambda.zip"
```

**`index.js` MUST be at the root of the zip** — Lambda expects to `require('./index')` directly. The `-j` flag strips directory paths. If you skip this, Lambda gets `Cannot find module 'index'`. Always verify: `unzip -l lambda.zip` should show `index.js` with no directory prefix.

The `s3Key` in output.json must match the upload path.

## UI Definition (uiDefinition)

Each tool MUST include a `uiDefinition` in output.json for automatic UI page generation. The frontend renders this dynamically — no per-tool code needed.

**CRITICAL: Use this exact structure.** The frontend TypeScript interface requires these specific field names — do NOT use alternatives like `displayName`, `formFields`, or `submitButton`.

```json
{
  "uiDefinition": {
    "title": "My Tool",
    "subtitle": "A brief tagline",
    "icon": "analytics",
    "form": {
      "fields": [
        {
          "key": "text",
          "label": "Input Text",
          "widget": "textarea",
          "placeholder": "Enter text..."
        }
      ],
      "submitLabel": "Analyze"
    },
    "resultDisplay": {
      "type": "cards",
      "cards": [
        { "field": "wordCount", "label": "Word Count", "format": "number", "icon": "format_list_numbered" }
      ],
      "summaryTemplate": "Analyzed {{wordCount}} words"
    },
    "examples": [
      { "label": "Simple text", "input": { "text": "hello world" } }
    ]
  }
}
```

### Required fields
- `title` (string) — page heading (NOT `displayName`)
- `form.fields` (array) — form inputs (NOT `formFields` at top level)
- `resultDisplay` — how to show results

### form.fields[].widget types
`text`, `textarea`, `number`, `select`, `toggle`, `slider`
- `select` needs `options: [{ label, value }]`
- `slider`/`number` use `min`, `max`, `step`

### resultDisplay.type options
`cards` (stat grid with icons), `table` (columns), `text`, `json` (fallback)
- `cards`: array of `{ field, label, format, icon }` — format: `number`, `text`, `badge`, `percent`
  - `field` supports dot-notation for nested results (e.g., `metrics.totalWords`)
- `table`: array of `{ key, label }` columns

### examples
Include 2-3 pre-filled "try it" buttons. Always include these for better UX.

### Icons
Use Material Icons names (e.g., `analytics`, `palette`, `text_fields`, `calculate`).

## Workflows (optional)

Include a `workflows` array in output.json to create automations that use your tools. Workflows are metadata, not code — just a prompt + tool references + schedule.

- `trigger.type`: `manual` or `cron`
- `trigger.schedule`: cron expression (e.g., `0 9 * * ? *` for daily at 9am)
- `model`: `haiku` (fast/cheap) or `sonnet` (smarter)
- `tools`: array of tool names the workflow can use

## Test Design

Write tests that exercise the Lambda handler directly:

```typescript
import { handler } from '../src/index';

describe('my-tool', () => {
  it('handles happy path', async () => {
    const result = await handler({ arguments: { text: 'hello world' } });
    expect(result.wordCount).toBe(2);
  });

  it('handles edge case', async () => {
    const result = await handler({ arguments: { text: '' } });
    expect(result.wordCount).toBe(0);
  });
});
```

Also include `testCases` in output.json — these run post-deployment as smoke tests.

## Reference

Clone the tools repo and look at existing tools for concrete examples of working Lambda handlers, uiDefinitions, and test suites.
