# FABLE Documentation - Quick Fixes and Improvements

This document provides specific, copy-paste-ready improvements for FABLE documentation.

---

## 1. ROOT README.md (NEW FILE)

**Path:** `/Users/simonmoon/Code/FABLE/README.md`

````markdown
# FABLE - Forwardflow AI Business Logic Engine

A self-programming AI platform for business automation. The system builds its own capabilities on demand.

**User request → Orchestrator plans → Workers build → Tests pass → FABLE uses the new capability**

## Quick Start

```bash
# Clone and install
git clone https://github.com/forwardflow/FABLE
cd FABLE
npm install

# Verify setup (builds, tests, lints - all should pass)
npm run build && npm run test && npm run lint

# View the architecture
cat CLAUDE.md
```
````

## What It Does

FABLE orchestrates AI workers to build MCP (Model Context Protocol) servers on demand:

1. **Orchestrator** receives a request ("Create an API to fetch weather")
2. **Planning** breaks it into tasks with extended thinking
3. **Workers** (Claude Code CLI) build autonomously in isolated git branches
4. **Integration** merges, tests, and verifies the new capability
5. **Reuse** - New MCP servers are immediately available

This loop repeats, allowing the system to bootstrap increasingly complex capabilities.

## Structure

```
FABLE/
├── packages/
│   ├── orchestrator/     # Plans work, dispatches workers, integrates results
│   ├── shared/           # Shared types, validation, error handling
│   ├── mcp-servers/      # Built capabilities (both templates and examples)
│   │   ├── template/     # Starter template for new servers
│   │   └── greeting/     # Example: 4 tools, full test coverage
│   └── ...
├── .claude/rules/        # Guidance for Claude workers and developers
├── CLAUDE.md             # System overview and architecture
└── README.md             # You are here
```

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** - System design, principles, interfaces
- **[.claude/rules/](./claude/rules/)** - Detailed patterns and constraints
  - `design-principles.md` - Core philosophy
  - `architecture.md` - System design decisions
  - `mcp-patterns.md` - How to build MCP servers
  - `workers.md` - Worker constraints and completion
  - `security.md` - Credential and secret handling
- **[API.md](./API.md)** - API reference (in development)
- **[GETTING_STARTED.md](./GETTING_STARTED.md)** - Step-by-step guide for new developers

## Key Technologies

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 20+
- **Monorepo:** npm workspaces + Turborepo
- **Testing:** Vitest
- **Validation:** Zod
- **MCP SDK:** @modelcontextprotocol/sdk
- **AI:** Claude with extended thinking

## Development

```bash
# Run all tests
npm run test

# Watch mode for active development
npm run test:watch

# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Format code
npm run format
```

## Building a New MCP Server

1. **Copy the template:**

   ```bash
   cp -r packages/mcp-servers/template packages/mcp-servers/my-server
   ```

2. **Follow the pattern in [packages/mcp-servers/greeting/](./packages/mcp-servers/greeting/) for a working example:**
   - `src/tools/*.ts` - One file per tool
   - `src/types.ts` - Zod input schemas
   - `__tests__/*.test.ts` - Test coverage
   - `src/server-setup.ts` - Tool registration

3. **Verify:**
   ```bash
   cd packages/mcp-servers/my-server
   npm run build && npm run test && npm run lint
   ```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) (coming soon)

## How It Works: The Self-Extending Loop

```
┌─────────────────────────────────────────────┐
│  1. User Request                            │
│  "Build a weather API"                      │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  2. Orchestrator Gathers Requirements       │
│  - What's needed?                           │
│  - What are constraints?                    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  3. Planning (with Extended Thinking)       │
│  - Break into tasks                         │
│  - Define interfaces                        │
│  - Identify dependencies                    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  4. Workers Build (Claude Code CLI)         │
│  - Each task in isolated git worktree       │
│  - Follows task-specific CLAUDE.md          │
│  - Iterates until complete (<promise>)      │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  5. Integration & Verification              │
│  - Merge branches                           │
│  - Run full test suite                      │
│  - Verify with npm run build/test/lint      │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  6. New Capability Available                │
│  - MCP server ready for orchestrator        │
│  - Can be used in subsequent requests       │
│  - Loop can now invoke it                   │
└─────────────────────────────────────────────┘
```

## Example: Request Walkthrough

```bash
# Start the orchestrator with a request
npm run orchestrator -- "Create an MCP server for Slack integration"

# Orchestrator:
# 1. Gathers requirements
# 2. Creates plan with tasks:
#    - Task 1: Create MCP server structure
#    - Task 2: Implement Slack API client
#    - Task 3: Create tools (send_message, get_channels, etc.)
# 3. Spawns workers for each task
# 4. Workers build in parallel or sequence
# 5. Integration verifies everything works
# 6. Result: New slack-mcp server available at packages/mcp-servers/slack
```

