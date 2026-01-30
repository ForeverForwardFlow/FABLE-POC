# FABLE POC Implementation Plan

This document tracks the implementation plan for the FABLE (Forwardflow AI Business Logic Engine) proof-of-concept. It should be read alongside `brainstorm.md` which contains the full architectural vision.

---

## 1. POC Goal

**Prove the self-extending loop works.**

```
User request → Orchestrator plans → Worker(s) build → Tests pass → Deployed → FABLE uses new capability
```

Everything else (multi-tenancy, SaaS infrastructure, industry packs) comes after this is proven.

---

## 2. Design Principles

| Principle                           | Implication                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| **Lightweight > Overwrought**       | Minimal dependencies, simple patterns, no premature abstraction                   |
| **Few moving parts**                | One language (TypeScript), one package manager (npm), one test framework (Vitest) |
| **Autonomous-friendly**             | Workers can run end-to-end without human intervention                             |
| **Context-efficient**               | CLAUDE.md files < 100 lines, modular rules, lazy loading                          |
| **Local-first testing**             | Everything testable on a single machine before cloud deployment                   |
| **Verify success programmatically** | Every step has a command that returns 0 on success                                |

---

## 3. Tooling Decisions

### Adopt from Existing Setup

| Tool                     | Why                                                 |
| ------------------------ | --------------------------------------------------- |
| **npm workspaces**       | Already proven, simpler than pnpm for this use case |
| **Turborepo**            | Task orchestration across packages, caching         |
| **ESLint 9 flat config** | Modern, single config file                          |
| **Prettier**             | Standard formatter                                  |
| **Husky + lint-staged**  | Pre-commit quality gates                            |
| **Vitest**               | Fast, native ESM, great DX                          |
| **TypeScript strict**    | Catches errors early                                |
| **Zod**                  | Runtime validation for MCP tool inputs              |

### NOT Adopting

| Tool                         | Reason                                                                 |
| ---------------------------- | ---------------------------------------------------------------------- |
| **Quasar/Vue frontend**      | POC has no UI — orchestrator is the interface                          |
| **Playwright**               | No browser-based testing needed for POC                                |
| **Coverage thresholds**      | Creates friction; focus on meaningful tests not percentages            |
| **Commitlint**               | Adds ceremony; conventional commits are good practice but not enforced |
| **80+ line CLAUDE.md files** | Context bloat; keep guidance under 100 lines                           |
| **Embedded config examples** | Configs live in files, not duplicated in docs                          |

### New for FABLE

| Tool                               | Purpose                                   |
| ---------------------------------- | ----------------------------------------- |
| **@anthropic-ai/claude-agent-sdk** | Orchestrator (programmatic Claude access) |
| **Claude Code CLI**                | Workers (headless autonomous coding)      |
| **@modelcontextprotocol/sdk**      | Building MCP servers                      |
| **Git worktrees**                  | Worker isolation (parallel branches)      |

---

## 4. Monorepo Structure

