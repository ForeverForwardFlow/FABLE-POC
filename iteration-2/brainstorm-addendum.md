# FABLE Brainstorm Addendum: Iteration 2

## Context

This addendum documents learnings from Iteration 1 (the programmatic orchestrator approach) and defines the new direction for Iteration 2.

**Date**: January 29, 2025
**Iteration 1 Code**: Preserved in `/iteration-1/` folder

---

## What We Learned from Iteration 1

### What Worked

1. **Parallel Worker Execution** — Successfully spawned multiple Claude Code instances in isolated git worktrees, running in parallel with Ralph Wiggum loops
2. **Spatial Decomposition** — Auto-registration pattern allowed workers to build independent tools without merge conflicts
3. **Integration** — Workers' code was successfully merged and integrated into working MCP servers
4. **The Core Loop** — Proved that: User request → Plan → Workers build → Tests pass → Feature works

### What Didn't Work

1. **Programmatic Orchestration** — The TypeScript orchestrator encoded domain knowledge (MCP patterns, merge strategies, file generation) in code. Every new domain would require new code.
2. **Brittleness** — Edge cases (merge conflicts, path issues, cleanup) required constant code fixes
3. **Violated Core Principle** — "CLAUDE.md as infrastructure" means prompts, not services. We were writing services.

### The Key Insight

The orchestrator shouldn't be TypeScript code that manages workers programmatically. The orchestrator should BE a Claude Code instance that figures out how to accomplish tasks using its built-in capabilities.

---

## Iteration 2: CLAUDE.md as Infrastructure

### Design Philosophy

> **"Pray to the Omnissiah — Trust the Machine Spirit"**

Don't over-engineer around the AI. Provide context, provide tools, provide clear intent. Trust the machine spirit to find the path.

| Concept | Meaning |
|---------|---------|
| **Sacred Texts** | CLAUDE.md guidelines |
| **Rituals** | Prompts |
| **Machine Spirit** | Claude's inherent reasoning |
| **Heresy** | Writing services instead of prompts; trying to control what should be trusted |

**Iteration 1 was heresy.** We tried to control the machine with complex rituals (TypeScript orchestration, programmatic merge strategies, hardcoded patterns).

**Iteration 2 is faith.** Provide the sacred texts, offer the prayer, trust the machine spirit.

---

### Core Principle

> "Center the AI, allow it to work, don't write services, write prompts."

Claude already knows how to:
- Break down complex problems
- Manage git branches and worktrees
- Spawn subprocesses
- Verify work against requirements
- Iterate until done

We don't need to teach it these things. We need to:
1. Give it access to the right **tools** (CLI tools, MCP servers)
2. Provide **project guidelines** (conventions, patterns, tech stack)
3. **Remind** it to use certain principles (parallelize, verify, iterate)

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  FABLE-CORE (The Architect)                                         │
│  - Claude with Deep Thinking/Extended Planning                      │
│  - Reads project CLAUDE.md for guidelines                           │
│  - Creates detailed specifications from user requests               │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FABLE-OI (Orchestrator/Integrator)                                 │
│  - Claude Code instance with Ralph Wiggum loop                      │
│  - Deep Thinking/Planning mode                                      │
│  - Breaks specs into discrete tasks                                 │
│  - Creates CLAUDE.md files for workers                              │
│  - Spawns workers, monitors progress, integrates results            │
│  - Does NOT complete until full implementation verified             │
└───────────┬─────────────────┬─────────────────┬─────────────────────┘
            │                 │                 │
            ▼                 ▼                 ▼
     ┌──────────┐      ┌──────────┐      ┌──────────┐
     │ Worker 1 │      │ Worker 2 │      │ Worker N │
     │ CC+Wiggum│      │ CC+Wiggum│      │ CC+Wiggum│
     │+subagents│      │+subagents│      │+subagents│
     └──────────┘      └──────────┘      └──────────┘
