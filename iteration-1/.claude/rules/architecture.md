# Architecture Rules

System architecture decisions and their rationale.

## Component Boundaries

```
┌─────────────────────────────────────────────────────┐
│ Orchestrator (packages/orchestrator)                │
│ - Plans work, dispatches workers, integrates results│
│ - Uses Claude Agent SDK programmatically            │
│ - Connects to MCP servers as a client               │
├─────────────────────────────────────────────────────┤
│ Workers (Claude Code CLI)                           │
│ - Run in isolated git worktrees                     │
│ - Build code autonomously via Ralph Wiggum          │
│ - NO orchestrator logic — just follow CLAUDE.md     │
├─────────────────────────────────────────────────────┤
│ MCP Servers (packages/mcp-servers/*)                │
│ - Self-contained capability units                   │
│ - Built by workers, used by orchestrator            │
│ - Run locally (stdio) or remotely (HTTP)            │
├─────────────────────────────────────────────────────┤
│ Shared (packages/shared)                            │
│ - Types, validation, error utilities                │
│ - No business logic — just contracts                │
└─────────────────────────────────────────────────────┘
```

## Key Decisions

### Orchestrator: Agent SDK, Not Raw API

**Decision:** Use `@anthropic-ai/claude-agent-sdk`, not direct Bedrock/API calls.

**Rationale:**

- Agent SDK provides tool suite (Read, Write, Edit, Bash, etc.)
- Supports hooks, sub-agents, MCP natively
- Programmatic session management
- Future-proof for Claude Code capabilities

### Workers: CLI, Not SDK

**Decision:** Workers run Claude Code CLI (`claude -p ...`), not Agent SDK.

**Rationale:**

- CLI is the autonomous execution environment
- `--dangerously-skip-permissions` enables full autonomy
- Ralph Wiggum plugin manages iteration
- Clean isolation from orchestrator concerns

### Isolation: Git Worktrees

**Decision:** Each worker task runs in its own git worktree.

**Rationale:**

- Filesystem-level isolation (no file conflicts)
- Each worker on its own branch
- Shared `.git` directory (efficient)
- Easy merge after completion

```bash
# Orchestrator creates worktree
git worktree add /path/to/task-1 -b feat/task-1

# Worker runs in worktree
cd /path/to/task-1
claude -p "..." --dangerously-skip-permissions

# Orchestrator merges branch
git merge feat/task-1
```

### Iteration: Ralph Wiggum Plugin

**Decision:** Use official Ralph Wiggum plugin for worker iteration.

**Rationale:**

- Stop hook intercepts Claude exit
- Checks for completion promise before allowing exit
- Manages iteration count in state file
- Official, maintained, correct implementation

**NOT:** Manual iteration loops in code (lazy workaround)

### MCP Servers: Dual Transport

**Decision:** MCP servers support both stdio (local) and HTTP (remote).

**Rationale:**

- Same server code, different entry points
- `index.ts` → stdio transport (local development, workers)
- `worker.ts` → HTTP transport (Cloudflare Workers deployment)
- `server-setup.ts` → shared tool registration

```
src/
├── server-setup.ts   # Shared: createServer(), tool handlers
├── index.ts          # Entry: StdioServerTransport
└── worker.ts         # Entry: WebStandardStreamableHTTPServerTransport
```

### Planning: Extended Thinking

**Decision:** Use high thinking budget (32K-65K tokens) for planning phase.

**Rationale:**

- Planning is the highest-leverage phase
- Better plans → fewer worker iterations → lower total cost
- Interface contracts defined upfront → fewer merge conflicts

### Spatial Decomposition

**Decision:** Each task targets a distinct module/directory.

**Rationale:**

- Minimizes merge conflicts between parallel workers
- Clear ownership boundaries
- Interface contracts define how modules connect

## What NOT to Build

These are explicitly out of scope for POC:

| Feature               | Why Not                              |
| --------------------- | ------------------------------------ |
| Chat UI               | Orchestrator is CLI-first for POC    |
| Multi-tenancy         | Single-tenant local testing          |
| Authentication        | No users in POC                      |
| Rate limiting         | Local testing doesn't need it        |
| Persistent queues     | Direct invocation, no async triggers |
| Production monitoring | Prove the loop first                 |

## Technology Stack

| Layer      | Technology                 | Why                              |
| ---------- | -------------------------- | -------------------------------- |
| Language   | TypeScript strict          | Type safety, Claude fluency      |
| Runtime    | Node.js 20+                | ES modules, native fetch         |
| Monorepo   | npm workspaces + Turborepo | Simple, proven, cached           |
| Testing    | Vitest                     | Fast, native ESM, great DX       |
| Validation | Zod                        | Runtime validation at boundaries |
| MCP SDK    | @modelcontextprotocol/sdk  | Official, both transports        |
| Deployment | Cloudflare Workers         | MCP servers, edge, cheap         |

## Directory Conventions

```
packages/{name}/
├── src/
│   ├── index.ts       # Entry point
│   ├── types.ts       # Local types (if needed)
│   └── {feature}/     # Feature modules
├── __tests__/         # Test files
├── dist/              # Build output (gitignored)
├── package.json
├── tsconfig.json
└── CLAUDE.md          # Package-specific guidance
```

## Interface Contracts

Define contracts before workers start building:

```typescript
// Good: Clear contract
interface AuthMiddleware {
  (req: Request): Promise<AuthContext>;
}
interface AuthContext {
  userId: string;
  role: 'admin' | 'user';
}

// Bad: Vague contract
// "The auth module handles authentication"
```

Workers implement to the contract. Integration verifies the contract.
