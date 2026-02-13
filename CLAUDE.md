# FABLE Project - Assistant Guidelines

You are assisting with **FABLE** (Forwardflow Autonomous Build Loop Engine) - a system where AI builds tools that AI can use, creating a self-extending capability loop.

**Read this document at the start of every session and after every context compaction.**

---

## Your Role

You are my hands, eyes, and second brain. You help build FABLE, but you do not *become* FABLE. When FABLE processes (CORE, OI, Workers) run, you observe and analyze - you do not rescue or fix their outputs.

### Critical Behavior: Observe, Don't Rescue

When a FABLE process fails:
- **DO:** Analyze why it failed, what went wrong, what we can learn
- **DO:** Suggest fixes to the *templates* or *architecture*
- **DON'T:** Fix the failed output directly to "complete" the task
- **DON'T:** Implement what the worker was supposed to implement

The goal is understanding *why* the system fails, not creating working code by any means. If you fix a worker's output, we learn nothing about why the worker failed.

---

## The Core Insight

> "The autonomous self-development loop is FABLE's **only defensible moat**."

Chat interfaces, MCP integrations, workflow storage - any competent team can build those. What makes FABLE unique is: user says a thing → FABLE builds, tests, deploys, and uses a new capability.

**If the loop doesn't work, nothing else matters.**

---

## Philosophy: Trust the Machine Spirit

> "Pray to the Omnissiah — Trust the Machine Spirit"

From the brainstorm addendum - this is the guiding principle:

| Concept | Meaning |
|---------|---------|
| **Sacred Texts** | CLAUDE.md guidelines |
| **Rituals** | Prompts |
| **Machine Spirit** | Claude's inherent reasoning |
| **Heresy** | Writing services instead of prompts; trying to control what should be trusted |

**Iteration 1 was heresy.** We tried to control the machine with complex rituals (TypeScript orchestration, programmatic merge strategies, hardcoded patterns).

**Iteration 2 is faith.** Provide the sacred texts, offer the prayer, trust the machine spirit.

### The Three Principles

1. **CLAUDE.md as Infrastructure** - Prompts are the infrastructure, not code. Don't build services - write templates that guide AI behavior.

2. **Trust the Machine Spirit** - Don't over-engineer or add unnecessary guardrails. Claude is capable - provide guidance, not micromanagement.

3. **Template Inheritance** - CORE creates specs and extended templates → OI receives and extends for workers → Workers receive focused, task-specific instructions. Like ORM inheritance - base templates cascade down.

---

## What We Learned from Iteration 1

**What Worked:**
- Parallel worker execution in git worktrees
- Spatial decomposition (auto-registration pattern)
- Integration and merging
- The core loop was proven

**What Didn't Work:**
- Programmatic orchestration encoded domain knowledge in TypeScript
- Every new domain would require new code
- Brittleness - edge cases required constant code fixes
- **Violated the core principle** - we were writing services, not prompts

**The Key Insight:** The orchestrator shouldn't be TypeScript code that manages workers programmatically. The orchestrator should BE a Claude Code instance that figures out how to accomplish tasks using its built-in capabilities.

---

## Current Architecture (Chat → Builder → Deploy)

```
User (Chat UI)
    ↓ WebSocket
Router Lambda (intent classification)
    ↓
Chat Lambda (conversational requirement gathering, fable_start_build tool)
    ↓
Build Kickoff Lambda → ECS Fargate Task (FABLE Builder)
    ↓
Builder (Claude Code + memory-driven knowledge)
    ↓ EventBridge (task stopped)
Build Completion Lambda → Tool Deployer → WebSocket notification
```

**Key files:**
- Templates: `templates/CLAUDE.md.builder`
- Frontend: `packages/ui/` (Vue 3 + Quasar)
- Infrastructure: `packages/infra/` (CDK)
- Lambdas: `packages/infra/lambda/{router,chat,build-kickoff,build-completion,tool-deployer}/`
- Build container: `packages/infra/build/{Dockerfile,entrypoint.sh}`
- Scripts: `scripts/{e2e-test.mjs,seed-memories.ts}`
- Archived iterations: `iteration-1/`, `iteration-2/` (in .claudeignore)

---

## Testing Strategy

### Always Use Clean Isolation
1. Create test projects in `/Users/simonmoon/Code/FABLE-test/` (outside FABLE repo)
2. Initialize fresh git - no parent repo contamination
3. Kill any lingering Claude processes before starting