```

### What's Different from Iteration 1

| Aspect | Iteration 1 | Iteration 2 |
|--------|-------------|-------------|
| Orchestrator | TypeScript code | Claude Code instance |
| Task decomposition | Programmatic (code decides) | AI reasoning (Claude decides) |
| Domain knowledge | Encoded in code | Encoded in CLAUDE.md |
| Extensibility | Write new code | Write new prompts |
| Merge handling | Programmatic strategies | AI figures it out |

### The Infrastructure Layers

#### 1. CLAUDE.md Files (Project Guidelines)

NOT "how to think" instructions. YES project-specific guidance:

```markdown
# Project Guidelines

## Tech Stack
- TypeScript strict, Vitest, npm workspaces
- Cloudflare Workers for backend services
- D1 for persistent storage

## Patterns
- Write failing tests first
- MCP servers use dual-transport (stdio + HTTP)
- One tool per file, Zod schemas for all inputs

## Available CLI Tools
- gh: GitHub CLI (authenticated)
- wrangler: Cloudflare CLI (authenticated)
- npm/node: Package management and execution
```

#### 2. CLI Tools (Installed + Authenticated)

The "hands" that Claude uses to do work:
- `git` — version control, branches, worktrees
- `gh` — GitHub PRs, issues, releases
- `wrangler` — Cloudflare Workers, D1, KV
- `npm/node` — package management, execution
- `claude` — spawning worker instances

#### 3. MCP Servers (Extended Capabilities)

For capabilities beyond CLI:
- `playwright` — browser automation
- `figma` — design access
- `context7` — documentation lookup
- Domain-specific servers as needed

#### 4. Operating Principles (Reminders, Not Teaching)

```markdown
## Workflow Principles

- **Parallelize when possible**: Independent tasks should run concurrently
- **Isolate risky changes**: Use git worktrees/branches for separate features
- **Verify before declaring done**: Run build/test/lint, check against original request
- **Iterate until complete**: If verification fails, fix and retry
- **Spawn workers for large tasks**: Don't try to do everything in one context

You have access to git, worktrees, and can spawn Claude Code instances
for parallel work. Use these capabilities.
```

### The Minimal Launcher

The "orchestrator package" becomes trivially simple:

```bash
# That's it. CLAUDE.md provides the rest.
claude -p "$USER_REQUEST" --dangerously-skip-permissions
```

Or with explicit FABLE-OI initialization:

```bash
claude -p "You are FABLE-OI. Read CLAUDE.md for project guidelines.
User request: $USER_REQUEST
Accomplish this request completely. Use workers for parallel tasks.
Verify against requirements. Do not complete until fully working." \
--dangerously-skip-permissions
```

### Why This Works

1. **Claude Already Knows** — We're not teaching decomposition, git, or verification. We're activating existing capabilities.

2. **Prompts Are Portable** — Guidelines work across domains. No code changes for new industries.

3. **AI Adapts** — Claude can figure out the right approach for any request, not just MCP servers.

4. **Failures Are Learnable** — When something doesn't work, improve the prompt, not debug code.

5. **True Multi-Industry** — FABLE can accomplish ANY request, not just predefined patterns.

---

## Template Inheritance Model

Like an ORM where base models define common fields that all entities inherit, FABLE uses base templates that cascade through all levels.

### Base Templates (System Level)

Located in `/iteration-2/templates/`:
- `CLAUDE.md.core-base` — How CORE operates (one-shot planning)
- `CLAUDE.md.oi-base` — Base guidelines for any OI (Wiggum loop, worker management)
- `CLAUDE.md.worker-base` — Base guidelines for any Worker (Wiggum loop, file ownership)

### Inheritance Flow

```
System Level (we write once)
├── CLAUDE.md.core-base
├── CLAUDE.md.oi-base
└── CLAUDE.md.worker-base
         │
         │ CORE extends for project
         ▼
Project Level (CORE creates)
├── CLAUDE.md.oi = oi-base + project requirements
└── CLAUDE.md.worker-template = worker-base + project patterns
         │
         │ OI extends for each task
         ▼
Task Level (OI creates)
├── worker-1/CLAUDE.md = worker-template + task-1 specifics
├── worker-2/CLAUDE.md = worker-template + task-2 specifics
└── worker-3/CLAUDE.md = worker-template + task-3 specifics
```

### The Guarantee

Because each level **extends** rather than **replaces**, base guardrails are ALWAYS present:
- Max iterations enforced at every level
- "Never force push" flows through all workers
- Verification requirements cannot be bypassed
- Project conventions automatically inherited

### Extension Pattern

When extending a base template:
```markdown
# Project-Specific Additions
[New content here]

