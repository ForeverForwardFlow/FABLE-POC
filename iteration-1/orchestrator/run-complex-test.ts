#!/usr/bin/env npx tsx
/**
 * Complex Multi-Tool Test
 *
 * Creates a string utilities MCP server with 6 tools running in parallel.
 * This tests the spatial decomposition at higher scale.
 */

import { orchestrate } from './src/index.js';
import { execSync } from 'node:child_process';

function cleanup() {
  console.log('[test] Cleaning up previous test artifacts...');

  const repoRoot = '/Users/simonmoon/Code/FABLE';
  const serverPath = `${repoRoot}/packages/mcp-servers/string-utils`;

  // Remove string-utils from git if it was committed (revert to pre-string-utils state)
  try {
    // Check if string-utils exists in git
    execSync(`git ls-tree -d HEAD packages/mcp-servers/string-utils`, { cwd: repoRoot, stdio: 'pipe' });
    // If we get here, it exists - remove it with git rm
    console.log('[test] Removing string-utils from git...');
    execSync(`git rm -rf packages/mcp-servers/string-utils`, { cwd: repoRoot, stdio: 'pipe' });
    execSync(`git commit -m "test: remove string-utils for clean test run"`, { cwd: repoRoot, stdio: 'pipe' });
  } catch {
    // Directory doesn't exist in git or other error - that's fine
  }

  // Remove from filesystem if it still exists (untracked)
  try {
    execSync(`rm -rf ${serverPath}`, { stdio: 'pipe' });
  } catch {
    // Ignore
  }

  // Clean up worktrees
  try {
    execSync('rm -rf .worktrees', { stdio: 'pipe' });
  } catch {
    // Ignore
  }

  // Clean up any test branches (with new naming pattern including unique IDs)
  try {
    const branches = execSync('git branch --list "feat/*string-utilities*"', { encoding: 'utf-8', cwd: repoRoot });
    for (const branch of branches.split('\n').filter(Boolean)) {
      const branchName = branch.trim().replace('* ', '');
      try {
        execSync(`git branch -D ${branchName}`, { cwd: repoRoot, stdio: 'pipe' });
      } catch {
        // Ignore
      }
    }
  } catch {
    // Ignore
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║     Complex Multi-Tool Test (6 Tools in Parallel)                ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  cleanup();

  // Complex request with 6 tools
  const request = `Create a string utilities MCP server with these tools:

- capitalize tool: Capitalize the first letter of each word in a string
- slugify tool: Convert a string to a URL-safe slug (lowercase, hyphens instead of spaces)
- truncate tool: Truncate a string to a specified length with ellipsis
- count_words tool: Count the number of words in a string
- extract_emails tool: Extract all email addresses from a string using regex
- camel_case tool: Convert a string to camelCase format

The server should be at packages/mcp-servers/string-utils/

Each tool must:
1. Have a Zod input schema
2. Use the auto-registration pattern with registerTool()
3. Have comprehensive tests
4. Handle edge cases (empty strings, null, etc.)`;

  console.log('[test] Request:', request);
  console.log('\n[test] Starting orchestration...\n');

  const startTime = Date.now();

  try {
    const result = await orchestrate(request, {
      maxWorkerTurns: 100,
      workerTimeoutMs: 900000, // 15 minutes
      maxIterations: 10,
      dryRun: false,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '═'.repeat(70));
    console.log('RESULTS');
    console.log('═'.repeat(70));
    console.log(`Status: ${result.status}`);
    console.log(`Message: ${result.message}`);
    console.log(`Duration: ${duration}s`);

    if (result.plan) {
      console.log(`\nPlan: ${result.plan.summary}`);
      console.log(`Tasks: ${result.plan.tasks.length}`);
    }

    if (result.workerResults) {
      console.log('\nWorker Results:');
      let completed = 0, failed = 0, incomplete = 0;
      for (const wr of result.workerResults) {
        const statusIcon = wr.status === 'completed' ? '✓' : wr.status === 'failed' ? '✗' : '○';
        console.log(`  ${statusIcon} ${wr.taskId}: ${wr.status}`);
        if (wr.error) {
          console.log(`    Error: ${wr.error}`);
        }
        if (wr.status === 'completed') completed++;
        else if (wr.status === 'failed') failed++;
        else incomplete++;
      }
      console.log(`\nSummary: ${completed} completed, ${failed} failed, ${incomplete} incomplete`);
    }

    if (result.errors && result.errors.length > 0) {
      console.log('\nErrors:');
      for (const err of result.errors) {
        console.log(`  - ${err}`);
      }
    }

    // Verification
    console.log('\n' + '═'.repeat(70));
    console.log('VERIFICATION');
    console.log('═'.repeat(70));

    if (result.status === 'success') {
      const serverPath = '/Users/simonmoon/Code/FABLE/packages/mcp-servers/string-utils';

      // Restore from git if needed
      try {
        execSync(`git checkout HEAD -- ${serverPath}`, { stdio: 'pipe' });
      } catch {
        // May not exist in git yet
      }

      // Check package.json
      try {
        execSync(`ls ${serverPath}/package.json`, { stdio: 'pipe' });
        console.log('✓ package.json exists');
      } catch {
        console.log('✗ package.json NOT found');
      }

      // Check tool files
      const tools = ['capitalize', 'slugify', 'truncate', 'count_words', 'extract_emails', 'camel_case'];
      for (const tool of tools) {
        try {
          execSync(`ls ${serverPath}/src/tools/${tool}.ts`, { stdio: 'pipe' });
          console.log(`✓ ${tool}.ts exists`);
        } catch {
          console.log(`✗ ${tool}.ts NOT found`);
        }
      }

      // Verify tools/index.ts exists (should be generated by orchestrator)
      try {
        const indexContent = execSync(`cat ${serverPath}/src/tools/index.ts`, { encoding: 'utf-8' });
        if (indexContent.includes("import './") && indexContent.includes(".js'")) {
          console.log('✓ tools/index.ts exists and has valid imports');
        } else {
          console.log('✗ tools/index.ts exists but has invalid imports');
        }
      } catch {
        console.log('✗ tools/index.ts NOT found (orchestrator should generate this)');
      }

      // Verify server-setup.ts imports tools
      try {
        const serverSetup = execSync(`cat ${serverPath}/src/server-setup.ts`, { encoding: 'utf-8' });
        if (serverSetup.includes("import './tools/index.js'")) {
          console.log('✓ server-setup.ts imports tools');
        } else {
          console.log('✗ server-setup.ts missing tools import (orchestrator should add this)');
        }
      } catch {
        console.log('✗ server-setup.ts NOT found');
      }

      // Run build
      console.log('\nRunning build...');
      try {
        execSync('npm install', { cwd: '/Users/simonmoon/Code/FABLE', stdio: 'pipe' });
        execSync(`cd ${serverPath} && npm run build`, { stdio: 'inherit' });
        console.log('✓ Build passed');
      } catch {
        console.log('✗ Build failed');
      }

      // Run tests
      console.log('\nRunning tests...');
      try {
        execSync(`cd ${serverPath} && npm run test`, { stdio: 'inherit' });
        console.log('✓ Tests passed');
      } catch {
        console.log('✗ Tests failed');
      }
    }

    console.log('\n' + '═'.repeat(70));
    console.log(result.status === 'success' ? 'TEST PASSED!' : 'TEST INCOMPLETE');
    console.log('═'.repeat(70) + '\n');

  } catch (error) {
    console.error('[test] Fatal error:', error);
    process.exit(1);
  }
}

main();
