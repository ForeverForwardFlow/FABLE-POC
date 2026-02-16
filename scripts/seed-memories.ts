#!/usr/bin/env npx tsx
/**
 * Seed FABLE Builder memories into Aurora/pgvector via the Memory Lambda.
 *
 * Usage:
 *   MEMORY_LAMBDA_URL=https://xxx.lambda-url.us-west-2.on.aws/ npx tsx scripts/seed-memories.ts
 *
 * Or invoke the Lambda directly:
 *   MEMORY_LAMBDA_NAME=fable-dev-memory npx tsx scripts/seed-memories.ts --direct
 */

const MEMORY_LAMBDA_URL = process.env.MEMORY_LAMBDA_URL;
const MEMORY_LAMBDA_NAME = process.env.MEMORY_LAMBDA_NAME;
const ORG_ID = process.env.ORG_ID || '00000000-0000-0000-0000-000000000001';
const BUILD_ID = 'seed-memories';
const useDirect = process.argv.includes('--direct');

interface Memory {
  type: 'insight' | 'gotcha' | 'preference' | 'pattern' | 'capability' | 'status';
  content: string;
  tags: string[];
  importance: number;
  scope: 'private' | 'project' | 'global';
  source: 'user_stated' | 'ai_corrected' | 'ai_inferred';
  project: string;
  pinned?: boolean;
}