---

# Base Template (DO NOT MODIFY BELOW)
[Full base template content]
```

This ensures the sacred texts cannot be corrupted.

---

## Verification & Observability: Timeline + Knowledge Graph

### The Problem

When FABLE spawns multiple workers building in parallel, we need to:
1. **Track what happened** — Audit trail for debugging
2. **Verify completion** — Programmatically check that all requirements are met
3. **Detect conflicts** — Ensure spatial decomposition is maintained (no file ownership conflicts)
4. **Prove work was done** — Not just claim completion, but demonstrate it

### The Solution: Dual Artifacts

FABLE maintains two complementary data structures:

| Artifact | Purpose | Format | Mutability |
|----------|---------|--------|------------|
| **Timeline** | What happened (audit log) | JSONL | Append-only |
| **Knowledge Graph** | Current state (verification) | JSON | Derived from timeline |

```
┌─────────────────────────────────────────────────────────────┐
│  Timeline (Source of Truth)                                  │
│  ─────────────────────────────────────────────────────────── │
│  {"id":"oi-xxx","event":"started","ts":"..."}                │
│  {"id":"oi-xxx","event":"spawned_worker","details":"w1"}     │
│  {"id":"w1","event":"file_created","path":"src/add.ts",...}  │
│  {"id":"w1","event":"verification_run","exit_code":0,...}    │
│  {"id":"w1","event":"completed","status":"success"}          │
│  ...                                                         │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ Derive
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Knowledge Graph (Computed State)                            │
│  ─────────────────────────────────────────────────────────── │
│  nodes: [Process, File, Tool]                                │
│  edges: [spawns, owns, implements, tests, verified_by]       │
│                                                              │
│  Queryable for verification:                                 │
│  - Every tool has an implements edge?                        │
│  - Every source file has a tests edge?                       │
│  - Any ownership conflicts?                                  │
│  - All workers completed successfully?                       │
└─────────────────────────────────────────────────────────────┘
```

### Event Sourcing Pattern

The timeline is the **source of truth**. The graph is **derived state**.

This is the event sourcing pattern:
- **Events are immutable** — Once logged, never modified
- **State is computed** — Replay events to reconstruct state
- **Graph can be regenerated** — If graph is corrupted, rebuild from timeline

```
Timeline Event                    →  Graph Update
─────────────────────────────────────────────────────────────
OI "started"                      →  Add OI Process node
OI "spawned_worker" details:w1    →  Add Worker node + spawns edge
Worker "file_created" path:x.ts   →  Add File node + owns edge
  with implements:"add"           →  Add implements edge to Tool
  with tests:"src/add.ts"         →  Add tests edge to source File
Worker "verification_run" exit:0  →  Add verified_by edge
Worker "completed" status:success →  Update Worker status
```

### Why This Matters

**Timeline prevents gaming:**
- Workers can't just update a graph and claim done
- Every graph node must trace back to a timeline event
- Auditable proof of what actually happened

**Graph enables verification:**
- AI can query: "Does every tool have an implements edge?"
- Programmatic invariant checking before completion
- Clear ownership tracking for spatial decomposition

### Timeline Event Schema

Each process (CORE, OI, Worker) logs events to `.fable/logs/{process-id}.jsonl`:

```jsonl
{"id":"worker-add","parent":"oi-xxx","ts":"2026-01-30T...","event":"started","details":"Implementing add tool"}
{"id":"worker-add","parent":"oi-xxx","ts":"2026-01-30T...","event":"file_created","path":"src/tools/add.ts","category":"source","implements":"add"}
{"id":"worker-add","parent":"oi-xxx","ts":"2026-01-30T...","event":"file_created","path":"__tests__/add.test.ts","category":"test","tests":"src/tools/add.ts"}
{"id":"worker-add","parent":"oi-xxx","ts":"2026-01-30T...","event":"verification_run","command":"npm run test","exit_code":0,"output":"5 tests passed"}
{"id":"worker-add","parent":"oi-xxx","ts":"2026-01-30T...","event":"completed","status":"success"}
```

Required fields: `id`, `parent`, `ts`, `event`
Event-specific fields vary by event type.

### Knowledge Graph Schema

Simplified schema with 3 node types and 5 edge types:

**Nodes:**
```typescript
type ProcessNode = { id: string; type: "process"; role: "CORE" | "OI" | "worker"; status: string; }
type FileNode = { id: string; type: "file"; category: "source" | "test"; }
type ToolNode = { id: string; type: "tool"; name: string; }
```

**Edges:**
```typescript
type Edge =
  | { from: string; to: string; type: "spawns" }      // Process → Process
  | { from: string; to: string; type: "owns" }        // Worker → File (exclusive)
  | { from: string; to: string; type: "implements" }  // File → Tool
  | { from: string; to: string; type: "tests" }       // TestFile → SourceFile
  | { from: string; to: string; type: "verified_by"; status: "pass" | "fail" }
