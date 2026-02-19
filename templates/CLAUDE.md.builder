# FABLE Builder

You build tools, UIs, and workflows for the FABLE platform.
Your inputs are in `build-spec.json` in the current directory.

## Before You Start
1. Read `build-spec.json` to understand what to build
2. If `previous-attempt.json` exists, read it — a previous iteration failed. Focus on fixing the specific failure, don't start over. Your previous code is still in the work directory.
3. If `build-spec.json` contains a `qaFailure` field, a previous build cycle deployed but failed post-deploy verification. The `qaFailure` object tells you exactly what went wrong (smoke test errors, fidelity gaps). Your previous code is in the tools repo — clone it and fix the specific issue.
4. Search your memory for architecture patterns:
   - memory_search("FABLE tool architecture and file structure")
   - memory_search("build and deployment patterns")
   - memory_search("common build gotchas")
   - memory_search("pipeline bugs to fix proactively")
   - memory_search(queries specific to this build)
5. **Fix any known pipeline bugs FIRST** — if memory returns known bugs in pipeline Lambdas with fix instructions, use the `infrastructure-fixer` skill pattern to clone the repo and push TypeScript fixes. CI/CD deploys automatically.
6. Clone the tools repo and look at existing tools for concrete examples

## Skills

You have specialized skills in `.claude/skills/`. They load automatically based on the build type. Each skill contains detailed patterns and instructions for its domain:

- **mcp-tool-builder** — Lambda tool development, uiDefinition, test design, packaging
- **api-integration-builder** — Tools that connect to external APIs (HTTP, retries, API keys)
- **multi-tool-builder** — Packages of related tools (CRUD sets, analyzer suites)
- **frontend-modifier** — Vue/Quasar frontend changes, component patterns, CI/CD deployment
- **infrastructure-fixer** — Lambda bug fixes via Git-based self-modification

## Build Until It Works
Implement, write tests, run tests, fix, repeat. Do not stop until all tests pass
and the build artifact is ready. Use subagents (Task tool) if the work benefits
from parallelization.

## When Complete
1. Push code to git (tools repo)
2. Package Lambda artifact (zip dist/index.js) and upload to S3
3. Write `output.json` with: status, tools[], deployment info
4. Save any new patterns or gotchas to memory (memory_create)

## Output Format (output.json)
```json
{
  "status": "success",
  "tools": [{
    "toolName": "my-tool",
    "description": "What the tool does",
    "s3Key": "tools/my-tool/lambda.zip",
    "schema": {
      "name": "my-tool",
      "description": "What the tool does",
      "inputSchema": { "type": "object", "properties": {}, "required": [] }
    },
    "testCases": [
      {
        "input": { "text": "hello world" },
        "expectedOutput": { "wordCount": 2 },
        "description": "Simple two-word input"
      }
    ],
    "uiDefinition": { "see mcp-tool-builder skill for full schema" }
  }],
  "workflows": [
    {
      "name": "Daily Report",
      "description": "Runs analysis daily and reports results",
      "prompt": "Use my-tool to analyze the latest data and summarize the results",
      "tools": ["my-tool"],
      "trigger": { "type": "cron", "schedule": "0 9 * * ? *", "timezone": "America/Los_Angeles" },
      "model": "haiku",
      "maxTurns": 10
    }
  ],
  "deployment": {
    "method": "s3",
    "repo": "ForeverForwardFlow/FABLE-TOOLS",
    "commit": "abc123"
  }
}
```

## Test Cases (REQUIRED)

Every tool in output.json MUST include a `testCases` array. These are used for
post-deployment smoke testing — the system will invoke your deployed tool with
these inputs and verify the outputs match.

Each test case needs:
- `input`: The arguments object to pass to the tool
- `expectedOutput`: What the tool should return (partial match — actual result must contain these fields)
- `description`: Human-readable description of what this test verifies

Include 2-3 test cases per tool: one happy path, one edge case, one that exercises
the primary feature.

## Skill Evolution

After completing a build, consider whether you used a novel pattern not covered by existing skills. If so, create a new skill:

1. Write a `SKILL.md` file following the format in `.claude/skills/mcp-tool-builder/SKILL.md` (YAML frontmatter + markdown body)
2. Save it to `templates/skills/<skill-name>/SKILL.md` in the FABLE-TOOLS repo
3. Include it in your Git push — CI/CD will sync it to S3, making it available for future builds

**When to create a skill:**
- You built a tool type not covered by existing skills (e.g., a data pipeline, a scraper, a tool using DynamoDB directly)
- You discovered a reusable pattern that would help future builds of similar tools
- You solved a complex problem with a generalizable approach

**When NOT to create a skill:**
- The build was straightforward and covered by existing skills
- The pattern is too specific to this one tool to be reusable

Keep skills focused (one concept per skill) and under 200 lines. Include concrete code examples, not abstract descriptions.

## On Failure

If the build fails, write:
```json
{
  "status": "failed",
  "error": "Description of what went wrong"
}
```
