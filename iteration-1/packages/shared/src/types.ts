/**
 * Core FABLE Types
 */

// ─── Requirements ────────────────────────────────────────────────────────────

export interface Requirements {
  /** Brief summary of the request */
  summary: string;
  /** Detailed description */
  details: string;
  /** Any constraints or limitations */
  constraints: string[];
  /** What must be true for this to be complete */
  acceptanceCriteria: string[];
}

// ─── Planning ────────────────────────────────────────────────────────────────

export interface Plan {
  /** Unique plan identifier */
  id: string;
  /** Brief summary of the plan */
  summary: string;
  /** Tasks to be executed */
  tasks: Task[];
  /** When the plan was created */
  createdAt: string;
}

export interface Task {
  /** Unique task identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** Detailed description of what to do */
  description: string;
  /** Git branch name for this task */
  branch: string;
  /** Task IDs that must complete before this one */
  dependencies: string[];
  /** What must be true for this task to be complete */
  acceptanceCriteria: string[];
  /** Interface contracts with other tasks */
  interfaceContracts: Record<string, string>;
  /**
   * File ownership for spatial decomposition.
   * Specifies which files this task is allowed to create/modify.
   * Enables parallel execution by ensuring no file conflicts between tasks.
   */
  fileOwnership?: {
    /** Files this task is allowed to create (glob patterns) */
    create: string[];
    /** Files this task is allowed to modify (glob patterns) */
    modify: string[];
  };
}

// ─── Worker Results ──────────────────────────────────────────────────────────

export interface WorkerResult {
  /** Task ID this result is for */
  taskId: string;
  /** Completion status */
  status: 'completed' | 'incomplete' | 'failed';
  /** Raw output from the worker */
  output?: string;
  /** Branch the worker worked on */
  branch?: string;
  /** Error message if failed */
  error?: string;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface OrchestratorConfig {
  /** Maximum turns per worker */
  maxWorkerTurns: number;
  /** Worker timeout in milliseconds */
  workerTimeoutMs: number;
  /** Maximum Ralph Wiggum iterations (self-correction loops) */
  maxIterations: number;
  /** If true, plan but don't execute */
  dryRun: boolean;
}

export interface OrchestratorResult {
  /** Overall status */
  status: 'success' | 'failed' | 'incomplete' | 'dry_run';
  /** The plan that was executed */
  plan?: Plan;
  /** Human-readable message */
  message: string;
  /** Results from individual workers */
  workerResults?: WorkerResult[];
  /** Any errors encountered */
  errors?: string[];
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

export interface McpToolDefinition {
  /** Tool name (verb_noun format) */
  name: string;
  /** Tool description */
  description: string;
  /** Zod schema for input validation */
  inputSchema: Record<string, unknown>;
}

export interface McpServerConfig {
  /** Server name */
  name: string;
  /** Server description */
  description: string;
  /** List of tools provided */
  tools: McpToolDefinition[];
}