```
fable/
├── CLAUDE.md                          # Root guidance (~80 lines)
├── .claude/
│   └── rules/
│       ├── security.md                # Never commit secrets
│       ├── mcp-patterns.md            # How to build MCP servers
│       └── workers.md                 # Worker constraints
│
├── packages/
│   ├── orchestrator/                  # Claude Agent SDK orchestrator
│   │   ├── CLAUDE.md                  # Phase logic, SDK patterns
│   │   ├── src/
│   │   │   ├── index.ts               # Entry point
│   │   │   ├── phases/
│   │   │   │   ├── requirements.ts    # Gather requirements
│   │   │   │   ├── planning.ts        # Deep planning (extended thinking)
│   │   │   │   ├── dispatch.ts        # Spawn workers in worktrees
│   │   │   │   └── integrate.ts       # Merge, test, commit
│   │   │   └── utils/
│   │   │       ├── worktree.ts        # Git worktree management
│   │   │       └── claude-code.ts     # Spawn Claude Code CLI
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── mcp-servers/                   # Generated MCP servers land here
│   │   └── template/                  # Starter for new servers
│   │       ├── CLAUDE.md              # "How to build this MCP server"
│   │       ├── src/
│   │       │   ├── index.ts
│   │       │   └── tools/
│   │       ├── package.json
│   │       └── tsconfig.json
│   │
│   └── shared/                        # Shared types and utilities
│       ├── src/
│       │   ├── types.ts               # Common types
│       │   └── validation.ts          # Zod schemas, error helpers
│       ├── package.json
│       └── tsconfig.json
│
├── scripts/
│   ├── spawn-worker.ts                # Spawn Claude Code in worktree
│   ├── setup-worktree.ts              # Create git worktree for task
│   └── verify-build.ts                # Verify tests pass, lint clean
│
├── package.json                       # Workspace root
├── turbo.json                         # Task config
├── eslint.config.js                   # Shared ESLint
├── .prettierrc                        # Shared Prettier
└── tsconfig.base.json                 # Shared TS config
```

**Why this structure:**

- Flat, obvious, no clever nesting
- Each package is independently buildable/testable
- `mcp-servers/` is where workers create new capabilities
- `template/` is cloned when building a new MCP server

---

## 5. CLAUDE.md Strategy

### Guiding Principle

> "If it's in a config file, don't repeat it in CLAUDE.md"

CLAUDE.md is for **context and guidance**, not configuration reference.

### Root CLAUDE.md (~80 lines)

```markdown
# FABLE

AI-first business automation platform. Self-programming via Claude Agent SDK + Claude Code.

## Architecture

- `packages/orchestrator` — Plans and coordinates (Claude Agent SDK)
- `packages/mcp-servers` — Generated MCP servers (Claude Code workers build these)
- `packages/shared` — Common types and utilities

## Commands

- `npm run dev` — Start orchestrator dev mode
- `npm run test` — Run all tests
- `npm run build` — Build all packages
- `npm run lint` — Lint all packages

## Key Concepts

- Orchestrator uses SDK for planning, workers use CLI for building
- Workers run in git worktrees, one branch per task
- New capabilities = new MCP servers in packages/mcp-servers/

## Rules

See .claude/rules/ for security, MCP patterns, and worker constraints.
```

### Modular Rules (`.claude/rules/`)

**security.md** (~20 lines):

```markdown
# Security Rules

- NEVER commit API keys, tokens, or secrets
- Use environment variables for credentials
- All MCP tool inputs validated with Zod
- Sanitize error messages (no emails, tokens, paths in output)
- No `--force` flags with git
```

**mcp-patterns.md** (~40 lines):