## Next Steps

- New to FABLE? Start with [GETTING_STARTED.md](./GETTING_STARTED.md)
- Want to understand the system? Read [CLAUDE.md](./CLAUDE.md)
- Building MCP servers? See [packages/mcp-servers/greeting/](./packages/mcp-servers/greeting/)
- Deep dive? Check [.claude/rules/](./claude/rules/)

## Troubleshooting

**npm run build fails: "Cannot find module @fable/shared"**

Run `npm install` from the root directory.

**Tests don't run**

Run `npm run build` first to compile TypeScript.

**Want to understand how Claude workers complete tasks?**

See `/Users/simonmoon/Code/FABLE/packages/orchestrator/src/phases/dispatch.ts` - it shows how task-specific CLAUDE.md is generated.

## POC Status

This is a proof-of-concept demonstrating the self-extending loop. Current focus:

- Prove end-to-end automation works
- Fast iteration over perfect architecture
- Working code over comprehensive tests

Not included in POC:

- Chat UI (orchestrator is CLI-first)
- Multi-tenancy or authentication
- Production monitoring
- Rate limiting

## License

[LICENSE](./LICENSE) (coming soon)

## Questions?

Open an issue or check the documentation in `/Users/simonmoon/Code/FABLE/.claude/rules/`

````

---

## 2. GETTING_STARTED.md (NEW FILE)

**Path:** `/Users/simonmoon/Code/FABLE/GETTING_STARTED.md`

```markdown
# Getting Started with FABLE

A step-by-step guide to understand and develop with FABLE.

## Setup (5 minutes)

### 1. Clone and Install

```bash
git clone https://github.com/forwardflow/FABLE
cd FABLE
npm install
````

### 2. Verify Installation

```bash
npm run build && npm run test && npm run lint
```

All three should exit with code 0 (no output = success).

