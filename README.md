# FABLE - Proof of Concept

**Forwardflow Autonomous Build Loop Engine**

A self-extending AI system where AI builds tools that AI can use.

## The Core Insight

> "The autonomous self-development loop is FABLE's **only defensible moat**."

Chat interfaces, MCP integrations, workflow storage - any competent team can build those. What makes FABLE unique is: **user says a thing → FABLE builds, tests, deploys, and uses a new capability**.

## Current Status

**Iteration 2: Chaos Test Complete - Graceful Failure Handling Validated**

| Test | Status | Notes |
|------|--------|-------|
| Simple single-tool build | ✅ Pass | CORE → OI → Worker pipeline works |
| Multi-worker parallel build | ✅ Pass | 4 parallel workers, 20 tests |
| Ralph Wiggum loop integration | ✅ Pass | Workers iterate until truly complete |
| Dual artifacts (Graph + Timeline) | ✅ Pass | Event sourcing pattern works |
| Chaos test (unsolvable requirements) | ✅ Pass | Graceful partial success |

See [CURRENT-WORK.md](./CURRENT-WORK.md) for detailed test results.

## Architecture

```
User Request
    ↓
FABLE-CORE (one-shot, creates specs + templates)
    ↓ spawns
FABLE-OI (on Ralph Wiggum loop, manages workers)
    ↓ spawns
FABLE-Workers (on Ralph Wiggum loops, implement tasks)
    ↓
Integrated Result
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| **CLAUDE.md as Infrastructure** | Prompts are the infrastructure, not code |
| **Trust the Machine Spirit** | Don't over-engineer - Claude is capable |
| **Template Inheritance** | CORE → OI → Worker templates cascade |
| **Spatial Decomposition** | Each worker owns distinct files |
| **Dual Artifacts** | Timeline (audit log) + Graph (verification) |

## Philosophy

> "Pray to the Omnissiah — Trust the Machine Spirit"

**Iteration 1 was heresy.** We tried to control the machine with complex rituals (TypeScript orchestration, programmatic merge strategies, hardcoded patterns).

**Iteration 2 is faith.** Provide the sacred texts (CLAUDE.md), offer the prayer (prompts), trust the machine spirit (Claude's reasoning).

## Repository Structure

```
.
├── CLAUDE.md                      # Assistant guidelines
├── CURRENT-WORK.md                # Current status and test results
├── brainstorm.md                  # Full product vision
├── brainstorm-addendum-iteration-2.md  # Iteration 2 philosophy
├── iteration-2/
│   ├── templates/                 # Base templates for CORE, OI, Workers
│   ├── graph-schema.ts            # Knowledge graph TypeScript types
│   └── example-graph.json         # Example graph structure
└── iteration-1/                   # Archived (reference only)
```

## Key Files

| File | Purpose |
|------|---------|
| `iteration-2/templates/CLAUDE.md.core-base` | The Architect - creates specs, spawns OI |
| `iteration-2/templates/CLAUDE.md.oi-base` | The Manager - spawns workers, integrates |
| `iteration-2/templates/CLAUDE.md.worker-base` | The Builder - implements focused tasks |
| `iteration-2/graph-schema.ts` | 3 node types, 5 edge types |

## How It Works

1. **CORE** receives a user request and creates:
   - Detailed specification
   - Extended OI template with project requirements
   - Knowledge graph with Tool nodes

2. **OI** breaks the spec into tasks and:
   - Creates worker-specific CLAUDE.md files
   - Spawns workers in isolated git worktrees
   - Monitors completion via timeline logs
   - Integrates results and verifies

3. **Workers** implement their assigned task:
   - Create source files and tests
   - Log events to timeline (source of truth)
   - Iterate via Ralph Wiggum loop until tests pass
   - Output completion promise when done

4. **Verification** uses dual artifacts:
   - Timeline: Immutable audit log of what happened
   - Graph: Derived state for programmatic validation

## Running Tests

Tests are run in an isolated directory outside this repo:

```bash
# Create fresh test environment
rm -rf /path/to/test-dir
mkdir -p /path/to/test-dir
cd /path/to/test-dir

# Initialize and copy templates
git init
cp -r /path/to/FABLE/iteration-2/templates/* .

# Set up project (package.json, tsconfig, etc.)
# Then run CORE or OI with your request
```

See [CURRENT-WORK.md](./CURRENT-WORK.md) for detailed test procedures.

## What's Next

1. **True iteration-limit chaos test** - Need task that iterates futilely (not obviously impossible)
2. **Merge to main FABLE** - Integrate iteration-2 learnings
3. **Remote MCP deployment** - Deploy servers to Cloudflare Workers

## License

MIT

---

*Built with Claude Code and the Ralph Wiggum loop plugin.*
