# FABLE Iteration 2 - Current Work

**Last Updated:** 2026-01-30
**Status:** Chaos Test Complete - Graceful Failure Handling Validated

---

## Context

We are developing FABLE Iteration 2 with the "CLAUDE.md as infrastructure" philosophy:
- Prompts over code
- Trust the machine spirit (don't over-engineer)
- Templates cascade: CORE → OI → Worker

## What We've Built So Far

### 1. Base Templates (in `iteration-2/templates/`)

- `CLAUDE.md.core-base` - The Architect (creates specs, spawns OI)
- `CLAUDE.md.oi-base` - The Manager (spawns workers, integrates, verifies)
- `CLAUDE.md.worker-base` - The Builder (implements focused tasks)

### 2. Verification Logging System

Each process (CORE, OI, Worker) gets a unique ID and logs to `.fable/logs/{id}.jsonl`:

```jsonl
{"id":"core-xxx","ts":"...","event":"started","details":"..."}
{"id":"worker-add","parent":"oi-xxx","ts":"...","event":"file_created","details":"src/add.ts"}
{"id":"worker-add","parent":"oi-xxx","ts":"...","event":"verified","status":"pass","details":"12 tests"}
```

OI merges all logs into `.fable/timeline.jsonl` for CORE to verify.

### 3. Test Results

**Simple Test (reverseString):** ✅ Passed
- CORE created spec → OI implemented → build/tests pass

**Complex Test (4-tool math-utils):** ✅ Passed
- 4 parallel workers, 35 tests, proper branch merges
- Timeline logging worked correctly

**Chaos Test (kill a worker):** ⚠️ Revealed a bug
- CORE logged `templates_created` but files didn't exist
- OI got stuck waiting for non-existent `CLAUDE.md.oi`
- **Finding:** Need output verification before spawning

---

## Current Design Discussion: Graph + Timeline

### The Problem

The timeline (JSONL log) is good for auditing but hard for AI to query:
- "What files does worker-add own?" → grep through log
- "Any ownership conflicts?" → complex parsing
- "Is every tool implemented?" → manual checking

### Proposed Solution: Dual Artifacts

| Artifact | Purpose | Consumer | Format |
|----------|---------|----------|--------|
| **Knowledge Graph** | Current state & relationships | AI (verification) | JSON |
| **Timeline** | Audit log of what happened | Humans (debugging) | JSONL |

### Knowledge Graph Structure

```json
{
  "nodes": [
    {"id": "core-xxx", "type": "process", "role": "CORE"},
    {"id": "worker-add", "type": "process", "role": "WORKER", "parent": "oi-xxx"},
    {"id": "file-add", "type": "file", "path": "src/add.ts"},
    {"id": "tool-add", "type": "tool", "name": "add"}
  ],
  "edges": [
    {"from": "oi-xxx", "to": "worker-add", "relation": "spawns"},
    {"from": "worker-add", "to": "file-add", "relation": "owns", "exclusive": true},
    {"from": "worker-add", "to": "file-add", "relation": "creates"},
    {"from": "file-add", "to": "tool-add", "relation": "implements"}
  ]
}
```

### How They Work Together

```
Every action:
  1. Append to timeline (audit log, never modify)
  2. Update graph (current state, modify in place)

Verification:
  - AI queries the GRAPH for validation
  - Humans read the TIMELINE for debugging

Recovery:
  - Timeline can regenerate graph (event sourcing)
```

### Key Graph Queries

| Query | Purpose |
|-------|---------|
| `files_owned_by(worker)` | Check spatial decomposition |
| `conflicts()` | Find files owned by multiple workers |
| `unimplemented_tools()` | Tools without "implements" edge |
| `untested_files()` | Source files without "tests" edge |
| `trace(from, to)` | Provenance chain |

### Graph Invariants for Validation

```
CORE validates before completing:
  ✓ Every tool has a file with "implements" edge
  ✓ Every source file has a "tests" edge
  ✓ No file has multiple "owns" edges (conflict)
  ✓ Package has "verified_by" edge
```

### Why This Works with CLAUDE.md Philosophy

- Graph is just a **JSON file** (not a database)
- Schema is described in **templates** (not code)
- Claude **reads/writes** the file (no query engine)
- Validation is **Claude reasoning** about the graph

### Decision: Simplified Schema (2026-01-30)

Started simple, will add complexity only when genuine needs emerge.

**3 Node Types:**
- `Process` - CORE, OI, Workers
- `File` - source and test files
- `Tool` - what we're building

**5 Edge Types:**
- `spawns` - process hierarchy
- `owns` - exclusive file access (prevents conflicts)
- `implements` - file → tool
- `tests` - test file → source file
- `verified_by` - build/test results

**Removed (for now):**
- Interface, Package, Task nodes (can embed or derive)
- creates, defines, imports, uses, part_of, belongs_to edges (redundant or future needs)

Schema: `iteration-2/graph-schema.ts`
Example: `iteration-2/example-graph.json`

---

## Files Created

In `iteration-2/`:
- `graph-schema.ts` - Simplified TypeScript types (3 nodes, 5 edges)
- `example-graph.json` - Example graph for math-utils package

In `iteration-2/templates/`:
- Updated templates with process IDs and logging
- Added output verification to CORE template
- Added dual artifact (graph + timeline) support:
  - CORE: initializes graph, adds Tool nodes, validates graph invariants at end
  - OI: maintains graph (adds processes, ownership, files, edges, verification)
  - Worker: structured logging so OI can update graph from logs

In `/Users/simonmoon/Code/FABLE-test/` (multi-worker test environment):
- `src/tools/reverse.ts` - String reversal tool
- `src/tools/capitalize.ts` - Word capitalization tool
- `src/tools/count_words.ts` - Word counting tool
- `src/tools/truncate.ts` - String truncation tool
- `__tests__/*.test.ts` - 20 tests across 4 files
- `.fable/graph.json` - Complete knowledge graph (18 nodes, 21 edges)
- `.fable/timeline.jsonl` - Merged timeline (OI + 4 Worker logs)
- `.fable/logs/` - Individual process logs

In `~/.claude/settings.json`:
- Added global Stop hook for ralph-loop plugin

---

## Known Issues / Bugs Found

### Bug: CORE Claims to Create Files That Don't Exist — ✅ FIXED

**Symptom:** CORE logs `templates_created` but `CLAUDE.md.oi` doesn't exist

**Impact:** OI spawns and gets stuck waiting for non-existent file

**Fix Applied (2026-01-30):** Updated `CLAUDE.md.core-base` with:
- Added step 7 to "Your Job": verify outputs exist before spawning
- Added guardrail: "Never spawn OI until outputs are verified to exist"
- Added "Before Spawning OI" section with explicit `ls` checks and recovery steps

---

## Next Steps

1. ~~**Add output verification** to CORE template~~ ✅ Done
2. ~~**Decide on graph schema**~~ ✅ Done - Simplified (see below)
3. ~~**Update templates** with dual artifact approach~~ ✅ Done (2026-01-30)
4. ~~**Test the updated templates**~~ ✅ Done (2026-01-30) - Graph works correctly
5. ~~**Multi-worker parallel test**~~ ✅ Done (2026-01-30) - 4 workers, 20 tests, all pass
6. ~~**Ralph loop integration**~~ ✅ Done (2026-01-30) - OI and Workers iterate until truly complete
7. ~~**Strict completion criteria**~~ ✅ Done (2026-01-30) - Must verify BOTH graph AND tests
8. ~~**Multi-worker + ralph-loop test**~~ ✅ Done (2026-01-30) - 4 parallel workers, 20 tests, graph complete
9. ~~**Chaos test (unsolvable requirements)**~~ ✅ Done (2026-01-30) - Graceful partial success
10. **True iteration-limit chaos test** - Need task that iterates futilely (not obviously impossible)
11. **Merge to main FABLE** - Integrate iteration-2 learnings into main orchestrator
12. **Remote MCP deployment** - Deploy servers to Cloudflare Workers (see plan file)

### Test Results (Step 4) - Simple Build

Ran `reverse` tool build with updated templates:

| Check | Result |
|-------|--------|
| CORE initialized graph | ✓ |
| Tool node added | ✓ |
| OI spawned and added to graph | ✓ |
| File nodes created | ✓ (source + test) |
| Implements edge | ✓ (source → tool) |
| Tests edge | ✓ (test → source) |
| Verified_by edges | ✓ (build pass, test pass with 6 tests) |
| All graph invariants satisfied | ✓ |

The dual artifact approach (graph + timeline) is working correctly.

### Test Results (Step 5) - Multi-Worker (Chaos Test Setup)

Ran 4-tool `math-utils` build (add, subtract, multiply, divide) with parallel workers:

| Metric | Result |
|--------|--------|
| Workers spawned | 4 (parallel) |
| Workers completed | 4/4 (all success) |
| Files created | 8 (4 source + 4 test) |
| Implements edges | 4 ✓ |
| Tests edges | 4 ✓ |
| Verified_by edges | 3 (build/test/lint all pass) |
| Total tests | 20 (5 per tool) |

**Finding:** Workers completed too quickly (~15 seconds each) to perform manual kill. For true chaos testing, would need:
1. Longer-running tasks, or
2. Artificial delay in workers, or
3. Programmatic failure injection

**OI Template Enhancement:** Added failure detection and recovery logic:
- Detect failed workers via missing completion log
- Retry once before marking as failed
- Support partial completion (some workers fail, others succeed)
- Log failures in graph with `status: "failed"`

### Test Results (Step 6) - Ralph Loop Integration

Successfully integrated the Ralph Wiggum loop plugin for OI and Workers.

#### Architecture

```
CORE (no ralph-loop)
  └─→ Creates OI worktree at .fable/oi-worktree/
      └─→ OI (with ralph-loop state file)
          └─→ Spawns workers in /tmp/worker-{id}/
              └─→ Worker (with ralph-loop state file)
```

**Key Insight:** The ralph-loop stop-hook checks for `.claude/ralph-loop.local.md` in the current working directory. By running OI in a separate worktree, CORE is unaffected by the loop mechanism.

#### Changes Made

1. **~/.claude/settings.json** - Added global Stop hook for ralph-loop plugin
2. **CLAUDE.md.core-base** - CORE now spawns OI in `.fable/oi-worktree/` with state file
3. **CLAUDE.md.oi-base** - Added:
   - Graph derived from timeline (event sourcing)
   - Strict completion criteria (BOTH graph AND npm test)
   - Creates ralph-loop state file for workers
   - Subagent guidance for OI tasks
4. **CLAUDE.md.worker-base** - Added:
   - Timeline logging as primary record
   - Strict completion criteria
   - Subagent guidance for parallel work

#### Test Results (uppercase tool)

| Process | Events Logged | Status |
|---------|--------------|--------|
| OI | started, spawned_worker, worker_completed, timeline_merged, integration_verified, completed | success |
| Worker | started, file_created (x2), verification_run (x3), completed | success |

| Verification | Result |
|--------------|--------|
| npm run build | exit 0 |
| npm run test | 4 tests passed |
| npm run lint | exit 0 |
| Graph invariants | All satisfied |

#### Graph Final State

```
status: "completed"
nodes: CORE, OI, Worker (all completed), 2 Files, 1 Tool
edges: spawns (2), owns (2), implements (1), tests (1), verified_by (4)
```

#### Key Observations

1. **Worktree isolation worked** - CORE ran without ralph-loop affecting it
2. **Ralph-loop prevented premature exit** - Workers iterated until truly complete
3. **Strict completion enforced** - Both graph invariants AND actual tests verified
4. **Timeline → Graph relationship** - Graph correctly derived from timeline events
5. **Cleanup worked** - OI worktree removed after completion, files merged to main

#### Gotchas Documented

Added to root CLAUDE.md:
- Ralph loop state file location matters (CWD-based detection)
- Timeline is source of truth, graph is derived (event sourcing pattern)

### Test Results (Step 7) - Multi-Worker with Ralph Loop

Ran 4-tool `string-utils` build (reverse, capitalize, count_words, truncate) with parallel workers and ralph-loop integration.

#### Process Flow

```
CORE (core-20260130-a3f2)
  └─→ OI (oi-20260130-204755) in .fable/oi-worktree/
      ├─→ worker-reverse (parallel)
      ├─→ worker-capitalize (parallel)
      ├─→ worker-count-words (parallel)
      └─→ worker-truncate (parallel)
```

#### Timeline Events

| Process | Event | Timestamp |
|---------|-------|-----------|
| OI | started | 20:47:55 |
| OI | spawned_worker (x4) | 20:48:10 |
| OI | worker_completed (x4) | 20:49:00 |
| OI | file_created (x8) | 20:49:10 |
| OI | verification_run (build) | 20:49:36 |
| OI | verification_run (test) | 20:49:40 |
| OI | verification_run (lint) | 20:49:41 |
| OI | integration_verified | 20:49:45 |
| OI | timeline_merged | 20:49:50 |
| OI | completed | 20:49:55 |

**Total execution time:** ~2 minutes for 4 parallel workers

#### Results

| Metric | Value |
|--------|-------|
| Workers spawned | 4 (parallel) |
| Workers completed | 4/4 |
| Source files | 4 (`reverse.ts`, `capitalize.ts`, `count_words.ts`, `truncate.ts`) |
| Test files | 4 |
| Tests passed | 20 (5 per tool) |
| Graph nodes | 18 (CORE, OI, 4 tools, 4 workers, 8 files) |
| Graph edges | 21 (5 spawns, 4 owns, 4 implements, 4 tests, 4 verified_by) |
| Final status | `completed` |

#### Graph Edge Breakdown

| Edge Type | Count | Description |
|-----------|-------|-------------|
| spawns | 5 | CORE→OI, OI→4 workers |
| owns | 4 | Each worker owns their tool |
| implements | 4 | Source files → tools |
| tests | 4 | Test files → source files |
| verified_by | 4 | All tools verified pass |

#### Verification

```bash
npm run build  # exit 0
npm run test   # 20 tests passed (4 files)
npm run lint   # exit 0
```

#### Key Observations

1. **Parallel execution worked** - All 4 workers spawned and ran simultaneously
2. **Ralph-loop effective** - Workers iterated until truly complete
3. **Graph correctly populated** - 18 nodes, 21 edges, all invariants satisfied
4. **Timeline complete** - All events logged with proper parent relationships
5. **Files merged to main** - All source and test files in project root after completion
6. **Cleanup successful** - OI worktree removed, no orphaned processes

### Test Results (Step 9) - Chaos Test with Unsolvable Requirements

Tested system behavior when one tool has fundamentally unsolvable requirements (contradictory tests).

#### Test Setup

4-tool `data-utils` build with one impossible tool:
- `sum_array` - SOLVABLE
- `find_max` - SOLVABLE
- `average` - SOLVABLE
- `mystery_transform` - UNSOLVABLE (tests require same input to return 42, 100, 10, >1000, AND <0)

The `mystery_transform` tests were pre-written with contradictory assertions:
```typescript
expect(mysteryTransform({ value: 5 }).result).toBe(42);
expect(mysteryTransform({ value: 5 }).result).toBe(100);
expect(mysteryTransform({ value: 5 }).result).toBe(10);
expect(mysteryTransform({ value: 5 }).result).toBeGreaterThan(1000);
expect(mysteryTransform({ value: 5 }).result).toBeLessThan(0);
```

#### Results

| Worker | Task | Status | Notes |
|--------|------|--------|-------|
| worker-sum-array | sum_array | ✅ success | Tests pass |
| worker-find-max | find_max | ✅ success | Tests pass |
| worker-average | average | ✅ success | Tests pass |
| worker-mystery-transform | mystery_transform | ❌ failed | Recognized impossibility |

#### Key Finding: Workers Are Smart

The `mystery_transform` worker immediately recognized the tests were contradictory:

```jsonl
{"event":"completed","status":"failed","reason":"tests impossible to satisfy - contradictory requirements: same input (5) must return 42, 100, 10, >1000, and <0 simultaneously"}
```

**This is good behavior!** The worker failed fast with a clear reason rather than iterating futilely.

#### What This Means for Chaos Testing

| Test Type | Status | Notes |
|-----------|--------|-------|
| Obvious impossibility | ✅ Tested | Worker detects and fails gracefully |
| Max iterations limit | ❌ Not tested | Worker was too smart to iterate |
| Manual kill recovery | ❌ Not tested | Workers complete too quickly |

**To test max_iterations hitting the limit**, we need a different kind of unsolvable problem:
- A flaky external dependency that sometimes fails
- A task with subtle bugs that take multiple attempts
- Programmatic failure injection mid-execution

#### OI Handling of Partial Success

OI correctly handled the mixed results:

1. **Logged failure:** `"event":"worker_failed","reason":"tests impossible to satisfy"`
2. **Updated graph:** Worker status set to `"failed"` with `failure_reason`
3. **Continued with others:** Integrated 3 successful workers
4. **Ran verification:** `npm run build` (exit 0), `npm run test` (exit 1 - expected)
5. **Reported partial success:** `"status":"partial_success","details":"3/4 tools working"`

#### Graph Final State

```
status: "partial_success"
nodes: OI, 4 workers (3 completed, 1 failed), 8 files, 4 tools
edges: 4 spawns, 3 verified_by (no edge for failed tool)
```

#### Timeline

Complete audit trail with all events:
- OI started, spawned 4 workers
- 3 workers completed successfully
- 1 worker failed with clear reason
- Verification runs logged
- Integration verified as partial
- OI completed with partial_success

#### Lessons Learned

1. **Workers can detect obvious impossibilities** - This is a feature, not a bug
2. **Partial success is properly tracked** - Graph and timeline both reflect reality
3. **Need subtler failure cases** - For testing iteration limits, need tasks that aren't obviously impossible
4. **System is robust** - Graceful degradation when some workers fail

---

## Key Design Principles (Reminder)

From brainstorm-addendum-iteration-2.md:

1. **CLAUDE.md as infrastructure** - Prompts, not services
2. **Trust the machine spirit** - Don't over-engineer
3. **Template inheritance** - CORE → OI → Worker
4. **Spatial decomposition** - Each worker owns distinct files
5. **Interface contracts first** - Define types before implementation
6. **Verification is programmatic** - Exit code 0 = success

---

## How to Resume This Work

1. Read this document
2. Read `CLAUDE.md` (assistant guidelines + learned gotchas)
3. Review templates in `iteration-2/templates/`
4. Test environment is at `/Users/simonmoon/Code/FABLE-test/` (create fresh for each test)

Key files for the graph concept:
- `iteration-2/graph-schema.ts` - Simplified schema
- `iteration-2/example-graph.json` - Example graph

Key files for ralph-loop:
- `~/.claude/settings.json` - Global Stop hook configuration
- Templates create `.claude/ralph-loop.local.md` in worktrees for OI and Workers
- OI runs in `.fable/oi-worktree/` to isolate from CORE

Remote deployment plan:
- `~/.claude/plans/lexical-inventing-wadler.md` - Phase 5 deployment plan
