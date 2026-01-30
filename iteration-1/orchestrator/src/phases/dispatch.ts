/**
 * Dispatch Phase
 *
 * Takes planned tasks and dispatches them to Claude Code workers.
 * Each worker runs in an isolated git worktree on its own branch.
 *
 * Uses DAG-based execution: tasks with satisfied dependencies run in parallel.
 */

import type { Task, WorkerResult, OrchestratorConfig } from '@fable/shared';
import { setupWorktree, cleanupWorktree } from '../utils/worktree.js';
import { spawnClaudeCode } from '../utils/claude-code.js';

/**
 * Get tasks that are ready to run (all dependencies satisfied).
 */
function getReadyTasks(
  tasks: Task[],
  completedIds: Set<string>,
  runningIds: Set<string>,
  failedIds: Set<string>
): Task[] {
  return tasks.filter((task) => {
    // Skip if already completed, running, or failed
    if (completedIds.has(task.id) || runningIds.has(task.id) || failedIds.has(task.id)) {
      return false;
    }

    // Check if all dependencies are satisfied
    const depsCompleted = task.dependencies.every((depId) => completedIds.has(depId));
    const depsFailed = task.dependencies.some((depId) => failedIds.has(depId));

    // Ready if all deps completed and none failed
    return depsCompleted && !depsFailed;
  });
}

/**
 * Dispatch workers for all tasks using DAG-based parallel execution.
 *
 * Tasks are executed in parallel when their dependencies are satisfied.
 * This enables spatial decomposition where independent tasks run concurrently.
 *
 * @param tasks - Tasks to dispatch
 * @param config - Orchestrator configuration
 * @returns Results from all workers
 */
export async function dispatchWorkers(
  tasks: Task[],
  config: OrchestratorConfig
): Promise<WorkerResult[]> {
  const results: WorkerResult[] = [];

  const completedIds = new Set<string>();
  const runningIds = new Set<string>();
  const failedIds = new Set<string>();

  // Track completed task branches for dependency chaining
  const completedBranches = new Map<string, string>();

  // Map to track running promises
  const runningPromises = new Map<
    string,
    Promise<{ taskId: string; result: WorkerResult }>
  >();

  console.log(`[dispatch] Starting DAG execution for ${tasks.length} tasks`);

  // Continue until all tasks are processed
  while (completedIds.size + failedIds.size < tasks.length) {
    // Get tasks ready to run
    const readyTasks = getReadyTasks(tasks, completedIds, runningIds, failedIds);

    // Start ready tasks in parallel
    for (const task of readyTasks) {
      console.log(`[dispatch] Starting worker for task: ${task.id}`);
      runningIds.add(task.id);

      // Get base branch from first dependency (if any)
      // This ensures dependent tasks see their dependency's changes
      let baseBranch: string | undefined;
      if (task.dependencies.length > 0) {
        const firstDepId = task.dependencies[0];
        baseBranch = completedBranches.get(firstDepId);
        if (baseBranch) {
          console.log(`[dispatch] Task ${task.id} will branch from ${baseBranch}`);
        }
      }

      const promise = dispatchSingleWorker(task, config, baseBranch)
        .then((result) => ({ taskId: task.id, result }))
        .catch((error) => ({
          taskId: task.id,
          result: {
            taskId: task.id,
            status: 'failed' as const,
            error: error instanceof Error ? error.message : String(error),
          },
        }));

      runningPromises.set(task.id, promise);
    }

    // If nothing is running and nothing is ready, we have a problem (circular deps)
    if (runningPromises.size === 0 && readyTasks.length === 0) {
      const remaining = tasks.filter(
        (t) => !completedIds.has(t.id) && !failedIds.has(t.id)
      );
      console.error(`[dispatch] Deadlock detected! Remaining tasks: ${remaining.map((t) => t.id).join(', ')}`);

      // Mark remaining as failed
      for (const task of remaining) {
        results.push({
          taskId: task.id,
          status: 'failed',
          error: 'Deadlock: unresolvable dependencies',
        });
        failedIds.add(task.id);
      }
      break;
    }

    // Wait for any running task to complete
    if (runningPromises.size > 0) {
      const completed = await Promise.race(runningPromises.values());

      // Remove from running
      runningIds.delete(completed.taskId);
      runningPromises.delete(completed.taskId);

      // Record result
      results.push(completed.result);

      if (completed.result.status === 'completed') {
        completedIds.add(completed.taskId);
        // Store the branch for dependent tasks
        if (completed.result.branch) {
          completedBranches.set(completed.taskId, completed.result.branch);
        }
        console.log(`[dispatch] Task completed: ${completed.taskId}`);
      } else {
        failedIds.add(completed.taskId);
        console.log(`[dispatch] Task failed: ${completed.taskId}`);
      }
    }
  }

  // Log summary
  console.log(`[dispatch] Execution complete: ${completedIds.size} completed, ${failedIds.size} failed`);

  return results;
}

