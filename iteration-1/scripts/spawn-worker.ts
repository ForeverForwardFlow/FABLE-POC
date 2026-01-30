#!/usr/bin/env npx tsx
/**
 * Spawn Worker Script
 *
 * Manually spawn a Claude Code worker for testing.
 * Usage: npx tsx scripts/spawn-worker.ts --task "description"
 */

import { parseArgs } from 'node:util';
import { spawnClaudeCode } from '../packages/orchestrator/src/utils/claude-code.js';
import { setupWorktree, cleanupWorktree } from '../packages/orchestrator/src/utils/worktree.js';

const { values } = parseArgs({
  options: {
    task: { type: 'string', short: 't' },
    branch: { type: 'string', short: 'b', default: 'test/manual-worker' },
    'max-turns': { type: 'string', default: '50' },
    'timeout-ms': { type: 'string', default: '600000' },
    'keep-worktree': { type: 'boolean', default: false },
  },
});

if (!values.task) {
  console.error('Usage: npx tsx scripts/spawn-worker.ts --task "description"');
  console.error('');
  console.error('Options:');
  console.error('  --task, -t        Task description (required)');
  console.error('  --branch, -b      Branch name (default: test/manual-worker)');
  console.error('  --max-turns       Max turns (default: 50)');
  console.error('  --timeout-ms      Timeout in ms (default: 600000)');
  console.error('  --keep-worktree   Keep worktree after completion');
  process.exit(1);
}

async function main() {
  const branch = values.branch!;
  const task = values.task!;
  const maxTurns = parseInt(values['max-turns']!, 10);
  const timeoutMs = parseInt(values['timeout-ms']!, 10);

  console.log(`[spawn-worker] Setting up worktree for branch: ${branch}`);
  const worktreePath = await setupWorktree(branch);

  const claudeMd = `# Manual Worker Task

## Objective
${task}

## Acceptance Criteria
- [ ] Task completed as described
- [ ] Code compiles (if applicable)
- [ ] Tests pass (if applicable)

## When Done
Output: TASK_COMPLETE
`;

  try {
    console.log(`[spawn-worker] Starting Claude Code with max ${maxTurns} turns`);
    const output = await spawnClaudeCode({
      worktreePath,
      claudeMd,
      maxTurns,
      timeoutMs,
    });

    const completed = output.includes('TASK_COMPLETE');
    console.log(`[spawn-worker] Worker ${completed ? 'completed' : 'did not complete'}`);

    if (!completed) {
      console.log('[spawn-worker] Output:', output.slice(-1000));
    }
  } finally {
    if (!values['keep-worktree']) {
      console.log(`[spawn-worker] Cleaning up worktree`);
      await cleanupWorktree(worktreePath);
    } else {
      console.log(`[spawn-worker] Keeping worktree at: ${worktreePath}`);
    }
  }
}

main().catch((error) => {
  console.error('[spawn-worker] Error:', error.message);
  process.exit(1);
});
