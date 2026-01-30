/**
 * FABLE Knowledge Graph Schema (Simplified)
 *
 * Start simple, add complexity only when genuine needs emerge.
 *
 * 3 Node Types: Process, File, Tool
 * 5 Edge Types: spawns, owns, implements, tests, verified_by
 */

// ============ NODES ============

interface BaseNode {
  id: string;
  type: string;
  created_at: string;
  created_by: string; // process ID that created this node
}

// Process nodes - the actors (CORE, OI, Workers)
interface ProcessNode extends BaseNode {
  type: 'process';
  role: 'CORE' | 'OI' | 'WORKER';
  status: 'running' | 'completed' | 'failed';
  parent_id?: string;
}

// File nodes - source artifacts
interface FileNode extends BaseNode {
  type: 'file';
  path: string;
  category: 'source' | 'test' | 'config' | 'spec';
}

// Tool nodes - what we're building
interface ToolNode extends BaseNode {
  type: 'tool';
  name: string;
  description: string;
  input_schema?: string;  // inline Zod schema or type definition
  output_schema?: string;
}

type Node = ProcessNode | FileNode | ToolNode;

// ============ EDGES ============

interface BaseEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  created_at: string;
  created_by: string;
}

// Process spawns Process
interface SpawnsEdge extends BaseEdge {
  relation: 'spawns';
}

// Process owns File (exclusive access during execution)
interface OwnsEdge extends BaseEdge {
  relation: 'owns';
}

// File implements Tool
interface ImplementsEdge extends BaseEdge {
  relation: 'implements';
}

// File tests File (test file → source file)
interface TestsEdge extends BaseEdge {
  relation: 'tests';
}

// Graph verified_by command (build, test, lint)
interface VerifiedByEdge extends BaseEdge {
  relation: 'verified_by';
  command: string;      // e.g., "npm run build"
  status: 'pass' | 'fail';
  details?: string;     // e.g., "35 tests passed"
}

type Edge = SpawnsEdge | OwnsEdge | ImplementsEdge | TestsEdge | VerifiedByEdge;

// ============ THE GRAPH ============

interface KnowledgeGraph {
  id: string;              // unique execution ID
  request: string;         // original user request
  root_process: string;    // CORE process ID
  package_path: string;    // e.g., "packages/math-utils"

  started_at: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'failed';

  nodes: Node[];
  edges: Edge[];
}

// ============ VALIDATION INVARIANTS ============

/**
 * CORE validates these before completing:
 *
 * 1. Every Tool has a File with 'implements' edge pointing to it
 * 2. Every source File has a test File with 'tests' edge pointing to it
 * 3. No File has multiple 'owns' edges (ownership conflict)
 * 4. Graph has at least one 'verified_by' edge with status: 'pass'
 */

export type {
  Node, Edge, KnowledgeGraph,
  ProcessNode, FileNode, ToolNode,
  SpawnsEdge, OwnsEdge, ImplementsEdge, TestsEdge, VerifiedByEdge
};
