/**
 * Integration Phase
 *
 * Takes results from workers and integrates them:
 * - Merge worker branches in dependency order
 * - Run full test suite
 * - Handle merge conflicts
 * - Clean up worktrees
 */

import { execSync } from 'node:child_process';
import { readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import type { WorkerResult, Plan, OrchestratorResult, Task } from '@fable/shared';
import { cleanupWorktree } from '../utils/worktree.js';
import { join } from 'node:path';

const WORKTREE_BASE = '.worktrees';

/**
 * Result of a single branch merge operation.
 */
interface MergeResult {
  branch: string;
  success: boolean;
  error?: string;
}

/**
 * Run a shell command and return success/failure.
 *
 * @param command - Command to execute
 * @param options - execSync options
 * @returns true if command succeeded, false otherwise
 */
function runCommand(
  command: string,
  options: { cwd?: string } = {}
): { success: boolean; output: string } {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: 'pipe',
      ...options,
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    const err = error as { stderr?: Buffer; stdout?: Buffer; message: string };
    const stderr = err.stderr?.toString() || err.message;
    return { success: false, output: stderr };
  }
}

/**
 * Sort tasks by dependency order (topological sort).
 * Tasks with no dependencies come first.
 *
 * @param tasks - Tasks to sort
 * @returns Sorted tasks
 */
function sortByDependencies(tasks: Task[]): Task[] {
  const sorted: Task[] = [];
  const visited = new Set<string>();
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  function visit(task: Task) {
    if (visited.has(task.id)) return;
    visited.add(task.id);

    // Visit dependencies first
    for (const depId of task.dependencies) {
      const dep = taskMap.get(depId);
      if (dep) visit(dep);
    }

    sorted.push(task);
  }

  for (const task of tasks) {
    visit(task);
  }

  return sorted;
}

/**
 * Clean untracked files that would conflict with a merge.
 *
 * @param branch - Branch to check for conflicts
 * @returns List of files that were cleaned
 */
function cleanConflictingUntrackedFiles(branch: string): string[] {
  // Get list of files that would be added/modified by the merge
  const diffResult = runCommand(`git diff --name-only HEAD...${branch}`);
  if (!diffResult.success) {
    return [];
  }

  const branchFiles = new Set(diffResult.output.split('\n').filter(Boolean));

  // Get untracked files
  const statusResult = runCommand('git status --porcelain');
  if (!statusResult.success) {
    return [];
  }

  const cleaned: string[] = [];
  const lines = statusResult.output.split('\n').filter(Boolean);

  for (const line of lines) {
    // Untracked files start with '??'
    if (line.startsWith('??')) {
      const file = line.slice(3).trim();
      if (branchFiles.has(file)) {
        // This untracked file would conflict with the merge
        console.log(`[integrate] Removing conflicting untracked file: ${file}`);
        const rmResult = runCommand(`rm -f "${file}"`);
        if (rmResult.success) {
          cleaned.push(file);
        }
      }
    }
  }

  return cleaned;
}

/**
 * Merge a single branch into the current branch.
 *
 * @param branch - Branch name to merge
 * @returns Merge result
 */
async function mergeBranch(branch: string): Promise<MergeResult> {
  console.log(`[integrate] Merging branch: ${branch}`);

  // Check if branch exists
  const branchCheck = runCommand(`git rev-parse --verify ${branch}`);
  if (!branchCheck.success) {
    return { branch, success: false, error: `Branch ${branch} does not exist` };
  }

  // Check if there are any commits to merge
  const mergeBase = runCommand(`git merge-base HEAD ${branch}`);
  const branchHead = runCommand(`git rev-parse ${branch}`);

  if (mergeBase.success && branchHead.success && mergeBase.output === branchHead.output) {
    console.log(`[integrate] Branch ${branch} already merged or no changes`);
    return { branch, success: true };
  }

  // Clean any untracked files that would conflict with the merge
  const cleanedFiles = cleanConflictingUntrackedFiles(branch);
  if (cleanedFiles.length > 0) {
    console.log(`[integrate] Cleaned ${cleanedFiles.length} conflicting untracked file(s)`);
  }

  // Attempt merge with no-edit to avoid interactive prompts
  const mergeResult = runCommand(`git merge ${branch} --no-edit -m "Merge ${branch}"`);

  if (!mergeResult.success) {
    // Check if it's a merge conflict
    const statusResult = runCommand('git status --porcelain');
    if (statusResult.output.includes('UU') || statusResult.output.includes('AA')) {
      // Abort the merge
      runCommand('git merge --abort');
      return {
        branch,
        success: false,
        error: `Merge conflict in branch ${branch}. Manual resolution required.`,
      };
    }
    return { branch, success: false, error: `Failed to merge ${branch}: ${mergeResult.output}` };
  }

  console.log(`[integrate] Successfully merged ${branch}`);
  return { branch, success: true };
}

