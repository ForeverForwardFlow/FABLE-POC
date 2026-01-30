/**
 * FABLE Self-Extending Loop Demo
 *
 * Demonstrates the complete cycle:
 * 1. Request a new capability
 * 2. Orchestrator plans and dispatches workers
 * 3. Workers build an MCP server
 * 4. Integration merges and verifies
 * 5. FABLE uses the newly-built capability
 *
 * Run with: npx tsx src/demo.ts
 */

import { orchestrate } from './index.js';
import { discoverMcpServers, useBuiltTool } from './utils/mcp-client.js';
import { resolve } from 'node:path';

/**
 * Demonstrate using an existing MCP server (greeting).
 */
async function demoExistingCapability(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('DEMO: Using Existing Capability (greeting server)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const basePath = resolve(process.cwd(), '../mcp-servers');
  const servers = discoverMcpServers(basePath);

  console.log(`[demo] Discovered ${servers.length} MCP server(s):`);
  for (const server of servers) {
    console.log(`  - ${server.name} (${server.packageJson.name})`);
  }

  if (servers.length === 0) {
    console.log('[demo] No MCP servers found. Run "npm run build" in packages/mcp-servers first.');
    return;
  }

  // Use the greeting server's tools
  const greetingServer = servers.find((s) => s.name === 'greeting');
  if (greetingServer) {
    console.log('\n[demo] Calling greet tool...');
    const greetResult = await useBuiltTool('greeting', 'greet', { name: 'FABLE' }, basePath);
    console.log('[demo] greet result:', greetResult);

    console.log('\n[demo] Calling uppercase tool...');
    const uppercaseResult = await useBuiltTool(
      'greeting',
      'uppercase',
      { text: 'self-extending ai' },
      basePath
    );
    console.log('[demo] uppercase result:', uppercaseResult);

    console.log('\n[demo] Calling reverse tool...');
    const reverseResult = await useBuiltTool('greeting', 'reverse', { text: 'FABLE' }, basePath);
    console.log('[demo] reverse result:', reverseResult);

    console.log('\n[demo] Calling countdown tool...');
    const countdownResult = await useBuiltTool('greeting', 'countdown', { start: 5 }, basePath);
    console.log('[demo] countdown result:', countdownResult);
  }
}

/**
 * Demonstrate the orchestration dry-run mode.
 */
async function demoPlanning(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('DEMO: Planning Mode (dry run)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Example request for a new MCP server
  const request = `Create an MCP server for weather data.
Include tools for:
- get_current_weather: Fetch current weather for a city
- get_forecast: Get 5-day forecast for a city

The server should use the OpenWeatherMap API.`;

  console.log('[demo] Request:', request);
  console.log('\n[demo] Running orchestration in dry-run mode...\n');

  const result = await orchestrate(request, { dryRun: true });

  console.log('[demo] Result status:', result.status);
  console.log('[demo] Message:', result.message);

  if (result.plan) {
    console.log('\n[demo] Generated Plan:');
    console.log(`  ID: ${result.plan.id}`);
    console.log(`  Summary: ${result.plan.summary}`);
    console.log(`  Tasks (${result.plan.tasks.length}):`);

    for (const task of result.plan.tasks) {
      console.log(`\n    [${task.id}]`);
      console.log(`    Title: ${task.title}`);
      console.log(`    Branch: ${task.branch}`);
      console.log(
        `    Dependencies: ${task.dependencies.length > 0 ? task.dependencies.join(', ') : 'none'}`
      );
      console.log(`    Acceptance Criteria:`);
      for (const criteria of task.acceptanceCriteria) {
        console.log(`      - ${criteria}`);
      }
    }
  }
}

/**
 * Demonstrate the full self-extending loop concept.
 */
async function demoSelfExtendingLoop(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('DEMO: Self-Extending Loop (Conceptual)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log(`The self-extending loop works as follows:

1. USER REQUEST
   "Create an MCP server for Slack integration"

2. ORCHESTRATOR PLANS
   - Requirements gathered (clarifications if needed)
   - Plan created with extended thinking
   - Tasks generated with dependencies

3. WORKERS BUILD
   - Git worktree created per task
   - Claude Code CLI builds the server
   - Ralph Wiggum plugin ensures completion

4. INTEGRATION
   - Branches merged in dependency order
   - Build and test suite runs
   - Worktrees cleaned up

5. CAPABILITY AVAILABLE
   - New MCP server at packages/mcp-servers/slack/
   - Orchestrator can now use Slack tools
   - Future requests can leverage Slack integration

This POC demonstrates steps 1-4 with the greeting server as proof
that the pattern works. The greeting server was built manually but
represents what workers would produce.

To see it in action:
  - Run this demo to see existing capabilities being used
  - Run with --plan to see how orchestration breaks down requests
  - In production: workers build real servers from scratch
`);
}

/**
 * Main demo entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showPlan = args.includes('--plan');
  const showLoop = args.includes('--loop');
  const showAll = args.length === 0;

  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           FABLE - Self-Extending AI Platform Demo                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  try {
    if (showAll || args.includes('--existing')) {
      await demoExistingCapability();
    }

    if (showAll || showPlan) {
      await demoPlanning();
    }

    if (showAll || showLoop) {
      await demoSelfExtendingLoop();
    }

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('Demo complete!');
    console.log('═══════════════════════════════════════════════════════════════════\n');
  } catch (error) {
    console.error('[demo] Error:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[demo] Fatal error:', error);
  process.exit(1);
});
