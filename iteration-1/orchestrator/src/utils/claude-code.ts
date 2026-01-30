/**
 * Claude Code CLI Utilities
 *
 * Spawns Claude Code CLI in headless mode for worker tasks.
 * Uses Ralph Wiggum plugin for iterative self-correction loops.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureRalphPlugin,
  setupRalphState,
  cleanupRalphState,
  isRalphLoopActive,
} from './ralph-wiggum.js';

export interface ClaudeCodeOptions {
  worktreePath: string;
  claudeMd: string;
  maxTurns: number;
  timeoutMs: number;
  maxIterations?: number; // Ralph Wiggum iterations (default: 10)
}

const COMPLETION_PROMISE = 'TASK_COMPLETE';

/**
 * Spawn Claude Code CLI in headless mode with Ralph Wiggum iteration.
 *
 * Uses the official Ralph Wiggum plugin loaded via --plugin-dir.
 * The Stop hook manages iteration until completion promise is detected.
 *
 * @param options - Configuration for the Claude Code instance
 * @returns Output from the Claude Code session
 */
export async function spawnClaudeCode(options: ClaudeCodeOptions): Promise<string> {
  const { worktreePath, claudeMd, maxTurns, timeoutMs, maxIterations = 10 } = options;

  // Ensure Ralph Wiggum plugin is installed
  const pluginDir = await ensureRalphPlugin();

  // Write task-specific CLAUDE.md to worktree
  const claudeMdPath = join(worktreePath, 'CLAUDE.md');
  writeFileSync(claudeMdPath, claudeMd, 'utf-8');

  // Build the prompt for the Ralph loop
  const prompt = `Complete the task described in CLAUDE.md. Follow all instructions carefully.

You are in a Ralph Wiggum iteration loop. The loop will continue until you signal completion.

IMPORTANT - Completion Signal:
When the task is FULLY complete (all acceptance criteria met, tests passing), output:
<promise>${COMPLETION_PROMISE}</promise>

CRITICAL RULES:
- Only output the promise tag when the task is GENUINELY complete
- Do NOT output false statements to exit the loop
- If tests fail, fix them before signaling completion
- The loop will automatically continue if you don't output the promise

Start by reading CLAUDE.md to understand the task.`;

  // Setup Ralph Wiggum state file
  setupRalphState(worktreePath, {
    prompt,
    completionPromise: COMPLETION_PROMISE,
    maxIterations,
  });

  console.log(
    `[claude-code] Starting Ralph loop in ${worktreePath} (max ${maxIterations} iterations, ${maxTurns} turns/iteration)`
  );

  // Spawn Claude with Ralph Wiggum plugin loaded
  const result = spawnSync(
    'claude',
    [
      '-p',
      prompt,
      '--plugin-dir',
      pluginDir,
      '--dangerously-skip-permissions',
      '--max-turns',
      String(maxTurns),
      '--output-format',
      'text',
    ],
    {
      cwd: worktreePath,
      env: {
        ...process.env,
        CLAUDE_CODE_USE_BEDROCK: '1',
      },
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
    }
  );

  // Check if loop completed (state file removed by hook on success)
  const loopActive = isRalphLoopActive(worktreePath);
  if (loopActive) {
    console.log('[claude-code] Ralph loop ended without completion (max iterations or timeout)');
  } else {
    console.log('[claude-code] Ralph loop completed successfully');
  }

  // Cleanup any remaining state
  cleanupRalphState(worktreePath);

  // Log stderr if any
  if (result.stderr) {
    console.error(`[claude-code] stderr: ${result.stderr.slice(0, 500)}`);
  }

  // Handle timeout
  if (result.signal === 'SIGTERM') {
    throw new Error(`Claude Code timed out after ${timeoutMs}ms`);
  }

  // Handle other errors
  if (result.error) {
    throw new Error(`Claude Code error: ${result.error.message}`);
  }

  // Note: Non-zero exit is OK - Ralph loop may exit with error if stopped by hook
  const output = result.stdout || '';
  console.log(`[claude-code] Completed with ${output.length} bytes of output`);

  return output;
}
