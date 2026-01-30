# Worker Constraints

Workers are Claude Code CLI instances running in headless mode.

## Environment

- Run in isolated git worktrees (one branch per task)
- No MCP access — only filesystem and Bash
- Ralph Wiggum plugin manages iteration (not manual loops)
- No network access except Bedrock API endpoint

## Invocation

```bash
cd /path/to/worktree
claude -p "task description" --dangerously-skip-permissions
```

The Ralph Wiggum plugin intercepts exit and checks for completion promise before allowing the worker to stop.

## Task Structure

Workers receive a task-specific CLAUDE.md with:

- Objective: What to build
- Acceptance criteria: Checklist that must pass
- Resources: Links, references, existing code to follow
- Completion signal: Output `TASK_COMPLETE` when done

## Completion Requirements

Before outputting `TASK_COMPLETE`, verify:

```bash
npm run build    # TypeScript compiles
npm run test     # All tests pass
npm run lint     # No lint errors
```

Only signal complete when ALL acceptance criteria are met.

## If Stuck

- Re-read the acceptance criteria
- Check error messages carefully
- Try a simpler approach
- If truly blocked, output clear error description (not TASK_COMPLETE)

## Forbidden Actions

- Never modify files outside the worktree
- Never push to remote (orchestrator handles this)
- Never delete the worktree
- Never modify .git directory