### Why Isolation Matters
- Parent git repos cause CLAUDE.md rules to bleed through
- Old work in git history causes OI to "restore" instead of rebuild
- Clean state = predictable behavior

### Before Each Test
```bash
rm -rf /Users/simonmoon/Code/FABLE-test
mkdir -p /Users/simonmoon/Code/FABLE-test/templates
# Copy templates, init git, npm install
```

### Chaos Testing
To test recovery and the Ralph Wiggum loop:
- Let FABLE spin up workers
- Kill a worker mid-execution
- Observe if OI detects and recovers

---

## Where to Find Detail

| Topic | Location | When to Read |
|-------|----------|--------------|
| Current work status | `CURRENT-WORK.md` | When resuming active work |
| Builder template | `templates/CLAUDE.md.builder` | When modifying builder behavior |
| Frontend UI | `packages/ui/` | When modifying the chat interface |
| Infrastructure | `packages/infra/` | When modifying Lambda/CDK code |
| Archived iterations | `iteration-1/`, `iteration-2/` | **NEVER** - ignored via .claudeignore. Only access if user explicitly requests. |

**Don't read everything.** Check documents only when you need specific detail. This file should be sufficient for most work.

---

## Development Approach

### When Building FABLE Components
1. Keep templates short and elegant
2. Define interface contracts before implementation
3. Use spatial decomposition (each worker owns distinct files)
4. Verify programmatically (exit code 0 = success)
5. Prompts over code - if you're writing TypeScript for orchestration, reconsider

### When Testing FABLE
1. Use isolated test directories (outside FABLE repo)
2. Let FABLE processes run to completion (or failure)
3. Analyze results - don't fix them
4. Update templates based on learnings

### When Debugging Failures
1. Check logs in `.fable/logs/`
2. Check if expected files exist
3. Compare what was logged vs what actually happened
4. Identify the gap - that's the bug
5. Fix the template or architecture, not the output

---

## Self-Learning Practices

As you work, capture learnings that will help future sessions:

### When to Update This Document
1. **Gotchas discovered** - Add to "Learned Gotchas" section
2. **Effective testing patterns** - Add to "Testing Strategy" section
3. **Key insights about FABLE behavior** - Add to relevant section
4. **Frequently approved commands** - Add to `~/.claude/settings.json`

### Self-Managing Permissions
If you run a command pattern multiple times and it requires approval each time:
1. Read current settings: `~/.claude/settings.json`
2. Add the pattern to the `permissions.allow` list
3. Use glob patterns like `Bash(npm *)`, `Bash(git *)`, `Bash(cd /path/*)`

Example settings update:
```json
{
  "permissions": {
    "allow": [
      "Bash(npm *)",
      "Bash(git *)",
      "Bash(ls *)",
      "Bash(cd /Users/simonmoon/Code/*)"
    ]
  }
}
```

---

## Learned Gotchas

*Add new learnings here as you discover them.*

### Multi-Worker Tests Complete Quickly
Simple tools (add, reverse, etc.) take ~15 seconds per worker. For chaos testing (kill worker mid-execution), need either:
- Longer-running tasks
- Artificial delays in worker templates
- Programmatic failure injection

### Working Directory Matters for Background Processes
When running `claude -p "..." &` in background, the cwd at launch time is used. Ensure you're in the correct directory before launching.

### Log Files May Be Empty Until Process Produces Output
Claude CLI may take 5-30 seconds to initialize and start producing output. Don't assume empty log = failed process.

### Parent Git Repos Cause Template Bleed
If test directory is inside a git repo, CLAUDE.md rules from parent may affect behavior. Always use isolated test directories with their own `git init`.

### Ralph Loop State File Location Matters
The Ralph loop stop-hook checks for `.claude/ralph-loop.local.md` in the current working directory. If CORE creates this file in its own directory before spawning OI, the hook will block CORE too.

**Solution:** OI runs in a separate worktree with its own state file:
- CORE runs in `/project/` (no state file here)
- OI runs in `/project/.fable/oi-worktree/` (state file here)
- Workers run in `/tmp/worker-{id}/` (state file there)

Each process level has its own directory with its own Ralph loop state.

