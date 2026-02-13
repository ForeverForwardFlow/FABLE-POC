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
