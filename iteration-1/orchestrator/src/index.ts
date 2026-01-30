/**
 * FABLE Orchestrator
 *
 * Main entry point for the orchestration system.
 * Receives user requests, plans work, dispatches workers, integrates results.
 */

import { gatherRequirements } from './phases/requirements.js';
import { createPlan } from './phases/planning.js';
import { dispatchWorkers } from './phases/dispatch.js';
import { integrateResults } from './phases/integrate.js';
import type { OrchestratorResult, OrchestratorConfig } from '@fable/shared';

/**
 * Parse and validate an integer environment variable.
 *
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Validated integer value
 */
function parseEnvInt(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    console.warn(`[orchestrator] Invalid ${name}="${raw}", using default: ${defaultValue}`);
    return defaultValue;
  }

  if (parsed < min || parsed > max) {
    console.warn(
      `[orchestrator] ${name}=${parsed} out of range [${min}, ${max}], clamping to valid range`
    );
    return Math.max(min, Math.min(max, parsed));
  }

  return parsed;
}

const defaultConfig: OrchestratorConfig = {
  maxWorkerTurns: parseEnvInt('MAX_WORKER_TURNS', 50, 1, 500),
  workerTimeoutMs: parseEnvInt('WORKER_TIMEOUT_MS', 600000, 10000, 3600000), // 10s - 1hr
  maxIterations: parseEnvInt('MAX_ITERATIONS', 10, 1, 50),
  dryRun: false,
};

/**
 * Main orchestration function.
 *
 * @param request - Natural language request from user
 * @param config - Optional configuration overrides
 * @returns Result of orchestration including status and any outputs
 */
export async function orchestrate(
  request: string,
  config: Partial<OrchestratorConfig> = {}
): Promise<OrchestratorResult> {
  const cfg = { ...defaultConfig, ...config };

  console.log('[orchestrator] Starting orchestration for request:', request);

  // Phase 1: Gather requirements (may involve clarifying questions)
  const requirements = await gatherRequirements(request);
  console.log('[orchestrator] Requirements gathered:', requirements.summary);

  // Phase 2: Create plan with extended thinking
  const plan = await createPlan(requirements);
  console.log('[orchestrator] Plan created with', plan.tasks.length, 'tasks');

  if (cfg.dryRun) {
    return {
      status: 'dry_run',
      plan,
      message: 'Dry run complete - no workers dispatched',
    };
  }

  // Phase 3: Dispatch workers
  const workerResults = await dispatchWorkers(plan.tasks, cfg);
  console.log('[orchestrator] Workers completed:', workerResults.length);

  // Phase 4: Integrate results
  const result = await integrateResults(workerResults, plan);
  console.log('[orchestrator] Integration complete:', result.status);

  return result;
}

export { gatherRequirements, createPlan, dispatchWorkers, integrateResults };
export type { OrchestratorResult, OrchestratorConfig };

// MCP Client utilities for self-use
export {
  discoverMcpServers,
  connectToMcpServer,
  listTools,
  callTool,
  disconnectFromMcpServer,
  useBuiltTool,
} from './utils/mcp-client.js';
export type { McpServer, McpConnection } from './utils/mcp-client.js';