/**
 * Run the test suite to verify integration.
 *
 * @returns Test result
 */
async function runIntegrationTests(): Promise<{ success: boolean; output: string }> {
  console.log('[integrate] Running integration tests...');

  // Run build first
  const buildResult = runCommand('npm run build');
  if (!buildResult.success) {
    return { success: false, output: `Build failed: ${buildResult.output}` };
  }

  // Run tests
  const testResult = runCommand('npm run test');
  return testResult;
}

/**
 * Clean up worktrees for completed tasks.
 *
 * @param tasks - Tasks whose worktrees should be cleaned
 */
async function cleanupWorktrees(tasks: Task[]): Promise<void> {
  console.log('[integrate] Cleaning up worktrees...');

  for (const task of tasks) {
    const worktreePath = join(process.cwd(), WORKTREE_BASE, task.branch);
    try {
      await cleanupWorktree(worktreePath);
    } catch (error) {
      // Log but don't fail on cleanup errors
      console.warn(`[integrate] Failed to cleanup worktree for ${task.branch}:`, error);
    }
  }
}

/**
 * Auto-generate tools/index.ts for MCP servers.
 *
 * Scans the tools directory and generates imports for all tool files.
 * This enables the auto-registration pattern where tools self-register when imported.
 *
 * @param serverPath - Path to the MCP server package
 * @returns true if generation successful, false otherwise
 */