```

### Strict Completion Criteria

**Critical:** Completion requires BOTH artifacts to be valid.

Before OI outputs `<promise>TASK_COMPLETE</promise>`:

**1. Code Actually Works:**
```bash
npm run build   # exit 0
npm run test    # exit 0, all tests pass
npm run lint    # exit 0
```

**2. Graph Invariants Satisfied:**
- Every Tool node has an `implements` edge from a source File
- Every source File has a `tests` edge from a test File
- No File has multiple `owns` edges (no conflicts)
- All Worker nodes have `status: "completed"`
- `verified_by` edges exist with `status: "pass"`

**3. Timeline Supports Graph:**
- Every graph node traces to a timeline event
- `grep -c '"event":"file_created"'` matches File node count

### Workflow Integration

```
1. Worker logs events to timeline      →  .fable/logs/worker-xxx.jsonl
2. Worker completes                    →  {"event":"completed","status":"success"}
3. OI reads worker timelines           →  cat .fable/logs/worker-*.jsonl
4. OI derives graph updates            →  Add nodes/edges from events
5. OI merges all timelines             →  .fable/timeline.jsonl
6. OI runs verification commands       →  npm run build && npm run test
7. OI checks graph invariants          →  All edges present, no conflicts
8. OI outputs completion promise       →  <promise>TASK_COMPLETE</promise>
```

### Files

| File | Purpose | Who Writes |
|------|---------|------------|
| `.fable/logs/{id}.jsonl` | Process-specific timeline | Each process |
| `.fable/timeline.jsonl` | Merged timeline (all events) | OI after integration |
| `.fable/graph.json` | Knowledge graph | OI (derived from timelines) |
| `.fable/process.json` | Process metadata | CORE at init |

### Design Principles Applied

This system embodies core FABLE principles:

1. **CLAUDE.md as infrastructure** — Schema is described in templates, not code
2. **Trust the machine spirit** — Claude reads/writes JSON, no query engine needed
3. **Verification is programmatic** — exit code 0 + graph invariants
4. **Audit trail for debugging** — Timeline shows exactly what happened
5. **No gaming allowed** — Can't claim completion without proof

---

## Ralph Wiggum Loop Integration

### The Problem

Workers need to iterate until truly complete, but Claude Code will try to exit after generating output. We need:
1. Workers to keep trying until ALL acceptance criteria pass
2. No premature exit claims
3. Automatic iteration on failures

### The Solution: Stop Hook

The Ralph Wiggum plugin provides a Stop hook that:
1. Intercepts Claude's exit attempt
2. Checks for completion promise in output
3. If no promise found, re-feeds the prompt (iterate)
4. If promise found, allows exit

### Configuration

**Global hook in `~/.claude/settings.json`:**
```json
{
  "hooks": {
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/plugins/.../ralph-loop/hooks/stop-hook.sh",
        "timeout": 30
      }]
    }]
  }
}
```

**State file in each worktree (`.claude/ralph-loop.local.md`):**
```markdown
---
iteration: 1
max_iterations: 50
completion_promise: "TASK_COMPLETE"
---
Read CLAUDE.md and complete the task.
Output <promise>TASK_COMPLETE</promise> only when ALL acceptance criteria are verified.
```

### Worktree Isolation

**Key insight:** The stop hook checks for the state file in the CURRENT WORKING DIRECTORY.

This enables selective loop behavior:
- **CORE** runs in project root (no state file) → exits normally after spawning OI
- **OI** runs in `.fable/oi-worktree/` (has state file) → loops until complete
- **Workers** run in `/tmp/worker-{id}/` (each has state file) → loop until complete

```
/project/                        ← CORE runs here (no loop)
├── .fable/
│   └── oi-worktree/             ← OI runs here (has loop)
│       └── .claude/
│           └── ralph-loop.local.md

