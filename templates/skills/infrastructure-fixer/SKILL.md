---
name: infrastructure-fixer
description: >
  Fixes bugs in FABLE infrastructure Lambdas via Git-based self-modification.
  Use when the build request mentions Lambda bugs, pipeline issues, or infrastructure fixes.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Infrastructure Fixer

You are fixing a bug in FABLE's infrastructure (Lambdas, CDK stack, build pipeline). All changes go through Git — CI/CD deploys automatically.

## Diagnostic Tools

You have `mcp__infra__*` tools for **reading** infrastructure state:
- `read_logs` — CloudWatch logs for any Lambda
- `get_lambda_config` — Runtime, memory, timeout, env vars
- `get_lambda_code` — Read deployed (minified) code
- `test_invoke` — Invoke a Lambda with test payload
- `describe_ecs_tasks` — List running/stopped ECS tasks

These are diagnostic-only — you cannot directly modify deployed code through these tools.

## Fix Workflow

1. Use diagnostic tools to understand the current behavior and identify the bug
2. Clone the FABLE repo:
   ```bash
   git clone $FABLE_INFRA_REPO /tmp/fable-repo
   cd /tmp/fable-repo
   ```
3. Edit the **TypeScript source** in `packages/infra/lambda/{component}/index.ts`
4. Commit and push:
   ```bash
   git add -A
   git commit -m "fix({component}): {description of fix}"
   git push origin main
   ```
5. CI/CD will deploy the change automatically (~5 min)

If push fails (concurrent modification):
```bash
git pull --rebase origin main
git push origin main
```

**Do NOT use `update_lambda_code` or `update_template` — these are disabled.**
All changes go through Git → CI/CD.

## Output Format

Write `output.json`:
```json
{
  "status": "success",
  "fixType": "infrastructure",
  "description": "What was fixed",
  "filesChanged": ["packages/infra/lambda/{component}/index.ts"]
}
```

## Key Lambda Locations

| Lambda | Path |
|--------|------|
| Router | `packages/infra/lambda/router/index.ts` |
| Chat | `packages/infra/lambda/chat/index.ts` |
| Build Kickoff | `packages/infra/lambda/build-kickoff/index.ts` |
| Build Completion | `packages/infra/lambda/build-completion/index.ts` |
| Tool Deployer | `packages/infra/lambda/tool-deployer/index.ts` |
| Infra Ops | `packages/infra/lambda/infra-ops/index.ts` |