function generateToolsIndex(serverPath: string): { success: boolean; error?: string } {
  const toolsDir = join(serverPath, 'src', 'tools');
  const serverName = serverPath.split('/').pop();

  // Skip if no tools directory
  if (!existsSync(toolsDir)) {
    console.log(`[integrate] ${serverName}: no tools directory`);
    return { success: true }; // Not an error, just no tools
  }

  try {
    // Get all .ts files in tools directory
    const files = readdirSync(toolsDir)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .sort(); // Sort for consistent output

    console.log(`[integrate] ${serverName}: found ${files.length} tool file(s): ${files.join(', ')}`);

    if (files.length === 0) {
      return { success: true }; // No tools to import
    }

    // Generate the index file content
    const imports = files.map((f) => {
      const name = f.replace('.ts', '.js');
      return `import './${name}';`;
    });

    const content = `/**
 * Tool Loader (AUTO-GENERATED)
 *
 * This file imports all tool files to trigger their self-registration.
 * DO NOT EDIT - regenerated during integration.
 */

// Import tools to trigger registration
${imports.join('\n')}
`;

    const indexPath = join(toolsDir, 'index.ts');
    writeFileSync(indexPath, content, 'utf-8');

    console.log(`[integrate] Generated ${indexPath} with ${files.length} tool(s)`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Update server-setup.ts to import tools/index.js.
 *
 * This ensures the auto-registration pattern works by importing all tools.
 *
 * @param serverPath - Path to the MCP server package
 * @returns true if update successful, false otherwise
 */
function updateServerSetupImport(serverPath: string): { success: boolean; error?: string } {
  const serverSetupPath = join(serverPath, 'src', 'server-setup.ts');
  const toolsIndexPath = join(serverPath, 'src', 'tools', 'index.ts');

  // Skip if no server-setup.ts or tools/index.ts
  if (!existsSync(serverSetupPath) || !existsSync(toolsIndexPath)) {
    return { success: true };
  }

  try {
    const content = readFileSync(serverSetupPath, 'utf-8');

    // Check if import already exists
    if (content.includes("import './tools/index.js'")) {
      return { success: true }; // Already has the import
    }

    // Find a good place to add the import (after other imports, before code)
    // Look for the tool-registry import and add before it
    const importLine = "// Import tools to trigger registration\nimport './tools/index.js';\n\n";

    let updatedContent: string;
    if (content.includes("import { getRegisteredTools")) {
      // Add before tool-registry import
      updatedContent = content.replace(
        "import { getRegisteredTools",
        importLine + "import { getRegisteredTools"
      );
    } else if (content.includes("from './tool-registry.js'")) {
      // Alternative: add before any tool-registry import
      updatedContent = content.replace(
        /import.*from '\.\/tool-registry\.js';/,
        importLine + "$&"
      );
    } else {
      // Fallback: add after the last import statement
      const lastImportMatch = content.match(/^import .+;$/m);
      if (lastImportMatch) {
        const lastImportIndex = content.lastIndexOf(lastImportMatch[0]) + lastImportMatch[0].length;
        updatedContent =
          content.slice(0, lastImportIndex) +
          '\n\n' + importLine.trim() +
          content.slice(lastImportIndex);
      } else {
        return { success: false, error: 'Could not find suitable location for import' };
      }
    }

    writeFileSync(serverSetupPath, updatedContent, 'utf-8');
    console.log(`[integrate] Updated ${serverSetupPath} with tools import`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get the git repository root directory.
 */
function getGitRoot(): string {
  const result = runCommand('git rev-parse --show-toplevel');
  if (result.success) {
    return result.output;
  }
  // Fallback to cwd
  return process.cwd();
}

/**
 * Find and regenerate tools/index.ts for all affected MCP servers.
 * Also updates server-setup.ts to import the tools.
 *
 * @returns List of errors if any
 */
function regenerateToolsIndexes(): string[] {
  const errors: string[] = [];

  // Use git root to find mcp-servers regardless of cwd
  const gitRoot = getGitRoot();
  const mcpServersPath = join(gitRoot, 'packages', 'mcp-servers');

  console.log(`[integrate] Looking for MCP servers at ${mcpServersPath}`);

  if (!existsSync(mcpServersPath)) {
    console.log(`[integrate] No mcp-servers directory found at ${mcpServersPath}`);
    return errors; // No MCP servers directory
  }

  // Get all server directories
  const allDirs = readdirSync(mcpServersPath, { withFileTypes: true });
  console.log(`[integrate] Found directories: ${allDirs.map((d) => d.name).join(', ')}`);

  const serverDirs = allDirs
    .filter((d) => d.isDirectory() && d.name !== 'template')
    .map((d) => join(mcpServersPath, d.name));

  console.log(`[integrate] Processing servers: ${serverDirs.map((d) => d.split('/').pop()).join(', ')}`);

  // Track files that were modified
  const modifiedFiles: string[] = [];

  // Regenerate index and update server-setup for each server
  for (const serverPath of serverDirs) {
    // Generate tools/index.ts
    const indexResult = generateToolsIndex(serverPath);
    if (!indexResult.success && indexResult.error) {
      errors.push(`Failed to generate tools/index.ts for ${serverPath}: ${indexResult.error}`);
    } else {
      const indexPath = join(serverPath, 'src', 'tools', 'index.ts');
      if (existsSync(indexPath)) {
        modifiedFiles.push(indexPath);
      }
    }

    // Update server-setup.ts to import tools
    const setupResult = updateServerSetupImport(serverPath);
    if (!setupResult.success && setupResult.error) {
      errors.push(`Failed to update server-setup.ts for ${serverPath}: ${setupResult.error}`);
    } else {
      const setupPath = join(serverPath, 'src', 'server-setup.ts');
      if (existsSync(setupPath)) {
        modifiedFiles.push(setupPath);
      }
    }
  }

  // Commit the generated/updated files if any were changed
  if (errors.length === 0 && modifiedFiles.length > 0) {
    // Use absolute paths for git add to work from any cwd
    const filesToAdd = modifiedFiles.map((f) => `"${f}"`).join(' ');
    const addResult = runCommand(`git add ${filesToAdd}`);
    if (addResult.success) {
      const commitResult = runCommand('git commit -m "Auto-generate tools/index.ts and update server-setup.ts imports"');
      if (commitResult.success) {
        console.log('[integrate] Committed auto-generated files');
      } else {
        console.log(`[integrate] Failed to commit: ${commitResult.output}`);
      }
    } else {
      console.log(`[integrate] Failed to stage files: ${addResult.output}`);
    }
  }

  return errors;
}

/**
 * Integrate worker results into the main branch.
 *
 * @param workerResults - Results from all dispatched workers
 * @param plan - Original plan for context
 * @returns Final orchestration result
 */
export async function integrateResults(
  workerResults: WorkerResult[],
  plan: Plan
): Promise<OrchestratorResult> {
  const errors: string[] = [];

  // Check if any workers failed
  const failed = workerResults.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    return {
      status: 'failed',
      plan,
      message: `${failed.length} worker(s) failed`,
      workerResults,
      errors: failed.map((f) => f.error).filter(Boolean) as string[],
    };
  }

  // Check if any workers incomplete
  const incomplete = workerResults.filter((r) => r.status === 'incomplete');
  if (incomplete.length > 0) {
    return {
      status: 'incomplete',
      plan,
      message: `${incomplete.length} worker(s) did not complete`,
      workerResults,
    };
  }

  console.log('[integrate] All workers completed successfully, starting integration');

  // Get current branch to return to if needed
  const currentBranch = runCommand('git branch --show-current');
  const startingBranch = currentBranch.success ? currentBranch.output : 'main';

  // Sort tasks by dependencies for correct merge order
  const sortedTasks = sortByDependencies(plan.tasks);

  // Ensure we're on main (or the integration target branch)
  const checkoutResult = runCommand(`git checkout ${startingBranch}`);
  if (!checkoutResult.success) {
    errors.push(`Failed to checkout ${startingBranch}: ${checkoutResult.output}`);
    return {
      status: 'failed',
      plan,
      message: 'Failed to prepare for integration',
      workerResults,
      errors,
    };
  }

  // Merge each branch in order
  const mergeResults: MergeResult[] = [];
  for (const task of sortedTasks) {
    const result = await mergeBranch(task.branch);
    mergeResults.push(result);

    if (!result.success) {
      errors.push(result.error || `Unknown error merging ${task.branch}`);
      // Stop on first merge failure
      break;
    }
  }

  // Check if all merges succeeded
  const failedMerges = mergeResults.filter((r) => !r.success);
  if (failedMerges.length > 0) {
    return {
      status: 'failed',
      plan,
      message: `Integration failed: ${failedMerges.length} branch(es) failed to merge`,
      workerResults,
      errors,
    };
  }

  // Auto-generate tools/index.ts for MCP servers
  // This enables the auto-registration pattern
  console.log('[integrate] Regenerating tools/index.ts files...');
  const indexErrors = regenerateToolsIndexes();
  if (indexErrors.length > 0) {
    errors.push(...indexErrors);
    return {
      status: 'failed',
      plan,
      message: 'Failed to auto-generate tools/index.ts',
      workerResults,
      errors,
    };
  }

  // Run integration tests
  const testResult = await runIntegrationTests();
  if (!testResult.success) {
    errors.push(`Integration tests failed: ${testResult.output}`);
    return {
      status: 'failed',
      plan,
      message: 'Integration tests failed after merge',
      workerResults,
      errors,
    };
  }

  console.log('[integrate] Integration tests passed');

  // Clean up worktrees (best effort, don't fail on cleanup errors)
  await cleanupWorktrees(plan.tasks);

  // Delete merged branches (optional cleanup)
  for (const task of sortedTasks) {
    runCommand(`git branch -d ${task.branch}`);
  }

  console.log('[integrate] Integration complete');

  return {
    status: 'success',
    plan,
    message: `Successfully integrated ${sortedTasks.length} task(s) and verified with tests`,
    workerResults,
  };
}
