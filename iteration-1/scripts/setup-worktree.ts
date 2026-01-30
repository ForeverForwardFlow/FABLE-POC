#!/usr/bin/env npx tsx
/**
 * Setup Worktree Script
 *
 * Create a git worktree for manual testing.
 * Usage: npx tsx scripts/setup-worktree.ts --branch "feat/test"
 */

import { parseArgs } from 'node:util';
import {
  setupWorktree,
  listWorktrees,
  cleanupWorktree,
} from '../packages/orchestrator/src/utils/worktree.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    branch: { type: 'string', short: 'b' },
    list: { type: 'boolean', short: 'l' },
    cleanup: { type: 'string', short: 'c' },
  },
});

async function main() {
  // List worktrees
  if (values.list) {
    const worktrees = await listWorktrees();
    console.log('Active worktrees:');
    for (const wt of worktrees) {
      console.log(`  ${wt}`);
    }
    return;
  }

  // Cleanup worktree
  if (values.cleanup) {
    await cleanupWorktree(values.cleanup);
    console.log(`Cleaned up: ${values.cleanup}`);
    return;
  }

  // Create worktree
  const branch = values.branch || positionals[0];
  if (!branch) {
    console.error('Usage: npx tsx scripts/setup-worktree.ts --branch "feat/test"');
    console.error('       npx tsx scripts/setup-worktree.ts --list');
    console.error('       npx tsx scripts/setup-worktree.ts --cleanup /path/to/worktree');
    process.exit(1);
  }

  const path = await setupWorktree(branch);
  console.log(`Worktree created at: ${path}`);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