/tmp/worker-reverse/             ← Worker runs here (has loop)
└── .claude/
    └── ralph-loop.local.md

/tmp/worker-capitalize/          ← Worker runs here (has loop)
└── .claude/
    └── ralph-loop.local.md
```

### Completion Promise

Workers must output exactly:
```
<promise>TASK_COMPLETE</promise>
```

Only after verifying:
1. `npm run build` exits 0
2. `npm run test` exits 0 (all tests pass)
3. `npm run lint` exits 0
4. All files created
5. Timeline logged correctly

The stop hook checks for this exact string. No promise = iterate again.

---

## Open Questions for Iteration 2

### Resolved

1. ~~**Worker Spawning Mechanics**~~ — ✅ RESOLVED
   - Workers spawn in git worktrees with background processes
   - Ralph Wiggum loop via global Stop hook in `~/.claude/settings.json`
   - State file `.claude/ralph-loop.local.md` in each worktree
   - OI runs in separate worktree to isolate from CORE

2. ~~**Error Recovery**~~ — ✅ RESOLVED
   - Worker failure detected via missing `"completed","status":"success"` in log
   - OI retries once, then marks as failed
   - Partial completion supported (some workers fail, others succeed)
   - All tracked in timeline and graph

3. ~~**Progress Visibility**~~ — ✅ RESOLVED
   - Timeline provides real-time event log
   - Graph provides queryable state
   - Each process logs to `.fable/logs/{id}.jsonl`

### Open

4. **Context Limits** — If FABLE-OI runs for a long time managing many workers, does context become an issue? May need session management or context compaction.

5. **Credential Passing** — How do workers get access to authenticated CLI tools? Current assumption: environment inheritance. Need to validate with remote deployments.

6. **Chaos Testing** — Need longer-running tasks to test manual kill scenarios. Workers complete too quickly (~15s) for interactive chaos testing.

7. **Remote MCP Deployment** — Plan exists for Cloudflare Workers deployment, but not yet tested end-to-end.

---

## Next Steps

1. ~~**Archive Iteration 1**~~ — Move programmatic orchestrator to `/iteration-1/` ✅
2. ~~**Create Base Templates**~~ — CORE, OI, Worker base templates ✅
3. ~~**Test Simple Request**~~ — Single tool build with timeline + graph ✅
4. ~~**Iterate on Templates**~~ — Added verification, dual artifacts, subagent guidance ✅
5. ~~**Validate Worker Spawning**~~ — Ralph loop integration, worktree isolation ✅
6. ~~**Multi-Worker Test**~~ — 4 parallel workers, all completed successfully ✅
7. **Chaos Testing** — Longer-running tasks for failure injection
8. **Remote MCP Deployment** — Deploy to Cloudflare Workers
9. **Merge to Main** — Integrate iteration-2 learnings into main FABLE

---

## Related Documents

- [Original Brainstorm](./brainstorm.md) — Full product vision and resolved questions
- [Excalidraw Diagram](https://excalidraw.com/#json=kQcdm7kRhV0uxy0ExoDDK,YvqtR7D_SO0U4F81deqVvA) — Visual architecture for Iteration 2

## Templates

- [CLAUDE.md.core-base](./iteration-2/templates/CLAUDE.md.core-base) — Base template for FABLE-CORE
- [CLAUDE.md.oi-base](./iteration-2/templates/CLAUDE.md.oi-base) — Base template for FABLE-OI
- [CLAUDE.md.worker-base](./iteration-2/templates/CLAUDE.md.worker-base) — Base template for Workers
