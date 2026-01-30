/**
 * Ralph Wiggum Integration
 *
 * Proper integration with the Ralph Wiggum plugin for iterative worker loops.
 * Workers iterate until they output the completion promise or hit max iterations.
 *
 * Ralph Wiggum plugin is cloned from the official repo and loaded via --plugin-dir.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Plugin is stored in ~/.fable/plugins/ralph-wiggum
const PLUGINS_DIR = join(homedir(), '.fable', 'plugins');
const RALPH_PLUGIN_DIR = join(PLUGINS_DIR, 'ralph-wiggum');
const RALPH_REPO_URL = 'https://github.com/anthropics/claude-code.git';

/**
 * Pinned commit hash for the Ralph Wiggum plugin.
 * This ensures consistent behavior and prevents supply chain attacks.
 * Update this hash when intentionally upgrading the plugin version.
 *
 * To update: Check the latest commit on https://github.com/anthropics/claude-code
 * that contains plugins/ralph-wiggum and update this value.
 */
const RALPH_COMMIT_HASH = 'main'; // TODO: Pin to specific commit after initial testing

export interface RalphLoopOptions {
  prompt: string;
  completionPromise: string;
  maxIterations: number;
}

/**
 * Ensure the Ralph Wiggum plugin is installed.
 * Clones from the official repo if not present.
 */
export async function ensureRalphPlugin(): Promise<string> {
  if (existsSync(join(RALPH_PLUGIN_DIR, '.claude-plugin', 'plugin.json'))) {
    console.log('[ralph-wiggum] Plugin already installed');
    return RALPH_PLUGIN_DIR;
  }

  console.log('[ralph-wiggum] Installing plugin from official repo...');

  // Create plugins directory
  mkdirSync(PLUGINS_DIR, { recursive: true });

  // Clone the repo to a temp location and copy just the plugin
  const tempDir = join(PLUGINS_DIR, '.temp-clone');
  try {
    // Clone with sparse checkout to get just the plugin directory
    // If RALPH_COMMIT_HASH is 'main', use shallow clone; otherwise checkout specific commit
    if (RALPH_COMMIT_HASH === 'main') {
      execSync(`git clone --depth 1 --filter=blob:none --sparse "${RALPH_REPO_URL}" "${tempDir}"`, {
        stdio: 'pipe',
      });
    } else {
      // For specific commits, need full clone then checkout
      execSync(`git clone --filter=blob:none --sparse "${RALPH_REPO_URL}" "${tempDir}"`, {
        stdio: 'pipe',
      });
      execSync(`git checkout ${RALPH_COMMIT_HASH}`, {
        cwd: tempDir,
        stdio: 'pipe',
      });
    }
    execSync('git sparse-checkout set plugins/ralph-wiggum', {
      cwd: tempDir,
      stdio: 'pipe',
    });

    // Move the plugin to final location
    const sourceDir = join(tempDir, 'plugins', 'ralph-wiggum');
    if (existsSync(RALPH_PLUGIN_DIR)) {
      rmSync(RALPH_PLUGIN_DIR, { recursive: true });
    }
    execSync(`mv "${sourceDir}" "${RALPH_PLUGIN_DIR}"`, { stdio: 'pipe' });

    console.log('[ralph-wiggum] Plugin installed successfully');
  } finally {
    // Cleanup temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return RALPH_PLUGIN_DIR;
}

/**
 * Get the path to the Ralph Wiggum plugin directory.
 * Throws if not installed.
 */
export function getRalphPluginDir(): string {
  if (!existsSync(join(RALPH_PLUGIN_DIR, '.claude-plugin', 'plugin.json'))) {
    throw new Error('Ralph Wiggum plugin not installed. Call ensureRalphPlugin() first.');
  }
  return RALPH_PLUGIN_DIR;
}

/**
 * Setup Ralph Wiggum state in a worktree directory.
 *
 * Creates the state file that the Stop hook reads to manage iteration.
 * Format matches the official plugin exactly.
 *
 * @param worktreePath - Path to the worktree
 * @param options - Loop configuration
 */
export function setupRalphState(worktreePath: string, options: RalphLoopOptions): void {
  const claudeDir = join(worktreePath, '.claude');
  mkdirSync(claudeDir, { recursive: true });

  // Format completion promise for YAML (quote if not null)
  const completionPromiseYaml =
    options.completionPromise !== 'null' ? `"${options.completionPromise}"` : 'null';

  // Create state file matching official format
  const stateFile = join(claudeDir, 'ralph-loop.local.md');
  const stateContent = `---
active: true
iteration: 1
max_iterations: ${options.maxIterations}
completion_promise: ${completionPromiseYaml}
started_at: "${new Date().toISOString()}"
---

${options.prompt}
`;

  writeFileSync(stateFile, stateContent);
  console.log(`[ralph-wiggum] State file created at ${stateFile}`);
}

/**
 * Check if Ralph loop is still active (state file exists).
 */
export function isRalphLoopActive(worktreePath: string): boolean {
  const stateFile = join(worktreePath, '.claude', 'ralph-loop.local.md');
  return existsSync(stateFile);
}

/**
 * Cleanup Ralph Wiggum state file.
 */
export function cleanupRalphState(worktreePath: string): void {
  const stateFile = join(worktreePath, '.claude', 'ralph-loop.local.md');
  if (existsSync(stateFile)) {
    rmSync(stateFile);
  }
}

/**
 * Test that the Ralph Wiggum plugin is working correctly.
 */
export async function testRalphPlugin(): Promise<boolean> {
  try {
    const pluginDir = await ensureRalphPlugin();

    // Check that required files exist
    const requiredFiles = [
      '.claude-plugin/plugin.json',
      'hooks/hooks.json',
      'hooks/stop-hook.sh',
      'scripts/setup-ralph-loop.sh',
    ];

    for (const file of requiredFiles) {
      if (!existsSync(join(pluginDir, file))) {
        console.error(`[ralph-wiggum] Missing required file: ${file}`);
        return false;
      }
    }

    console.log('[ralph-wiggum] Plugin test passed');
    return true;
  } catch (error) {
    console.error('[ralph-wiggum] Plugin test failed:', error);
    return false;
  }
}