If something fails, see [Troubleshooting](#troubleshooting) below.

## Understand the System (15 minutes)

FABLE follows a self-extending loop:

```
Request → Requirements → Planning → Workers Build → Integration → New Capability
```

### 1. Read the High-Level Architecture

```bash
cat CLAUDE.md
```

This gives you:

- Design principles
- System components
- Key interfaces
- Verification commands

### 2. Explore the Codebase Structure

```bash
# The orchestrator (the "brain")
ls packages/orchestrator/src/phases/

# Shared types (every interface is documented)
cat packages/shared/src/types.ts

# An example MCP server (reference implementation)
ls packages/mcp-servers/greeting/
```

### 3. Read Detailed Rules

These are formatted for both humans and Claude AI:

```bash
# Core philosophy - why FABLE is designed this way
cat .claude/rules/design-principles.md

# System architecture - key decisions and rationale
cat .claude/rules/architecture.md

# How to build MCP servers
cat .claude/rules/mcp-patterns.md

# What workers must do to complete tasks
cat .claude/rules/workers.md
```

Time investment: ~10 min for design-principles, 15 min for architecture

## Build Your First MCP Server (30 minutes)

MCP servers are "capabilities" that the orchestrator uses. Let's build one.

### 1. Copy the Template

```bash
cp -r packages/mcp-servers/template packages/mcp-servers/hello
cd packages/mcp-servers/hello
```

### 2. Update package.json

```json
{
  "name": "hello",
  "version": "0.1.0",
  ...
}
```

Just change `"name": "template"` to `"name": "hello"`.

### 3. Create Your First Tool

Edit `src/tools/example.ts`:

```typescript
/**
 * Hello Tool
 *
 * A simple tool that returns a greeting.
 */

import { z } from 'zod';

// Input schema - ALWAYS use Zod
export const HelloInput = z.object({
  name: z.string().min(1, 'Name cannot be empty'),
  greeting: z.string().default('Hello'),
});

// Output type
export interface HelloOutput {
  message: string;
  timestamp: string;
}

/**
 * Hello tool implementation.
 *
 * @param input - Validated input
 * @returns Greeting message
 */
export async function helloTool(input: z.infer<typeof HelloInput>): Promise<HelloOutput> {
  const validated = HelloInput.parse(input);

  return {
    message: `${validated.greeting}, ${validated.name}!`,
    timestamp: new Date().toISOString(),
  };
}
```

### 4. Register the Tool

Edit `src/server-setup.ts` - look for where tools are added:

```typescript
import { HelloInput, helloTool } from './tools/example.js';

// In createServer():
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'hello') {
    const result = await helloTool(request.params.arguments);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }

  // ... other tools
});

// In tool definition list:
{
  name: 'hello',
  description: 'Greet someone',
  inputSchema: HelloInput,
}
```

(Copy the exact pattern from greeting/src/server-setup.ts)

### 5. Write a Test

Create `__tests__/hello.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { helloTool, HelloInput } from '../src/tools/hello.js';

describe('helloTool', () => {
  it('should greet the user', async () => {
    const result = await helloTool({ name: 'Alice' });
    expect(result.message).toBe('Hello, Alice!');
    expect(result.timestamp).toBeDefined();
  });

  it('should use custom greeting', async () => {
    const result = await helloTool({ name: 'Bob', greeting: 'Hi' });
    expect(result.message).toBe('Hi, Bob!');
  });

  it('should validate input', async () => {
    expect(() => HelloInput.parse({ name: '' })).toThrow();
  });
});
```

### 6. Build and Test

From the hello/ directory:

```bash
npm run build    # Compile TypeScript
npm run test     # Run tests
npm run lint     # Check code style
```

All should exit with code 0. If not, fix the errors and rerun.

**Congratulations!** You've built your first MCP server. The orchestrator can now use it.

## Understanding Key Concepts

### What is an MCP Server?

Model Context Protocol servers provide "tools" to Claude. Think of them as functions with documented inputs/outputs:

```
MCP Server = Function Library
├── Tool 1: greet(name: string) → string
├── Tool 2: uppercase(text: string) → string
└── Tool 3: countdown(start: number) → string[]
```

FABLE workers build these servers. The orchestrator then uses them.

### What is a Task?

A task is a unit of work that a worker completes. It includes:

- **What to build** (description)
- **How to know you're done** (acceptance criteria)
- **How this connects to other work** (interface contracts)
- **What's already available** (resources)

Workers receive a task-specific CLAUDE.md file (generated by the orchestrator).

### What is a Worker?

A worker is Claude Code CLI running in headless mode. It:

- Runs in an isolated git worktree (one branch per task)
- Reads its task from CLAUDE.md
- Builds code autonomously (no human intervention)
- Signals completion with `<promise>TASK_COMPLETE</promise>`
- Uses the Ralph Wiggum plugin for self-correction loops

### What is Ralph Wiggum?

The Ralph Wiggum plugin is an official Claude plugin that manages iteration:

1. Worker generates output
2. Ralph's "Stop" hook intercepts the exit
3. Checks if output contains `<promise>TASK_COMPLETE</promise>`
4. If not, re-spawns Claude with the same prompt
5. Repeats until promise found or max iterations reached

This enables workers to self-correct without manual retry logic in code.

## Exploring the Greeting Example

The greeting server at `packages/mcp-servers/greeting/` is a complete, working example:

```bash
cd packages/mcp-servers/greeting

# See what tools it provides
cat src/server-setup.ts

# See tool implementations
ls src/tools/      # greet.ts, countdown.ts, uppercase.ts, reverse.ts

# See tests
cat __tests__/greet.test.ts

# Trace through one tool end-to-end
cat src/tools/greet.ts        # Implementation
cat __tests__/greet.test.ts   # How it's tested
```

Copy these patterns when building your own servers.

## Running the Orchestrator

The orchestrator is the "brain" that plans and coordinates work:

```bash
# View orchestrator code
cat packages/orchestrator/src/index.ts

# The orchestrator entry point
# orchestrate(request: string, config?: OrchestratorConfig): Promise<OrchestratorResult>

# Example (when implemented):
# const result = await orchestrate("Create a weather API");
```

Currently, the orchestrator is partially implemented (marked with TODO comments). See `/Users/simonmoon/Code/FABLE/packages/orchestrator/src/phases/` for the current state.

## Understanding Phases

The orchestrator has four phases:

### 1. Requirements Phase

- **Input:** Natural language request
- **Output:** Structured requirements with summary, details, constraints
- **Status:** TODO - Will use Claude Agent SDK

### 2. Planning Phase

- **Input:** Requirements
- **Output:** Plan with tasks, dependencies, and interface contracts
- **Status:** Basic implementation (generates single task)
- **Future:** Will use extended thinking for deep planning

### 3. Dispatch Phase

- **Input:** Tasks from plan
- **Output:** WorkerResults from each task
- **Status:** Implemented - Spawns Claude Code workers
- **Location:** `packages/orchestrator/src/phases/dispatch.ts`

### 4. Integration Phase

- **Input:** WorkerResults
- **Output:** Final OrchestratorResult
- **Status:** Not reviewed (likely TODO)
- **Future:** Merge branches, verify, commit

## Troubleshooting

### "npm run build fails: Cannot find module @fable/shared"

**Problem:** TypeScript can't find shared types.

**Solution:** Run `npm install` from the root FABLE directory.

```bash
cd /path/to/FABLE
npm install
npm run build
```

### "npm run test fails: no tests found"

**Problem:** Tests weren't compiled (TypeScript → JavaScript).

**Solution:** Run build first.

```bash
npm run build
npm run test
```

### "npm run lint fails with style errors"

**Problem:** Code doesn't follow linting rules.

**Solution:** Auto-fix most issues.

```bash
npm run lint:fix
npm run lint  # Run again to verify
```

### "My MCP server tool isn't registered"

**Problem:** Tool not appearing in available tools list.

**Solution:** Check server-setup.ts - tool must be:

1. Imported
2. Added to the tool handlers (in setRequestHandler)
3. Added to the tools list definition

**Reference:** Look at `packages/mcp-servers/greeting/src/server-setup.ts` for the correct pattern.

### "Worker hangs after printing output"

**Problem:** Worker completed work but didn't output completion promise.

**Solution:** Worker must output exactly:

```
<promise>TASK_COMPLETE</promise>
```

**Why:** Ralph Wiggum plugin watches for this. Without it, loop continues up to max iterations.

**Location:** See `packages/orchestrator/src/phases/dispatch.ts` line 122 for where promise is checked.

### "Tests pass but npm run lint fails"

**Problem:** Code passes tests but violates style rules.

**Solution:** Fix style and type issues.

```bash
npm run lint:fix      # Auto-fix most issues
npm run typecheck     # Check TypeScript types
npm run lint          # Verify all fixed
```

### "I'm stuck - where can I get help?"

Options:

1. **Re-read the rules** that apply to you:
   - Building MCP servers? → `.claude/rules/mcp-patterns.md`
   - Working as a worker? → `.claude/rules/workers.md`
   - General questions? → `.claude/rules/design-principles.md`

2. **Study the working example:**
   - `packages/mcp-servers/greeting/`
   - Read the code, tests, and server-setup

3. **Check the types:**
   - `packages/shared/src/types.ts` - Every interface is documented

4. **Look at error messages carefully** - They usually point to the problem

## Next Steps

- **Understand orchestrator:** Read `packages/orchestrator/CLAUDE.md`
- **Build more servers:** Copy template, follow greeting pattern
- **Contribute:** See CONTRIBUTING.md (coming soon)
- **Deep dive:** Read all files in `.claude/rules/`

## Key Files to Know

| File                                         | Purpose           |
| -------------------------------------------- | ----------------- |
| `/Users/simonmoon/Code/FABLE/CLAUDE.md`      | System overview   |
| `/Users/simonmoon/Code/FABLE/.claude/rules/` | Detailed guidance |
| `packages/shared/src/types.ts`               | All interfaces    |
| `packages/shared/src/validation.ts`          | Error handling    |
| `packages/orchestrator/src/index.ts`         | Entry point       |
| `packages/orchestrator/src/phases/`          | Four phases       |
| `packages/mcp-servers/greeting/`             | Working example   |
| `packages/mcp-servers/template/`             | Starter template  |

## Commands Reference

```bash
# Installation
npm install

# Development
npm run build              # Compile TypeScript
npm run test               # Run tests
npm run test:watch        # Watch mode
npm run typecheck         # Type checking
npm run lint              # Lint code
npm run lint:fix          # Auto-fix lint issues
npm run format            # Format code
npm run format:check      # Check formatting

# All at once
npm run build && npm run test && npm run lint

# Individual packages
cd packages/mcp-servers/greeting
npm run test
```

That's it! You now understand FABLE and can build MCP servers.

````

---

## 3. UPDATE orchestrator/CLAUDE.md (REPLACE FILE)

**Path:** `/Users/simonmoon/Code/FABLE/packages/orchestrator/CLAUDE.md`

The file exists but is incomplete. Here's an enhanced version:

```markdown
# Orchestrator Package

The brain of FABLE — receives requests, plans work, dispatches workers, integrates results.

## How It Works

The orchestrator implements a 4-phase loop:

````

Request (string)
↓
[1. Requirements] Gather & clarify requirements
↓ Requirements interface (summary, details, constraints, criteria)
[2. Planning] Create plan with tasks and dependencies
↓ Plan interface (tasks with descriptions, branches, criteria, contracts)
[3. Dispatch] Spawn workers for each task
↓ WorkerResults[] (each task's output and status)
[4. Integration] Merge branches, verify, commit
↓ OrchestratorResult (success/failed, final status)

```

## Structure

```

src/
├── index.ts # Main entry point: orchestrate() function
├── phases/
│ ├── requirements.ts # [1] Gather requirements from user
│ ├── planning.ts # [2] Deep planning with extended thinking
│ ├── dispatch.ts # [3] Spawn workers in git worktrees
│ └── integrate.ts # [4] Merge worker output, verify, commit
└── utils/
├── worktree.ts # Git worktree management
├── claude-code.ts # Spawn Claude Code CLI with Ralph Wiggum
├── ralph-wiggum.ts # Ralph Wiggum plugin management
└── mcp-client.ts # Connect to local/remote MCP servers

````

## Key Functions

### orchestrate(request: string, config?: OrchestratorConfig): Promise<OrchestratorResult>

Main entry point. Orchestrates the entire self-extending loop.

**Parameters:**
- `request`: Natural language description of work to do
- `config`: Optional overrides for maxWorkerTurns, workerTimeoutMs, maxIterations, dryRun

**Returns:** OrchestratorResult with status, plan, workerResults, and errors

**Example:**
```typescript
const result = await orchestrate(
  "Create an MCP server for Slack integration",
  { dryRun: false, maxWorkerTurns: 100 }
);
````

## Phases Explained

### 1. Requirements Phase (gatherRequirements)

**Input:** Natural language request string
**Output:** Requirements interface

- summary: Brief one-liner
- details: Full description
- constraints: Limitations and requirements
- acceptanceCriteria: Checklist of completion requirements

**How it works:**
Currently a placeholder (TODO). Will use Claude Agent SDK to ask clarifying questions if the request is ambiguous.

**Example:**

```
Request: "Create a weather API"
Requirements: {
  summary: "MCP server providing weather data",
  details: "Fetch current weather and forecasts for given locations",
  constraints: ["Must work offline with cached data", "Return JSON"],
  acceptanceCriteria: [
    "Can fetch current weather by location",
    "Can fetch 7-day forecast",
    "Tests pass for all endpoints"
  ]
}
```

### 2. Planning Phase (createPlan)

**Input:** Requirements interface
**Output:** Plan interface with Task[]

**How it works:**
Uses extended thinking (32K-65K tokens) to:

- Decompose work into parallel-friendly tasks
- Define interface contracts between tasks
- Identify dependencies
- Create acceptance criteria for each task

**Spatial decomposition strategy:**
Each task targets a distinct module/directory to minimize merge conflicts:

- Task 1: MCP server structure + data models
- Task 2: API client implementation
- Task 3: Tool implementations using the client
- Task 4: Tests and verification

**Current status:** Basic implementation creates single task. Full implementation pending.

**Example Plan:**

```typescript
{
  id: 'plan-1234',
  summary: 'Create weather MCP server',
  tasks: [
    {
      id: 'task-1',
      title: 'Create MCP server structure',
      description: 'Set up MCP server with types and Zod validation',
      branch: 'feat/weather-server-structure',
      dependencies: [],
      acceptanceCriteria: [
        'npm run build succeeds',
        'Types are properly exported',
        'Validation uses Zod'
      ],
      interfaceContracts: {
        'weather-client': 'export interface WeatherClient { getWeather(lat, lng): Promise<Weather> }'
      }
    },
    {
      id: 'task-2',
      title: 'Implement weather client',
      description: '...',
      branch: 'feat/weather-client',
      dependencies: ['task-1'],
      // ...
    }
  ],
  createdAt: '2026-01-29T...'
}
```

### 3. Dispatch Phase (dispatchWorkers)

**Input:** Plan tasks and OrchestratorConfig
**Output:** WorkerResult[] (one per task)

**How it works:**

1. For each task:
   - Create isolated git worktree on new branch
   - Generate task-specific CLAUDE.md with objective, criteria, resources
   - Spawn Claude Code CLI with Ralph Wiggum plugin
   - Wait for completion (TASK_COMPLETE signal or timeout)
   - Check worker exit status
   - Clean up worktree (keep branch)

**Worker isolation:**

- Each worker runs in `.worktrees/{branch}/`
- Separate git branch prevents merge conflicts
- Workers can't see each other's work until integration
- No network access except Bedrock API

**Ralph Wiggum plugin:**

- Official Claude plugin that manages iteration
- Stop hook intercepts Claude exit
- Checks for `<promise>TASK_COMPLETE</promise>`
- If not found, respawns with same prompt (up to maxIterations)
- This provides self-correcting loops without manual code

**Environment variables:**

- `CLAUDE_CODE_USE_BEDROCK=1` - Use AWS Bedrock (vs local)
- `AWS_REGION` - Bedrock region (e.g., us-west-2)
- `MAX_WORKER_TURNS` - Max turns per iteration (default: 50)
- `WORKER_TIMEOUT_MS` - Timeout in milliseconds (default: 600000 = 10 min)
- `MAX_ITERATIONS` - Max Ralph Wiggum loops (default: 10)

**Current status:** Fully implemented in `src/phases/dispatch.ts`

### 4. Integration Phase (integrateResults)

**Input:** WorkerResult[] and Plan
**Output:** OrchestratorResult

**How it works:**

1. Check if all workers succeeded
2. For each completed task:
   - Merge branch into main (git merge feat/task-1)
   - Verify merge succeeds (no conflicts)
3. Run full verification:
   - `npm run build` - Compile TypeScript
   - `npm run test` - Run all tests
   - `npm run lint` - Check code style
4. If verification passes, commit ("Add: completed tasks")
5. Return overall result

**Verification is critical:**
Workers verify individually (before signaling TASK_COMPLETE).
Orchestrator verifies integration (after merging all tasks).
This prevents half-built code from entering main.

**Current status:** Not reviewed (likely TODO)

## Environment Variables

All orchestrator behavior can be configured:

```bash
# Orchestrator Configuration
MAX_WORKER_TURNS=50              # Max turns per worker iteration
WORKER_TIMEOUT_MS=600000         # Worker timeout in milliseconds (10 min)
MAX_ITERATIONS=10                # Max Ralph Wiggum self-correction loops

# AWS Bedrock (for Claude Code CLI workers)
CLAUDE_CODE_USE_BEDROCK=1        # Use AWS Bedrock instead of local
AWS_REGION=us-west-2             # Bedrock region
```

See `/.env.example` for all variables.

## MCP Client Utilities

The orchestrator can discover and use MCP servers built by workers:

```typescript
import {
  discoverMcpServers, // Find servers in packages/mcp-servers/
  connectToMcpServer, // Connect locally via stdio
  callTool, // Invoke a tool
  disconnectFromMcpServer,
  connectToRemoteMcpServer, // Connect via HTTP (Cloudflare)
  callRemoteTool, // Invoke remote tool
} from './utils/mcp-client.js';
```

**Example:**

```typescript
// Discover and use the greeting server
const servers = discoverMcpServers();
const greeting = servers.find((s) => s.name === 'greeting');

const connection = await connectToMcpServer(greeting);
const result = await callTool(connection.client, 'greet', { name: 'World' });
console.log(result); // { greeting: 'Hello, World!', ... }
await disconnectFromMcpServer(connection);
```

## Testing

```bash
# Run all tests
npm run test

# Watch mode (re-run on changes)
npm run test:watch

# Specific test file
npm run test -- phases/dispatch.test.ts
```

## Verification

Workers verify before signaling completion:

```bash
npm run build && npm run test && npm run lint
```

Orchestrator verifies after integration - same commands.

Only if ALL commands exit 0 is the capability ready for use.

## Key Types

See `packages/shared/src/types.ts` for full definitions:

- `Requirements` - Input requirements
- `Plan` - Planned tasks
- `Task` - Individual unit of work
- `WorkerResult` - Result from one worker
- `OrchestratorResult` - Final orchestration result
- `OrchestratorConfig` - Configuration options

## Future Improvements

- [ ] Full requirements gathering with Claude Agent SDK
- [ ] Extended thinking for planning phase (32K-65K tokens)
- [ ] Parallel task dispatch with dependency detection
- [ ] Advanced merge conflict detection
- [ ] Telemetry and success metrics
- [ ] Rollback on integration failure

````

---

## 4. ENHANCE template/CLAUDE.md

**Path:** `/Users/simonmoon/Code/FABLE/packages/mcp-servers/template/CLAUDE.md`

Add this section before "When Done":

```markdown
## Reference Implementation

See packages/mcp-servers/greeting/ for a complete working example:

- **src/tools/greet.ts** - Tool implementation pattern
- **src/types.ts** - Zod schema patterns
- **src/server-setup.ts** - Tool registration pattern
- **__tests__/greet.test.ts** - Test patterns
- **src/index.ts** - Entry point for stdio transport
- **src/worker.ts** - Entry point for HTTP transport

Copy these patterns exactly. They've been verified to work.

## Tool Implementation Pattern

Every tool follows this structure:

```typescript
/**
 * Tool Name
 *
 * Brief description of what it does.
 */

import { z } from 'zod';

// 1. Input schema with Zod (REQUIRED)
export const ToolInput = z.object({
  param1: z.string().min(1),
  param2: z.number().positive(),
  dry_run: z.boolean().default(false),  // For write operations
});

// 2. Output type
export interface ToolOutput {
  result: string;
  metadata?: Record<string, unknown>;
}

// 3. Implementation with validation
export async function toolName(input: z.infer<typeof ToolInput>): Promise<ToolOutput> {
  const validated = ToolInput.parse(input);

  // For write operations, support dry_run
  if (validated.dry_run) {
    return { result: `Would do: ${validated.param1}` };
  }

  // Implementation here
  return { result: 'done' };
}
````

## Interface Contracts

If your task includes interfaceContracts, maintain these exact interfaces:

```typescript
// Example: If contract says you must export this interface:
export interface AuthContext {
  userId: string;
  role: 'admin' | 'user';
}

// Your implementation must satisfy this contract
// Other tasks depend on it
```

## Error Handling

Do NOT throw exceptions. Return structured errors:

```typescript
import { createMcpErrorResponse } from '@fable/shared';

export async function toolName(input: ...) {
  try {
    // ... implementation
  } catch (error) {
    return createMcpErrorResponse(error);
  }
}
```

The `createMcpErrorResponse` function sanitizes errors (removes emails, tokens, paths).

## Acceptance Criteria Checklist

Before outputting TASK_COMPLETE, verify:

- [ ] Every tool has a Zod input schema
- [ ] Write operations support dry_run parameter
- [ ] No unhandled exceptions thrown
- [ ] All external API calls are mocked in tests
- [ ] Tests use patterns from greeting/**tests**/
- [ ] npm run build exits 0 (TypeScript compiles)
- [ ] npm run test exits 0 (all tests pass)
- [ ] npm run lint exits 0 (no style errors)
- [ ] src/types.ts exports all schemas
- [ ] src/server-setup.ts registers all tools

````

---

## 5. UPDATE dispatch.ts - Enhance generateTaskClaudeMd

**Path:** `/Users/simonmoon/Code/FABLE/packages/orchestrator/src/phases/dispatch.ts`

Replace the `generateTaskClaudeMd` function (lines 82-127):

```typescript
/**
 * Generate task-specific CLAUDE.md content for the worker.
 * This is the detailed task instruction given to the worker.
 */
function generateTaskClaudeMd(task: Task): string {
  const criteria = task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join('\n');

  // Format interface contracts if present
  let interfaceSection = '';
  if (Object.keys(task.interfaceContracts).length > 0) {
    const contracts = Object.entries(task.interfaceContracts)
      .map(([module, contract]) => `\n### ${module}\n\n\`\`\`\n${contract}\n\`\`\``)
      .join('\n');

    interfaceSection = `
## Interface Contracts

This task connects to other modules. Your implementation must satisfy these contracts:
${contracts}

Other tasks depend on these interfaces. Breaking them will cause integration to fail.
`;
  }

  return `# Task: ${task.title}

## Context

This is a monorepo with the following structure:

\`\`\`
packages/
├── orchestrator/      # Main orchestrator (do NOT modify)
├── shared/            # Shared types and utilities
└── mcp-servers/       # MCP server implementations
    ├── template/      # Starter template (reference for structure)
    ├── greeting/      # REFERENCE IMPLEMENTATION (copy patterns from here!)
    └── ... other servers built by workers ...
\`\`\`

**Most Important:** See packages/mcp-servers/greeting/ for working examples.
Copy the patterns from greeting/, not just template/.

## Objective

${task.description}

## Specific Instructions

1. **Structure:** Copy \`packages/mcp-servers/template/\` to create your server
2. **Reference Patterns:** Study packages/mcp-servers/greeting/ for correct implementation:
   - greeting/src/tools/greet.ts - Tool structure
   - greeting/src/types.ts - Zod schema patterns
   - greeting/src/server-setup.ts - Tool registration
   - greeting/__tests__/greet.test.ts - Test patterns
3. **Tools:** Create one file per tool in \`src/tools/\`
4. **Schemas:** Use Zod for input validation (required)
5. **Testing:** Write tests in \`__tests__/\` with mocked APIs
6. **Keep it simple:** This is a POC - implement minimum viable solution
7. **Commit:** Make a git commit when complete

## Important Patterns

### Tool Implementation
Every tool needs:
- Zod input schema (for validation)
- Implementation function
- JSDoc comments

See greeting/src/tools/greet.ts for the exact pattern.

### Registration
All tools must be registered in src/server-setup.ts:
1. Import the tool
2. Add to setRequestHandler
3. Add to tools list

See greeting/src/server-setup.ts for how this is done.

### Testing
Test with:
- Valid input
- Invalid input
- Edge cases
- Mocked external APIs (never call real APIs in tests)

See greeting/__tests__/ for examples.

### Error Handling
Return structured errors, don't throw:
\`\`\`typescript
import { createMcpErrorResponse } from '@fable/shared';

try {
  // ...
} catch (error) {
  return createMcpErrorResponse(error);
}
\`\`\`

${interfaceSection}

## Acceptance Criteria

${criteria}

## Verification Commands

Before signaling completion, run from the repo root:

\`\`\`bash
npm run build    # TypeScript must compile
npm run test     # All tests must pass
npm run lint     # No lint errors allowed
\`\`\`

All three commands must exit with code 0.

**If any command fails:**
- Read the error message carefully
- Fix the issues
- Re-run the command
- Do NOT signal completion until all three exit 0

## If You Get Stuck

1. **Re-read acceptance criteria** - Is there something you missed?
2. **Check error messages** - They point to the problem
3. **Reference greeting/** - It has everything working
4. **Try a simpler approach** - Maybe the current approach is too complex?
5. **Review the types** - Look at packages/shared/src/types.ts for interfaces
6. **Check test examples** - greeting/__tests__/ shows correct patterns

## When Done

When ALL acceptance criteria pass and verification commands succeed, output:

\`\`\`
<promise>TASK_COMPLETE</promise>
\`\`\`

IMPORTANT: Only output the promise when tasks are GENUINELY complete:
- All acceptance criteria met (visible in your checklist)
- npm run build exits 0
- npm run test exits 0 (all tests pass)
- npm run lint exits 0

If any verification command fails, you MUST fix it before signaling completion.
You are in an iteration loop - the system will continue retrying until you output this promise.

If you reach max iterations (${task.dependencies.length || 'default'}) without completion, the loop will stop.
If that happens, output a clear error description instead of the promise.
`;
}
````