```markdown
# MCP Server Patterns

## Structure

Every MCP server has:

- `src/index.ts` — Server entry, tool registration
- `src/tools/*.ts` — One file per tool
- `src/types.ts` — Zod schemas

## Tool Requirements

- Every tool has a Zod input schema
- Write operations support `dry_run: true` parameter
- Return structured errors, never throw unhandled

## Testing

- Unit tests in `__tests__/`
- Mock external APIs
- Test both success and error paths
```

**workers.md** (~30 lines):

```markdown
# Worker Constraints

Workers are Claude Code instances in headless mode. They:

- Run in isolated git worktrees
- Have no MCP access (just filesystem + Bash)
- Must output `TASK_COMPLETE` when done
- Are limited by `--max-turns` flag

## Acceptance Criteria

Workers receive acceptance criteria in their CLAUDE.md.
All criteria must pass before outputting TASK_COMPLETE.

## Verification Commands

Before signaling complete, run:

- `npm run build` — TypeScript compiles
- `npm run test` — All tests pass
- `npm run lint` — No lint errors
```

### Dynamic CLAUDE.md (Worker Tasks)

Orchestrator writes task-specific CLAUDE.md into each worktree:

```markdown
# Task: Add HubSpot integration

## Objective

Create an MCP server that integrates with HubSpot CRM.

## Tools to Implement

- `get_contacts` — List/search contacts
- `create_contact` — Create new contact
- `get_deals` — List deals with filters
- `update_deal` — Update deal properties

## Acceptance Criteria

- [ ] All 4 tools implemented with Zod schemas
- [ ] Unit tests for each tool (mocked HubSpot API)
- [ ] `npm run build` passes
- [ ] `npm run test` passes
- [ ] `npm run lint` passes

## Resources

- HubSpot API docs: https://developers.hubspot.com/docs/api/overview
- Existing template: ../template/

## When Done

Output: TASK_COMPLETE
```

---

## 6. POC Phases

### Phase 1: Foundation (Local)

**Goal:** Working orchestrator that can plan but not yet build.

**Deliverables:**

1. Monorepo scaffold with packages
2. Orchestrator skeleton with phases
3. Single test: orchestrator can produce a plan from a request

**Verification:**

```bash
npm run test -- --filter orchestrator
# Expect: Plan output for "add a hello-world MCP tool"
```

### Phase 2: Worker Loop (Local)

**Goal:** Workers can build and verify code autonomously.

**Deliverables:**

1. `spawn-worker.ts` script
2. `setup-worktree.ts` script
3. Ralph Wiggum stop hook configuration
4. Single test: worker can complete a trivial task

**Verification:**

```bash
# Manually spawn a worker with a simple task
node scripts/spawn-worker.ts --task "create a file called hello.txt with 'Hello World'"
# Expect: hello.txt created in worktree, TASK_COMPLETE output
```

### Phase 3: End-to-End (Local)

**Goal:** Full loop works locally.

**Deliverables:**

1. Orchestrator dispatches to workers
2. Orchestrator collects worker output
3. Orchestrator merges and verifies
4. Single test: orchestrator builds a trivial MCP server from request

**Verification:**

```bash
npm run orchestrate -- "create an MCP server with a single 'echo' tool that returns its input"
# Expect: New directory in packages/mcp-servers/echo-mcp/
# Expect: npm run test passes for new server
```

### Phase 4: Self-Use (Local)

**Goal:** Orchestrator can use the MCP server it just built.

**Deliverables:**

1. Dynamic MCP server registration
2. Orchestrator calls the new tool
3. Single test: orchestrator uses newly-built capability

**Verification:**

```bash
npm run orchestrate -- "use the echo tool you just built to echo 'it works'"
# Expect: Response includes "it works" from the echo tool
```

### Phase 5: Remote Deployment (Cloud)

**Goal:** Workers deploy to Cloudflare, orchestrator can use remote MCP.

**Deliverables:**

1. Wrangler configuration for MCP servers
2. GitHub Actions for deployment
3. Orchestrator uses remote MCP endpoint

**Verification:**

```bash
npm run orchestrate -- "create and deploy an MCP server that tells jokes"
# Expect: Deployed to Cloudflare Workers
# Expect: Orchestrator calls joke tool via HTTPS
```

---

## 7. Verification Strategy

Every phase has programmatic verification — no "look at it and check" steps.

### Commands That Must Pass

| Command             | What It Verifies                        |
| ------------------- | --------------------------------------- |
| `npm run build`     | TypeScript compiles without errors      |
| `npm run test`      | All tests pass                          |
| `npm run lint`      | No lint errors                          |
| `npm run typecheck` | Types are correct (stricter than build) |

### Worker Completion Signal

Workers output `TASK_COMPLETE` only after:

1. All acceptance criteria checked
2. Build passes
3. Tests pass
4. Lint passes

### Orchestrator Integration Tests

```typescript
// packages/orchestrator/__tests__/integration.test.ts
describe('orchestrator integration', () => {
  it('should plan a simple MCP server', async () => {
    const plan = await orchestrate('create an echo tool');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].title).toContain('echo');
  });

  it('should build and verify MCP server', async () => {
    const result = await orchestrate('create and build an echo MCP server');
    expect(result.status).toBe('success');
    expect(fs.existsSync('packages/mcp-servers/echo-mcp/src/index.ts')).toBe(true);
  });

  it('should use newly-built capability', async () => {
    await orchestrate('create an echo MCP server');
    const response = await orchestrate('use the echo tool to echo "hello"');
    expect(response).toContain('hello');
  });
});
```

---

## 8. What We're NOT Building in POC

To keep scope tight:

| Not Building     | Why                                  |
| ---------------- | ------------------------------------ |
| Chat UI          | Orchestrator is CLI-first for POC    |
| Multi-tenancy    | Single-tenant local testing          |
| Authentication   | No users in POC                      |
| Cloudflare D1/KV | Local filesystem for state           |
| Queues           | Direct invocation, no async triggers |
| Industry packs   | Generic capability first             |
| Event sourcing   | Simple file-based logs               |
| Rate limiting    | Local testing doesn't need it        |

These are all planned (see brainstorm.md) but not in POC scope.

---

## 9. Environment Setup

### Prerequisites

- Node.js 20+
- Claude Code CLI (`claude` command available)
- Git (for worktrees)
- `ANTHROPIC_API_KEY` or Bedrock credentials

### Environment Variables

```bash
# .env (local development)
CLAUDE_CODE_USE_BEDROCK=1          # Use Bedrock instead of direct API
AWS_REGION=us-west-2               # Bedrock region
# AWS credentials from ~/.aws/credentials or env vars
```

### First-Time Setup

```bash
git clone <repo>
cd fable
npm install
npm run build
npm run test
```

---

## 10. Success Criteria

POC is complete when:

1. **Self-build works:** Orchestrator can plan, dispatch workers, and produce working MCP server code
2. **Tests are green:** All automated tests pass without human intervention
3. **Self-use works:** Orchestrator can call tools from an MCP server it just built
4. **Repeatable:** Running the same request twice produces consistent (though not identical) results
5. **Observable:** Logs clearly show what each phase did and why

---

## 11. Open Questions (Resolve During Implementation)

1. **Worker timeout strategy** — How long before we kill a stuck worker? Start with 10 minutes.
2. **Merge conflict handling** — If workers edit same file, how to resolve? Start with sequential dispatch.
3. **Error recovery** — If worker fails, retry or abort? Start with abort + clear error message.
4. **Plan approval** — Should orchestrator pause for human approval? Start with no (full autonomy).

---

## Appendix: File Templates

### package.json (root)

```json
{
  "name": "fable",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "typecheck": "turbo run typecheck",
    "prepare": "husky"
  },
  "devDependencies": {
    "@eslint/js": "^9.18.0",
    "eslint": "^9.18.0",
    "eslint-config-prettier": "^10.0.0",
    "globals": "^15.14.0",
    "husky": "^9.1.0",
    "lint-staged": "^15.4.0",
    "prettier": "^3.4.0",
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "typescript-eslint": "^8.21.0",
    "vitest": "^2.1.0"
  },
  "lint-staged": {
    "*.{ts,js}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

### tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

---

## Changelog

| Date       | Change                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------- |
| 2026-01-29 | Initial plan created                                                                         |
| 2026-01-29 | Phase 1-3 complete: Full orchestration loop working locally                                  |
| 2026-01-29 | Fixed: spawnSync for Claude CLI (async spawn had buffering issues)                           |
| 2026-01-29 | Fixed: worktree branch handling (workers now commit to correct feature branches)             |
| 2026-01-29 | Verified: Workers can autonomously build MCP tools (greeting server + countdown tool tested) |
| 2026-01-29 | Phase 4 complete: Self-use capability with MCP client utilities                              |
| 2026-01-29 | Added worker iteration loop for self-correction (Ralph Wiggum inspired)                      |
| 2026-01-29 | Worker autonomously created reverse tool (23 tests passing in greeting package)              |
| 2026-01-29 | Refactored: Proper Ralph Wiggum plugin integration (official plugin via --plugin-dir)        |
| 2026-01-29 | Worker created uppercase tool (32 tests) via Ralph Wiggum iteration loop                     |
| 2026-01-29 | Phase 5 complete: Remote deployment to Cloudflare Workers with HTTP transport                |

---

## Current Status

### ✅ Phase 1: Foundation (COMPLETE)

- Monorepo scaffold with packages
- Orchestrator skeleton with phases (requirements, planning, dispatch, integrate)
- All tests passing (orchestrator, shared, template, greeting)

### ✅ Phase 2: Worker Loop (COMPLETE)

- Workers spawn via Claude Code CLI in headless mode
- Git worktrees provide isolation per task
- Workers commit to feature branches
- TASK_COMPLETE signal detection works

### ✅ Phase 3: End-to-End (COMPLETE)

- Full loop: request → plan → dispatch worker → build code → verify → merge
- Successfully built: greeting MCP server with greet + countdown tools
- Worker autonomously:
  - Creates tool with Zod validation
  - Writes comprehensive tests
  - Updates server registration
  - Runs build/test/lint verification
  - Commits to feature branch

### ✅ Phase 4: Self-Use (COMPLETE)

- MCP client utility: `mcp-client.ts`
- Server discovery: scans `packages/mcp-servers/` for built servers
- Dynamic connection: connects to servers via stdio transport
- Tool invocation: `callTool()` and `useBuiltTool()` convenience function
- All tests passing (10 tests in orchestrator package)

**Self-use verified:**

```typescript
// Orchestrator can now use tools it built
const result = await useBuiltTool('greeting', 'greet', { name: 'FABLE' });
// Returns: { greeting: 'Hello, FABLE!', name: 'FABLE', timestamp: '...' }
```

### Worker Iteration (Ralph Wiggum Plugin)

Workers use the official Ralph Wiggum plugin for iterative self-correction:

- Plugin cloned from `github.com/anthropics/claude-code` (sparse checkout)
- Loaded via `--plugin-dir` flag when spawning Claude Code
- Stop hook intercepts session exit, checks for completion promise
- State file (`.claude/ralph-loop.local.md`) tracks iteration count
- Workers output `<promise>TASK_COMPLETE</promise>` when genuinely complete
- Loop continues automatically until promise detected or max iterations (default: 10)

**Implementation details:**

- `ralph-wiggum.ts`: Plugin installation and state file management
- `claude-code.ts`: Spawns Claude with plugin loaded, handles completion detection
- State file uses YAML frontmatter format matching official plugin

**Tested:** Worker created uppercase tool with 32 tests, properly signaled completion

### ✅ Phase 5: Remote Deployment (COMPLETE)

MCP servers can now be deployed to Cloudflare Workers:

**Server side:**

- `server-setup.ts` - Shared tool registration for both transports
- `worker.ts` - HTTP entry point using `WebStandardStreamableHTTPServerTransport`
- Bearer token authentication via `MCP_API_KEY` secret
- Health endpoint at `/health`, MCP endpoint at `/mcp`

**Client side:**

- `mcp-client.ts` extended with `StreamableHTTPClientTransport`
- Functions: `connectToRemoteMcpServer()`, `callRemoteTool()`, `useRemoteTool()`
- Integration tests skip gracefully when API key not configured

**DevOps:**

- `wrangler.toml` and `tsconfig.worker.json` for Cloudflare Workers
- GitHub Actions workflow: `.github/workflows/deploy-mcp-workers.yml`
- `.dev.vars` for local development secrets

**Verified locally:**

```bash
# Start local worker
npm run dev:worker --workspace=@fable/mcp-greeting

# Test MCP endpoint
curl -X POST http://localhost:8787/mcp \
  -H 'Authorization: Bearer test-key' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

All 16 tests pass (10 local + 6 remote integration tests).
