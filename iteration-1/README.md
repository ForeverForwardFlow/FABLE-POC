# Iteration 1: Programmatic Orchestrator

This folder contains the complete codebase from FABLE's first iteration — a programmatic TypeScript orchestrator approach.

## What It Did

- Parsed user requirements and created task plans
- Spawned Claude Code workers in isolated git worktrees
- Managed parallel execution with dependency-aware DAG
- Integrated worker results and regenerated index files
- Verified builds/tests after integration
- Built MCP servers with dual-transport (stdio + HTTP)

## Why It Was Archived

While it worked for the specific case of building MCP servers, it violated a core principle:

> "CLAUDE.md as infrastructure — center the AI, don't write services, write prompts."

The programmatic approach:
- Encoded domain knowledge in TypeScript code
- Required code changes for each new domain
- Was brittle to edge cases (merge conflicts, paths, cleanup)
- Couldn't adapt to arbitrary requests

## What Replaced It

Iteration 2 uses a prompt-first approach where the orchestrator IS a Claude Code instance, not TypeScript managing Claude Code instances.

See [brainstorm-addendum-iteration-2.md](../brainstorm-addendum-iteration-2.md) for details.

## Contents

- `orchestrator/` — The programmatic orchestrator package
- `packages/` — MCP servers (greeting, template) and shared types
- `.claude/` — Rules and configuration for Claude Code
- `scripts/` — Build and utility scripts
- `architecture.*` — Original architecture diagrams
- `implementation.md` — Implementation notes
- `DOCUMENTATION_*.md` — Documentation audit files

## Learnings Preserved

Key patterns that worked:
1. Git worktrees for isolation
2. Ralph Wiggum loop for worker iteration
3. Auto-registration pattern for avoiding merge conflicts
4. Spatial decomposition (one file per task)
5. Dual-transport MCP servers (stdio + HTTP)
6. Zod schemas for all tool inputs

These patterns should inform CLAUDE.md guidance in Iteration 2.

## Running This Code (if needed)

```bash
cd iteration-1
npm install
npm run build
npm run test
```
