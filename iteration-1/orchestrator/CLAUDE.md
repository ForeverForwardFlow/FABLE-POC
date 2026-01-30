# Orchestrator Package

The brain of FABLE — receives requests, plans work, dispatches workers, integrates results.

## Structure

```
src/
├── index.ts              # Main entry point, orchestrate() function
├── phases/
│   ├── requirements.ts   # Gather requirements from user
│   ├── planning.ts       # Deep planning with extended thinking
│   ├── dispatch.ts       # Spawn workers in git worktrees
│   └── integrate.ts      # Merge worker output, verify, commit
└── utils/
    ├── worktree.ts       # Git worktree management
    └── claude-code.ts    # Spawn Claude Code CLI
```

## Key Functions

- `orchestrate(request: string)` — Main entry point
- `gatherRequirements(request)` — Clarify ambiguous requests
- `createPlan(requirements)` — Break into tasks with extended thinking
- `dispatchWorker(task)` — Setup worktree, write CLAUDE.md, spawn CLI
- `integrateResults(tasks)` — Merge branches, run tests, commit

## Environment Variables

- `CLAUDE_CODE_USE_BEDROCK=1` — Use AWS Bedrock
- `AWS_REGION` — Bedrock region
- `MAX_WORKER_TURNS` — Max turns per worker (default: 50)
- `WORKER_TIMEOUT_MS` — Worker timeout in ms (default: 600000)

## Testing

```bash
npm run test        # Run all tests
npm run test:watch  # Watch mode
```
