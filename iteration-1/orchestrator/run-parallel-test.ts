#!/usr/bin/env npx tsx
/**
 * Test Spatial Decomposition with Real Workers
 *
 * Creates a math MCP server with 3 tools running in parallel.
 * This tests:
 * - Spatial decomposition in planning
 * - DAG-based parallel dispatch
 * - Auto-generation of tools/index.ts during integration
 */

import { orchestrate } from './src/index.js';
import { execSync } from 'node:child_process';

// Clean up any previous test artifacts
function cleanup() {
  console.log('[test] Cleaning up previous test artifacts...');

  // Remove math server if it exists
  try {
    execSync('rm -rf packages/mcp-servers/math', { stdio: 'pipe' });
  } catch {
    // Ignore if doesn't exist
  }

  // Clean up any lingering worktrees
  try {
    execSync('rm -rf .worktrees', { stdio: 'pipe' });
  } catch {
    // Ignore
  }

  // Clean up test branches
  try {
    const branches = execSync('git branch --list "feat/create-math-*"', { encoding: 'utf-8' });
    for (const branch of branches.split('\n').filter(Boolean)) {
      const branchName = branch.trim().replace('* ', '');
      try {
        execSync(`git branch -D ${branchName}`, { stdio: 'pipe' });
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
  console.log('║     Testing Spatial Decomposition with Real Workers              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  cleanup();

  // Request that triggers spatial decomposition
  const request = `Create a math MCP server with these tools:
- add tool: Add two numbers together
- multiply tool: Multiply two numbers together
- factorial tool: Calculate the factorial of a number

The server should be at packages/mcp-servers/math/`;

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
      for (const wr of result.workerResults) {
        const statusIcon = wr.status === 'completed' ? '✓' : wr.status === 'failed' ? '✗' : '○';
        console.log(`  ${statusIcon} ${wr.taskId}: ${wr.status}`);
        if (wr.error) {
          console.log(`    Error: ${wr.error}`);
        }
      }
    }

    if (result.errors && result.errors.length > 0) {
      console.log('\nErrors:');
      for (const err of result.errors) {
        console.log(`  - ${err}`);
      }
    }

    // Verify the result
    console.log('\n' + '═'.repeat(70));
    console.log('VERIFICATION');
    console.log('═'.repeat(70));

    if (result.status === 'success') {
      // Check if math server exists
      try {
        execSync('ls packages/mcp-servers/math/package.json', { stdio: 'pipe' });
        console.log('✓ Math server package.json exists');
      } catch {
        console.log('✗ Math server package.json NOT found');
      }

      // Check for tool files
      const tools = ['add', 'multiply', 'factorial'];
      for (const tool of tools) {
        try {
          execSync(`ls packages/mcp-servers/math/src/tools/${tool}.ts`, { stdio: 'pipe' });
          console.log(`✓ ${tool}.ts exists`);
        } catch {
          console.log(`✗ ${tool}.ts NOT found`);
        }
      }

      // Check for auto-generated index
      try {
        const indexContent = execSync('cat packages/mcp-servers/math/src/tools/index.ts', { encoding: 'utf-8' });
        if (indexContent.includes('AUTO-GENERATED')) {
          console.log('✓ tools/index.ts is auto-generated');
        } else {
          console.log('○ tools/index.ts exists but not auto-generated');
        }
      } catch {
        console.log('✗ tools/index.ts NOT found');
      }

      // Run build and test
      console.log('\nRunning verification commands...');
      try {
        execSync('cd packages/mcp-servers/math && npm run build', { stdio: 'inherit' });
        console.log('✓ Build passed');
      } catch {
        console.log('✗ Build failed');
      }

      try {
        execSync('cd packages/mcp-servers/math && npm run test', { stdio: 'inherit' });
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