/**
 * Dispatch a single worker for a task.
 *
 * @param task - Task to dispatch
 * @param config - Orchestrator configuration
 * @param baseBranch - Optional base branch to create worktree from (for dependent tasks)
 */
async function dispatchSingleWorker(
  task: Task,
  config: OrchestratorConfig,
  baseBranch?: string
): Promise<WorkerResult> {
  // Setup isolated worktree, branching from baseBranch if provided
  const worktreePath = await setupWorktree(task.branch, baseBranch);

  try {
    // Generate task-specific CLAUDE.md
    const claudeMd = generateTaskClaudeMd(task);

    // Spawn Claude Code CLI with Ralph Wiggum iteration
    const output = await spawnClaudeCode({
      worktreePath,
      claudeMd,
      maxTurns: config.maxWorkerTurns,
      timeoutMs: config.workerTimeoutMs,
      maxIterations: config.maxIterations,
    });

    // Check for completion signal (Ralph Wiggum uses <promise> tags)
    const completed =
      output.includes('<promise>TASK_COMPLETE</promise>') || output.includes('TASK_COMPLETE');

    return {
      taskId: task.id,
      status: completed ? 'completed' : 'incomplete',
      output,
      branch: task.branch,
    };
  } finally {
    // Cleanup worktree (but keep branch)
    await cleanupWorktree(worktreePath);
  }
}

/**
 * Generate task-specific CLAUDE.md content for the worker.
 */
function generateTaskClaudeMd(task: Task): string {
  const criteria = task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join('\n');

  // Generate file ownership instructions if present
  let ownershipInstructions = '';
  if (task.fileOwnership) {
    const canCreate = task.fileOwnership.create.length > 0
      ? `You may CREATE these files:\n${task.fileOwnership.create.map((p) => `- ${p}`).join('\n')}`
      : '';
    const canModify = task.fileOwnership.modify.length > 0
      ? `You may MODIFY these files:\n${task.fileOwnership.modify.map((p) => `- ${p}`).join('\n')}`
      : '';

    ownershipInstructions = `
## File Ownership (IMPORTANT!)

This task uses spatial decomposition. You have EXCLUSIVE ownership of specific files.
Other workers are running in parallel - do NOT touch files outside your ownership.

${canCreate}
${canModify}

DO NOT create or modify any other files! This ensures parallel workers don't conflict.
`;
  }

  return `# Task: ${task.title}

## Context

This is a monorepo with the following structure:
- \`packages/orchestrator/\` - Main orchestrator (do NOT modify)
- \`packages/shared/\` - Shared types and utilities
- \`packages/mcp-servers/\` - MCP server implementations
  - \`template/\` - A working template server with auto-registration pattern

## Objective
${task.description}
${ownershipInstructions}
## Specific Instructions

1. **Use auto-registration pattern**: Tools self-register by calling registerTool() when imported
2. **Use existing patterns**: Look at the template code to understand the patterns
3. **Keep it simple**: This is a POC - implement the minimum viable solution
4. **Commit your work**: Make a git commit when the task is complete

## Acceptance Criteria
${criteria}

## Verification
Before signaling completion, run from the repo root:
\`\`\`bash
npm run build && npm run test && npm run lint
\`\`\`

All commands must exit with code 0.

## When Done
When ALL acceptance criteria pass and verification commands succeed, output:
\`\`\`
<promise>TASK_COMPLETE</promise>
\`\`\`

IMPORTANT: Only output the promise tag when the task is TRULY complete. If tests fail or criteria aren't met, fix the issues first. You are in an iteration loop that will continue until you output the promise tag.
`;
}