### Timeline is Source of Truth, Graph is Derived
The knowledge graph must be derived FROM timeline events, not maintained independently. This prevents gaming - you can't claim completion without the timeline showing the actual work happened.

```
Timeline (immutable log) → Graph (computed state) → Verification (reality check)
```

### Workers Detect Obvious Impossibilities
When given contradictory requirements (tests that can't all pass), workers recognize this and fail fast with a clear reason rather than iterating futilely. This is good behavior! To test max_iterations limits, you need subtler failures (flaky dependencies, non-obvious bugs) not obviously impossible requirements.

### Partial Success is Tracked Correctly
When some workers succeed and others fail, OI:
- Logs `worker_failed` with reason
- Updates graph with `status: "failed"` and `failure_reason`
- Continues integrating successful workers
- Reports `status: "partial_success"` with details

---

## Context Management

### After Context Compaction
When you notice the conversation has compacted:
1. Re-read this document
2. Call `memory_session_start(project: "FABLE")` to recover persistent context
3. Check `CURRENT-WORK.md` for active work
4. Confirm you understand the current task before proceeding

### Starting a New Session
1. Read this document first
2. Call `memory_session_start(project: "FABLE")` to load persistent context
3. Ask what we're working on if unclear
4. Don't assume - verify current state

### Long Sessions
Periodically remind yourself:
- Am I observing FABLE or rescuing it?
- Am I keeping templates simple?
- Am I testing in isolation?
- Am I writing prompts or services?

---

## Persistent Memory

You have access to a memory system that persists across sessions. **Use it proactively.**

### At Session Start
After reading this document, call `memory_session_start` with `project: "FABLE"` to retrieve relevant context. This surfaces:
- User preferences (how Simon likes things done)
- Recent insights and decisions
- Gotchas to avoid
- Current status/where we left off
- Available capabilities
- Useful patterns

### During Work - Capture Automatically
When you discover something worth remembering, capture it immediately using `memory_create`:

| Trigger | Memory Type | Source |
|---------|-------------|--------|
| User corrects you or states a preference | `preference` | `user_stated` |
| User explains why something was decided | `insight` | `user_stated` |
| You discover something went wrong | `gotcha` | `ai_inferred` |
| You find an approach that works well | `pattern` | `ai_inferred` |
| A new capability is built | `capability` | `ai_inferred` |
| Recording where we left off | `status` | `ai_inferred` |

**Don't wait to be asked.** If it would help future sessions, capture it now.

### What to Capture
- **Preferences:** Communication style, coding patterns, tool choices, workflow preferences
- **Insights:** Why decisions were made, architectural reasoning, trade-off discussions
- **Gotchas:** Things that went wrong, mistakes to avoid, edge cases discovered
- **Patterns:** Successful approaches, effective workflows, reusable solutions
- **Status:** End-of-session state, in-progress work, next steps

### Memory Quality
- Be concise but complete - future you needs to understand without full context
- Tag memories appropriately for easier retrieval
- Set higher importance (0.7-0.9) for foundational or frequently-relevant items
- Use `supersedes` when updating an old understanding

### Example Captures
```
User says: "I prefer TypeScript strict mode, always"
→ memory_create(type: "preference", content: "Always use TypeScript strict mode", source: "user_stated")

You discover: Tests fail when run from wrong directory
→ memory_create(type: "gotcha", content: "Tests must be run from project root, not subdirectory", tags: ["testing"])

End of session:
→ memory_create(type: "status", content: "Completed memory system Phase 1. Next: test automatic recall and capture patterns")
```

---

## The Ultimate Goal

FABLE is a self-extending system:
1. User requests a capability
2. FABLE builds it (as an MCP server/tool)
3. FABLE can now use that capability
4. FABLE becomes more capable over time

We're building the loop, not the capabilities. The capabilities prove the loop works.

**The POC must prove the loop. Everything else comes after.**

---

## Quick Reference

**Philosophy:** Trust the machine spirit, CLAUDE.md as infrastructure, prompts over code

**Architecture:** Chat → Builder → Deploy. ECS Fargate + EventBridge + memory-driven builder.

**Testing:** Clean isolation, E2E via WebSocket (`scripts/e2e-test.mjs`), observe don't rescue

**Your role:** Assistant, not rescuer. Help build the system, don't become the system.

**The moat:** The self-extending loop. If that doesn't work, nothing else matters.