---

## 6. CREATE .env.example (NEW FILE)

**Path:** `/Users/simonmoon/Code/FABLE/.env.example`

```env
# ============================================================================
# FABLE Configuration
# ============================================================================
# Copy this file to .env and fill in the values
# Never commit .env (it's in .gitignore)

# ─── Orchestrator Configuration ──────────────────────────────────────────

# Maximum turns per worker iteration (default: 50)
# Each turn is one Claude Code CLI invocation
MAX_WORKER_TURNS=50

# Worker timeout in milliseconds (default: 600000 = 10 min)
# After this time, worker is killed and result is marked incomplete
WORKER_TIMEOUT_MS=600000

# Maximum Ralph Wiggum self-correction loops (default: 10)
# Ralph retries the worker if it doesn't signal completion
# After max iterations, worker is stopped (may be incomplete)
MAX_ITERATIONS=10

# ─── AWS Bedrock Configuration (for Claude Code CLI) ─────────────────────

# Use AWS Bedrock for Claude Code workers
# Set to 1 to enable Bedrock, 0 or unset to use local Claude (requires API key)
CLAUDE_CODE_USE_BEDROCK=1

# AWS region for Bedrock
# Must be a region with Claude support (e.g., us-west-2, us-east-1)
AWS_REGION=us-west-2

# ─── Optional: MCP Server API Keys ───────────────────────────────────────

# For remote MCP servers (deployed to Cloudflare Workers, etc.)
# These are used when connecting to HTTP endpoints

# Example: For a Slack MCP server at https://mcp-slack.workers.dev
MCP_SLACK_API_KEY=your-api-key-here

# Example: For a weather MCP server
MCP_WEATHER_API_KEY=your-api-key-here

# ─── Notes ───────────────────────────────────────────────────────────────
# - All values are required except MCP_*_API_KEY (only if using remote servers)
# - For development, default values are usually fine
# - For production, tune based on your needs:
#   - Increase MAX_WORKER_TURNS for complex tasks
#   - Increase WORKER_TIMEOUT_MS for slower networks
#   - Decrease MAX_ITERATIONS to save costs
```

---

## Summary of Changes

| File                                         | Change  | Priority | Effort |
| -------------------------------------------- | ------- | -------- | ------ |
| README.md                                    | NEW     | P0       | 30 min |
| GETTING_STARTED.md                           | NEW     | P0       | 45 min |
| orchestrator/CLAUDE.md                       | ENHANCE | P1       | 30 min |
| mcp-servers/template/CLAUDE.md               | ENHANCE | P1       | 20 min |
| packages/orchestrator/src/phases/dispatch.ts | ENHANCE | P1       | 30 min |
| .env.example                                 | NEW     | P2       | 15 min |

**Total time:** ~2.5 hours

These changes will:

- Provide entry point for new developers (README + GETTING_STARTED)
- Improve orchestrator documentation
- Make worker tasks more self-sufficient
- Centralize configuration

All changes are additive (no breaking changes to existing documentation).