const memories: Memory[] = [
  // ============================
  // Build Types
  // ============================
  {
    type: 'pattern',
    content: 'FABLE supports three build types: tool (Lambda function), ui (React SPA on CloudFront), and workflow (Lambda chain with EventBridge Scheduler). Most builds are tools.',
    tags: ['architecture', 'build-types'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'pattern',
    content: 'Tool builds produce a Lambda handler in src/index.ts, tests in __tests__/, esbuild bundle in dist/index.js, and an S3 artifact (lambda.zip). The handler receives events via API Gateway or direct invocation.',
    tags: ['tool', 'architecture', 'file-structure'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'pattern',
    content: `Tool file structure in the FABLE-TOOLS repo:
tools/{tool-name}/
  src/index.ts        - Lambda handler (exports.handler)
  __tests__/{name}.test.ts - Jest tests
  tool.json           - MCP schema (name, description, inputSchema)
  package.json        - Dependencies + build/test scripts
  tsconfig.json       - TypeScript config (ES2022, commonjs, strict)
  dist/index.js       - Built artifact (not committed, built by esbuild)`,
    tags: ['tool', 'file-structure', 'architecture'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },

  // ============================
  // Implementation Patterns
  // ============================
  {
    type: 'pattern',
    content: `Lambda handler pattern for FABLE tools:
export const handler = async (event: { body?: string }) => {
  try {
    const input = JSON.parse(event.body || '{}');
    // Validate required fields
    // Process request
    return { statusCode: 200, body: JSON.stringify({ result }) };
  } catch (error) {
    return { statusCode: error.statusCode || 500, body: JSON.stringify({ error: error.message }) };
  }
};`,
    tags: ['tool', 'lambda', 'implementation'],
    importance: 0.8,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: `Test pattern for FABLE tools (Jest + ts-jest):
import { handler } from '../src/index';
describe('tool-name', () => {
  it('should handle valid input', async () => {
    const result = await handler({ body: JSON.stringify({ field: 'value' }) });
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.result).toBeDefined();
  });
  it('should handle missing required fields', async () => {
    const result = await handler({ body: '{}' });
    expect(result.statusCode).toBe(400);
  });
  it('should handle empty body', async () => {
    const result = await handler({});
    expect(result.statusCode).toBe(400);
  });
});`,
    tags: ['tool', 'testing', 'implementation'],
    importance: 0.8,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: `tool.json format for MCP schema registration:
{
  "name": "tool-name",
  "description": "What the tool does in one sentence",
  "inputSchema": {
    "type": "object",
    "properties": {
      "fieldName": { "type": "string", "description": "What this field is" }
    },
    "required": ["fieldName"]
  }
}
The inputSchema MUST exactly match what the Lambda handler accepts and validates.`,
    tags: ['tool', 'schema', 'mcp'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: `package.json template for FABLE tools:
{
  "name": "@fable-tools/tool-name",
  "version": "1.0.0",
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/index.js",
    "test": "jest --config jest.config.js"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "@types/jest": "^29.5.0",
    "typescript": "^5.3.0"
  }
}`,
    tags: ['tool', 'package-json', 'implementation'],
    importance: 0.8,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: 'tsconfig.json for FABLE tools: { "compilerOptions": { "target": "ES2022", "module": "commonjs", "lib": ["ES2022"], "outDir": "./dist", "rootDir": "./src", "strict": true, "esModuleInterop": true, "skipLibCheck": true, "forceConsistentCasingInFileNames": true, "resolveJsonModule": true, "declaration": true }, "include": ["src/**/*"], "exclude": ["node_modules", "dist", "__tests__"] }',
    tags: ['tool', 'tsconfig', 'implementation'],
    importance: 0.7,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: 'esbuild command for FABLE tools: esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/index.js. MUST use --format=cjs (not esm) because Lambda uses require(). MUST use --bundle to inline all dependencies.',
    tags: ['tool', 'esbuild', 'build'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },

  // ============================
  // Deployment Patterns
  // ============================
  {
    type: 'pattern',
    content: `Git flow for FABLE tool deployment:
1. Clone FABLE-TOOLS repo: git clone https://github.com/ForeverForwardFlow/FABLE-TOOLS.git
2. Create branch: git checkout -b fable/{buildId}
3. Create tool directory: tools/{tool-name}/
4. Copy all files (src/, __tests__/, tool.json, package.json, tsconfig.json)
5. Run npm install && npm run build && npm test
6. Commit all files including package-lock.json
7. Merge to main: git checkout main && git merge fable/{buildId}
8. Push: git push origin main
GitHub auth is pre-configured in the container via credential helper.`,
    tags: ['deployment', 'git', 'workflow'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'pattern',
    content: `S3 artifact upload for FABLE tool deployment:
1. cd into the tool's dist/ directory
2. zip index.js into lambda.zip: cd dist && zip lambda.zip index.js
3. Upload to S3: aws s3 cp lambda.zip s3://${'{ARTIFACTS_BUCKET}'}/tools/{tool-name}/lambda.zip
The ARTIFACTS_BUCKET environment variable is available in the container.
The tool-deployer Lambda reads this zip to create/update the Lambda function.`,
    tags: ['deployment', 's3', 'artifact'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: `output.json format for successful FABLE builds:
{
  "status": "success",
  "tools": [{
    "toolName": "my-tool",
    "description": "What the tool does",
    "s3Key": "tools/my-tool/lambda.zip",
    "schema": {
      "name": "my-tool",
      "description": "What the tool does",
      "inputSchema": { "type": "object", "properties": {...}, "required": [...] }
    }
  }],
  "deployment": {
    "method": "s3",
    "repo": "ForeverForwardFlow/FABLE-TOOLS",
    "commit": "abc123def"
  }
}
For failures: { "status": "failed", "error": "What went wrong" }`,
    tags: ['deployment', 'output', 'format'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'insight',
    content: 'Environment variables available in the FABLE build container: FABLE_BUILD_ID (build UUID), FABLE_PHASE (builder), FABLE_BUILD_SPEC (JSON spec or S3 URI), ARTIFACTS_BUCKET (S3 bucket name), BUILDS_TABLE (DynamoDB table), FABLE_GITHUB_REPO (owner/repo), GITHUB_SECRET_ARN, MEMORY_LAMBDA_URL, MCP_GATEWAY_URL, CLAUDE_CODE_USE_BEDROCK=1, AWS_REGION.',
    tags: ['environment', 'container', 'configuration'],
    importance: 0.8,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'insight',
    content: 'GitHub authentication is pre-configured in the FABLE build container. The entrypoint.sh fetches a GitHub App installation token from Secrets Manager and configures git credential helper. You can clone and push to the FABLE-TOOLS repo without additional auth setup.',
    tags: ['github', 'authentication', 'container'],
    importance: 0.7,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },

  // ============================
  // Quality Patterns
  // ============================
  {
    type: 'pattern',
    content: 'All tests must pass before committing code in FABLE builds. Run npm test and verify exit code 0. If tests fail, fix the code and re-run. Do not commit with failing tests.',
    tags: ['quality', 'testing', 'workflow'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: 'tool.json inputSchema must exactly match what the Lambda handler implementation accepts. Every property in inputSchema should be validated in the handler. The "required" array must list all fields that the handler requires. Mismatch between schema and implementation causes runtime errors for users.',
    tags: ['quality', 'schema', 'validation'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: 'Every required field in a FABLE tool should be validated at the start of the handler. Return a 400 with a clear error message listing missing fields. Example: if (!input.text) return { statusCode: 400, body: JSON.stringify({ error: "Missing required field: text" }) };',
    tags: ['quality', 'validation', 'error-handling'],
    importance: 0.7,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: 'Return structured JSON from FABLE tool handlers with consistent error format: { statusCode: number, body: string }. Success: { statusCode: 200, body: JSON.stringify({ result: ... }) }. Error: { statusCode: 4xx/5xx, body: JSON.stringify({ error: "message" }) }. Always include CORS headers if the tool might be called from browsers.',
    tags: ['quality', 'response-format', 'implementation'],
    importance: 0.7,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: 'Before packaging a FABLE tool artifact, verify: 1) npm run build succeeds, 2) dist/index.js exists and is non-empty, 3) npm test passes, 4) tool.json is valid JSON with matching schema. Only then zip and upload.',
    tags: ['quality', 'build', 'verification'],
    importance: 0.8,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },

  // ============================
  // Testing Strategy (Playwright + Unit Tests)
  // ============================
  {
    type: 'pattern',
    content: `FABLE builds require TWO levels of testing before completion:

1. **Unit tests (ALWAYS required)**: Test the handler directly with Jest.
   - Import handler, call with mock events, assert responses.
   - Cover: valid input, missing fields, edge cases, error handling.
   - Run with: npm test

2. **Integration tests with Playwright (required for UI builds, recommended for tools)**:
   - For TOOLS: Start a local HTTP server wrapping the handler, then use Playwright to verify HTTP responses.
   - For UIs: Build the React app, serve locally with npx serve, then use Playwright to test in a real browser.
   - Playwright and Chromium are pre-installed in the build container.
   - Run with: npx playwright test

Do NOT skip Playwright tests for UI builds. Unit tests alone cannot catch rendering bugs, layout issues, or browser-specific behavior.`,
    tags: ['testing', 'playwright', 'quality', 'strategy'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'pattern',
    content: `Playwright test pattern for FABLE tool builds — test via local HTTP server:

// e2e/tool.spec.ts
import { test, expect } from '@playwright/test';

test('tool responds correctly via HTTP', async ({ request }) => {
  const response = await request.post('http://localhost:3000', {
    data: { text: 'hello world' }
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.result).toBeDefined();
});

test('tool returns 400 for missing fields', async ({ request }) => {
  const response = await request.post('http://localhost:3000', {
    data: {}
  });
  expect(response.status()).toBe(400);
});

// Start local server before tests (in playwright.config.ts):
// webServer: { command: 'node test-server.js', port: 3000 }
// test-server.js wraps the Lambda handler with http.createServer`,
    tags: ['testing', 'playwright', 'tool', 'pattern'],
    importance: 0.8,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: `Playwright test pattern for FABLE UI builds — test in a real browser:

// e2e/ui.spec.ts
import { test, expect } from '@playwright/test';

test('page loads and shows main content', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.locator('h1')).toBeVisible();
});

test('form submission works', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.fill('input[name="query"]', 'test input');
  await page.click('button[type="submit"]');
  await expect(page.locator('.result')).toBeVisible();
});

// playwright.config.ts:
// webServer: { command: 'npm run dev', port: 5173, reuseExistingServer: true }
// use: { browserName: 'chromium', headless: true }`,
    tags: ['testing', 'playwright', 'ui', 'pattern'],
    importance: 0.8,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: `playwright.config.ts template for FABLE builds:

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: 'node test-server.js',  // For tools: local HTTP wrapper around Lambda handler
    port: 3000,
    reuseExistingServer: true,
  },
});

For UI builds, change command to 'npm run dev' and port to 5173.
Chromium is pre-installed in the container — do NOT run 'npx playwright install' again.`,
    tags: ['testing', 'playwright', 'config'],
    importance: 0.75,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: `test-server.js pattern for wrapping a FABLE Lambda handler as a local HTTP server (for Playwright integration tests):

const http = require('http');
const { handler } = require('./dist/index.js');

const server = http.createServer(async (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const result = await handler({ body: body || '{}' });
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

server.listen(3000, () => console.log('Test server on :3000'));

Run 'npm run build' first so dist/index.js exists.`,
    tags: ['testing', 'playwright', 'tool', 'server'],
    importance: 0.8,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },

  // ============================
  // Common Gotchas
  // ============================
  {
    type: 'gotcha',
    content: 'esbuild MUST use --format=cjs for Lambda (not esm). Lambda uses require() to load the handler. Using --format=esm will cause "require is not defined" or similar errors at runtime.',
    tags: ['esbuild', 'lambda', 'build'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'gotcha',
    content: 'package-lock.json is required — always run npm install before committing to generate it. Without it, the Lambda may get different dependency versions than what was tested.',
    tags: ['npm', 'dependencies', 'deployment'],
    importance: 0.7,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'gotcha',
    content: 'dist/ directory is NOT committed to GitHub in FABLE-TOOLS. The built artifact (dist/index.js) must be zipped and uploaded to S3 as lambda.zip. The tool-deployer Lambda reads from S3, not from GitHub.',
    tags: ['deployment', 'git', 'artifact'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'gotcha',
    content: 'tool.json "required" array must exactly match the actual required fields in the handler. If the handler requires "text" but tool.json says required: [], users will get confusing runtime errors instead of schema validation errors.',
    tags: ['schema', 'validation', 'tool-json'],
    importance: 0.7,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'gotcha',
    content: 'Git branch names in FABLE builds should include the buildId for traceability: fable/{buildId}. This makes it easy to trace deployed tools back to specific build runs.',
    tags: ['git', 'deployment', 'traceability'],
    importance: 0.6,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },

  // ============================
  // Infrastructure Self-Awareness
  // ============================
  {
    type: 'insight',
    content: 'FABLE architecture flow: chat → build-kickoff (ECS RunTask) → ECS builder (Claude Code + memory) → EventBridge → build-completion Lambda → tool-deployer → QA smoke tests → WebSocket notification to user. Understanding this pipeline is essential for diagnosing build failures.',
    tags: ['infra', 'architecture', 'pipeline'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'insight',
    content: 'build-completion Lambda: reads builder output from S3, invokes tool-deployer, runs QA smoke tests (direct Lambda invoke with {arguments: {...}} format), AI fidelity check via Bedrock, then notifies user via WebSocket or retries the build on failure.',
    tags: ['infra', 'build-completion', 'pipeline'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'insight',
    content: 'Tool Lambda invocation format: {arguments: {param1: val1, param2: val2}}. NOT MCP JSON-RPC envelope. The handler destructures event.arguments directly. Getting this format wrong causes QA smoke tests to fail even when the tool itself is correct.',
    tags: ['infra', 'tools', 'payload', 'qa'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'pattern',
    content: 'When QA fails after deployment: (1) use mcp__infra__read_logs for build-completion to see the actual error, (2) use mcp__infra__test_invoke on the deployed tool directly to confirm it works, (3) if the tool works but QA fails, the bug is in build-completion or the test case format, not the tool code.',
    tags: ['infra', 'diagnosis', 'qa', 'self-repair'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'pattern',
    content: 'When fixing a pipeline Lambda: (1) mcp__infra__get_lambda_code to read current source, (2) write fixed code as zip to S3 using aws s3 cp, (3) mcp__infra__update_lambda_code to deploy the fix, (4) mcp__infra__test_invoke to verify the fix works. Always include a reason for audit trail.',
    tags: ['infra', 'self-repair', 'workflow'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'gotcha',
    content: 'ECS container overrides have an 8192 byte limit. Large build specs must go through S3 — the build-kickoff Lambda stores them at s3://{ARTIFACTS_BUCKET}/builds/{buildId}/build-spec.json and passes an s3:// URI in the FABLE_BUILD_SPEC env var.',
    tags: ['infra', 'ecs', 'limit', 'build-spec'],
    importance: 0.8,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'insight',
    content: 'Protected functions that CANNOT be modified via mcp__infra__update_lambda_code: infra-ops (itself), ws-authorizer (security), db-init (schema). All other fable-{stage}-* functions can be read, invoked, and updated. This is enforced at both application level (deny list) and IAM Permission Boundary.',
    tags: ['infra', 'sandboxing', 'security'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'insight',
    content: 'Builder templates live in S3 at s3://{ARTIFACTS_BUCKET}/templates/CLAUDE.md.builder. You can update them via mcp__infra__update_template. The updated version is pulled at the start of each build, falling back to the Docker-baked version if the S3 version is missing.',
    tags: ['infra', 'templates', 'self-modification'],
    importance: 0.8,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'insight',
    content: 'Available mcp__infra__* tools: read_logs (CloudWatch), get_lambda_config (env vars, timeout, memory), get_lambda_code (download source), test_invoke (invoke with payload), describe_ecs_tasks (build task status), update_lambda_code (deploy fix), update_template (update builder template). Use these to diagnose and fix infrastructure issues.',
    tags: ['infra', 'tools', 'capabilities'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'gotcha',
    content: 'Every infrastructure modification via mcp__infra__update_lambda_code or mcp__infra__update_template is logged to the audit trail in DynamoDB (PK=AUDIT#infra). The reason field is required — always explain why the change is needed.',
    tags: ['infra', 'audit', 'security'],
    importance: 0.7,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },

  // ============================
  // UI Definition & Workflow Output
  // ============================
  {
    type: 'pattern',
    content: `ToolUIDefinition schema for output.json — each tool can include a uiDefinition for automatic UI page generation:
{
  "title": "My Tool",
  "subtitle": "Brief tagline",
  "icon": "analytics",  // Material icon name
  "form": {
    "fields": [
      { "key": "text", "label": "Input Text", "widget": "textarea", "placeholder": "Enter text..." },
      { "key": "count", "label": "Max Count", "widget": "number", "min": 1, "max": 100 },
      { "key": "mode", "label": "Mode", "widget": "select", "options": [{"label":"Fast","value":"fast"},{"label":"Thorough","value":"thorough"}] }
    ],
    "submitLabel": "Analyze"
  },
  "resultDisplay": {
    "type": "cards",
    "cards": [
      { "field": "wordCount", "label": "Words", "format": "number", "icon": "format_list_numbered" },
      { "field": "score", "label": "Score", "format": "percent", "icon": "trending_up" }
    ],
    "summaryTemplate": "Analyzed {{wordCount}} words with {{score}} confidence"
  },
  "examples": [
    { "label": "Simple text", "input": { "text": "hello world" } }
  ]
}`,
    tags: ['ui', 'schema', 'builder', 'output'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'pattern',
    content: `WorkflowDefinition format for output.json — include a workflows array to create automations:
{
  "name": "Daily Report",
  "description": "Runs analysis daily and reports results",
  "prompt": "Use my-tool to analyze the latest data and summarize the results",
  "tools": ["my-tool"],
  "trigger": { "type": "cron", "schedule": "0 9 * * ? *", "timezone": "America/Los_Angeles" },
  "model": "haiku",
  "maxTurns": 10
}
Workflows are metadata, not code. Just a prompt + tool references + schedule. Created post-deploy by build-completion.`,
    tags: ['workflow', 'schema', 'builder', 'output'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'insight',
    content: 'FABLE builds can produce three deliverable types: tools (Lambda functions — always), UIs (JSON uiDefinition — optional per tool), and workflows (metadata — optional). All three go in output.json. The frontend renders uiDefinitions dynamically without code changes.',
    tags: ['architecture', 'output', 'builder'],
    importance: 0.9,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'pattern',
    content: 'DynamicForm widget types that the frontend supports: text (QInput), textarea (QInput multiline), number (QInput type=number with min/max/step), select (QSelect with options array), toggle (QToggle boolean), slider (QSlider with min/max/step). Map your tool inputs to the most appropriate widget type.',
    tags: ['ui', 'form', 'widgets', 'builder'],
    importance: 0.8,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: 'ResultDisplay types the frontend supports: cards (grid of stat cards with icons, best for numeric results), table (QTable with columns, best for tabular data), text (formatted text output), json (pretty-printed JSON, fallback). Choose the type that best presents your tool results.',
    tags: ['ui', 'results', 'display', 'builder'],
    importance: 0.8,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'insight',
    content: 'FABLE frontend uses Vue 3 + Quasar v2, dark theme, purple (#a855f7) primary color. Components use <script setup lang="ts">, Pinia stores, strict TypeScript. Material icons. Use these conventions when choosing icon names for uiDefinition.',
    tags: ['frontend', 'conventions', 'builder'],
    importance: 0.7,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: 'Tool UI examples — always include 2-3 pre-filled examples in uiDefinition.examples for "try it" buttons. Each example has a label (button text) and input (pre-filled form values). Examples help users understand what the tool does without reading documentation.',
    tags: ['ui', 'examples', 'ux', 'builder'],
    importance: 0.8,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
  },
  {
    type: 'gotcha',
    content: 'uiDefinition is optional — if not provided, the frontend auto-generates a basic form from inputSchema properties. But providing a uiDefinition gives much better UX: custom labels, help text, appropriate widget types, formatted results display, and example buttons. Always include one for user-facing tools.',
    tags: ['ui', 'fallback', 'ux', 'builder'],
    importance: 0.85,
    scope: 'project',
    source: 'user_stated',
    project: 'FABLE',
    pinned: true,
  },
  {
    type: 'pattern',
    content: 'For card-based result displays, use Material icon names like: analytics, trending_up, format_list_numbered, text_fields, speed, sentiment_satisfied, abc, bar_chart, calculate, assessment, insights, psychology. These are rendered by Quasar QIcon component.',
    tags: ['ui', 'icons', 'material', 'builder'],
    importance: 0.7,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
  {
    type: 'pattern',
    content: 'When building tools that need a workflow, think about what should run automatically vs what users trigger manually. Daily analysis/reports = cron workflow. On-demand processing = manual trigger (or just the tool page). Include the workflow in output.json only if automation makes sense for the tool.',
    tags: ['workflow', 'design', 'builder'],
    importance: 0.75,
    scope: 'project',
    source: 'ai_inferred',
    project: 'FABLE',
  },
];

async function createMemoryViaHttp(memory: Memory): Promise<boolean> {
  if (!MEMORY_LAMBDA_URL) throw new Error('MEMORY_LAMBDA_URL not set');

  const response = await fetch(MEMORY_LAMBDA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-fable-build-id': BUILD_ID,
      'x-fable-org-id': ORG_ID,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'memory_create',
        arguments: memory,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`  HTTP ${response.status}: ${text}`);
    return false;
  }

  const result = await response.json();
  if (result.error) {
    console.error(`  Error: ${result.error.message}`);
    return false;
  }

  return true;
}

async function createMemoryViaLambda(memory: Memory): Promise<boolean> {
  // Dynamic import for AWS SDK (only needed for direct invocation)
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const client = new LambdaClient({});

  const response = await client.send(new InvokeCommand({
    FunctionName: MEMORY_LAMBDA_NAME,
    Payload: Buffer.from(JSON.stringify({
      action: 'create',
      payload: memory,
      orgId: ORG_ID,
      userId: '00000000-0000-0000-0000-000000000001',
    })),
  }));

  const result = JSON.parse(Buffer.from(response.Payload!).toString());
  if (result.statusCode !== 200) {
    console.error(`  Lambda error: ${result.body}`);
    return false;
  }

  return true;
}

async function main() {
  console.log(`Seeding ${memories.length} memories...`);
  console.log(`Method: ${useDirect ? 'Direct Lambda invocation' : 'HTTP (Function URL)'}`);
  console.log(`Org: ${ORG_ID}`);
  console.log('');

  if (!useDirect && !MEMORY_LAMBDA_URL) {
    console.error('ERROR: Set MEMORY_LAMBDA_URL or use --direct with MEMORY_LAMBDA_NAME');
    process.exit(1);
  }
  if (useDirect && !MEMORY_LAMBDA_NAME) {
    console.error('ERROR: Set MEMORY_LAMBDA_NAME when using --direct');
    process.exit(1);
  }

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i];
    const label = `[${i + 1}/${memories.length}] ${memory.type}: ${memory.content.slice(0, 60)}...`;
    process.stdout.write(label);

    try {
      const ok = useDirect
        ? await createMemoryViaLambda(memory)
        : await createMemoryViaHttp(memory);

      if (ok) {
        console.log(' OK');
        succeeded++;
      } else {
        console.log(' FAILED');
        failed++;
      }
    } catch (err) {
      console.log(` ERROR: ${err}`);
      failed++;
    }

    // Small delay to avoid throttling
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('');
  console.log(`Done: ${succeeded} succeeded, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
