/**
 * Git Worktree Utilities
 *
 * Manages isolated git worktrees for worker tasks.
 * Each worker gets its own worktree on its own branch.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WORKTREE_BASE = '.worktrees';

/**
 * Valid git branch name pattern.
 * Allows: lowercase letters, numbers, hyphens, underscores, and forward slashes.
 * Must start with a letter or number, end with a letter or number.
 * Prevents command injection by rejecting shell metacharacters.
 */
const VALID_BRANCH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9\-_/]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

/**
 * Validate a branch name to prevent command injection.
 *
 * @param branch - Branch name to validate
 * @throws Error if branch name is invalid
 */
function validateBranchName(branch: string): void {
  if (!branch || branch.length === 0) {
    throw new Error('Branch name cannot be empty');
  }

  if (branch.length > 100) {
    throw new Error('Branch name too long (max 100 characters)');
  }

  if (!VALID_BRANCH_PATTERN.test(branch)) {
    throw new Error(
      `Invalid branch name: "${branch}". Branch names must start and end with alphanumeric characters and contain only letters, numbers, hyphens, underscores, or forward slashes.`
    );
  }

  // Additional checks for git-specific invalid patterns
  if (
    branch.includes('..') ||
    branch.includes('//') ||
    branch.startsWith('/') ||
    branch.endsWith('/')
  ) {
    throw new Error(
      `Invalid branch name: "${branch}". Cannot contain "..", "//", or start/end with "/".`
    );
  }
}

/**
 * Setup a new git worktree for a task.
 *
 * @param branch - Branch name for the worktree
 * @param baseBranch - Optional base branch to create from (default: current HEAD)
 * @returns Path to the worktree directory
 */
export async function setupWorktree(branch: string, baseBranch?: string): Promise<string> {
  // Validate branch name to prevent command injection
  validateBranchName(branch);

  const worktreePath = join(process.cwd(), WORKTREE_BASE, branch);

  // Ensure base directory exists
  mkdirSync(join(process.cwd(), WORKTREE_BASE), { recursive: true });

  // Remove existing worktree if it exists
  if (existsSync(worktreePath)) {
    execSync(`git worktree remove "${worktreePath}" --force`, { stdio: 'pipe' });
  }

  // Delete branch if it exists (to get fresh start from main)
  try {
    execSync(`git branch -D ${branch}`, { stdio: 'pipe' });
  } catch {
    // Branch may not exist, that's ok
  }

  // Create fresh worktree with new branch from base branch (or current HEAD)
  if (baseBranch) {
    validateBranchName(baseBranch);
    execSync(`git worktree add -b ${branch} "${worktreePath}" ${baseBranch}`, { stdio: 'pipe' });
  } else {
    execSync(`git worktree add -b ${branch} "${worktreePath}"`, { stdio: 'pipe' });
  }

  // Verify the worktree is on the correct branch
  const currentBranch = execSync('git branch --show-current', {
    cwd: worktreePath,
    encoding: 'utf-8',
  }).trim();

  if (currentBranch !== branch) {
    throw new Error(`Worktree branch mismatch: expected ${branch}, got ${currentBranch}`);
  }

  console.log(`[worktree] Created worktree at: ${worktreePath} (branch: ${currentBranch})`);
  return worktreePath;
}

/**
 * Cleanup a worktree after task completion.
 * Removes the worktree but keeps the branch.
 *
 * @param worktreePath - Path to the worktree to cleanup
 */
export async function cleanupWorktree(worktreePath: string): Promise<void> {
  if (!existsSync(worktreePath)) {
    console.log(`[worktree] Worktree already removed: ${worktreePath}`);
    return;
  }

  try {
    execSync(`git worktree remove "${worktreePath}" --force`, { stdio: 'pipe' });
    console.log(`[worktree] Removed worktree: ${worktreePath}`);
  } catch (error) {
    // Fallback to manual removal
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(`[worktree] git worktree remove failed (${errMsg}), using fallback removal`);
    rmSync(worktreePath, { recursive: true, force: true });
    execSync('git worktree prune', { stdio: 'pipe' });
    console.log(`[worktree] Removed worktree (fallback): ${worktreePath}`);
  }
}

/**
 * List all active worktrees.
 */
export async function listWorktrees(): Promise<string[]> {
  const output = execSync('git worktree list --porcelain', { encoding: 'utf-8' });
  const paths = output
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.replace('worktree ', ''));
  return paths;
}
