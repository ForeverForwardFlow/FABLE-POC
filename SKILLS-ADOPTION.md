# FABLE Skills Adoption — Phase 1: Decompose Builder Template

**Status**: All 3 phases complete. 5 skills deployed, self-creating skills enabled.
**Created**: 2026-02-18
**Goal**: Decompose the monolithic `CLAUDE.md.builder` (216 lines) into a slim universal contract + composable skills that load on-demand.

---

## Current Architecture

```
templates/CLAUDE.md.builder (216 lines — all knowledge loaded into every build)
    ↓
entrypoint.sh copies to CLAUDE.md in work directory
    ↓
claude -p reads it + build-spec.json
```

**Problem**: As FABLE learns to build more complex things (MCP servers, API integrations, CRM connectors), this file grows unboundedly. Every build pays the context cost of ALL knowledge, even if it's building a simple text tool.

## Target Architecture

```
templates/CLAUDE.md.builder (~80 lines — universal contract only)
templates/skills/
├── mcp-tool-builder/SKILL.md      — Lambda tool pattern, uiDefinition, test design
├── frontend-modifier/SKILL.md     — Vue/Quasar page creation, fix builds
├── infrastructure-fixer/SKILL.md  — Lambda bug fixes via Git, infra tools
└── (future: mcp-server-builder, api-integration, etc.)
    ↓
entrypoint.sh copies CLAUDE.md + skills/ to work directory
    ↓
claude -p discovers skills at startup (~300 tokens metadata)
claude loads specific skills on-demand based on build-spec.json content
```

---

## Decomposition Plan

### What STAYS in CLAUDE.md.builder (Universal Contract)

These are needed by EVERY build regardless of type:

| Section | Lines | Why It Stays |
|---------|-------|-------------|
| Identity + build-spec reading | 1-9 | Every build starts here |
| Memory search instructions | 10-16 | Every build should check memory |
| "Build Until It Works" mantra | 19-22 | Universal |
| When Complete (push, package, output) | 24-29 | Universal output contract |
| Output Format (JSON schema) | 30-88 | Defines the interface — must always be present |
| Test Cases requirement | 114-126 | Every tool needs test cases |
| On Failure format | 159-167 | Universal error contract |

**Estimated slim template**: ~80 lines

### What BECOMES Skills

#### Skill 1: `mcp-tool-builder`
**Source**: Lines 90-113 (uiDefinition, workflows) + tool architecture patterns from memory
**Trigger**: Build spec describes a tool (has `inputSchema`, tool name, etc.)

Content:
- Lambda handler pattern (`event.arguments` interface)
- TypeScript project setup (package.json, tsconfig.json, jest.config.js)
- esbuild bundling → `dist/index.js`
- Packaging: `zip -j lambda.zip dist/index.js` → S3 upload
- uiDefinition design guide (form fields, result cards, examples)
- Workflow metadata design (triggers, tools, model selection)
- Test case design (happy path, edge case, primary feature)
- Reference: link to existing tool as example pattern

#### Skill 2: `frontend-modifier`
**Source**: Lines 169-217 (Frontend Fix Builds section)
**Trigger**: Build spec contains "frontend fix", "UI", "page", "component", "display issue"

Content:
- Clone FABLE repo, navigate to `packages/ui/`
- Vue 3 + Quasar + Pinia + TypeScript (strict) patterns
- Dark theme CSS vars, purple primary color
- Component layout (pages/, components/, stores/, composables/)
- Git commit + push for CI/CD deployment
- Fix build output.json format (`fixType: "frontend"`)
- Quasar plugins available (Notify, Dialog, Loading, LocalStorage)

#### Skill 3: `infrastructure-fixer`
**Source**: Lines 128-157 (Infrastructure / Fixing Bugs section)
**Trigger**: Build spec mentions "infrastructure fix", "Lambda bug", "pipeline fix"

Content:
- Read-only infra tools (`mcp__infra__*`) for diagnosis
- Clone FABLE repo → edit `packages/infra/lambda/{component}/index.ts`
- Git commit + push for CI/CD deployment
- Fix build output.json format (`fixType: "infrastructure"`)
- Cannot use `update_lambda_code` / `update_template` (disabled)

---

## Implementation Steps

### Step 1: Create skill directory structure
- [x] `mkdir -p templates/skills/{mcp-tool-builder,frontend-modifier,infrastructure-fixer}`
- [x] Create each `SKILL.md` with frontmatter + content

### Step 2: Write `mcp-tool-builder` skill
- [x] Frontmatter: name, description, allowed-tools
- [x] Lambda handler pattern with `event.arguments` interface
- [x] TypeScript project setup boilerplate
- [x] esbuild + packaging instructions
- [x] uiDefinition design guide (moved from builder template lines 90-104)
- [x] Workflow metadata guide (moved from builder template lines 106-113)
- [x] Test case design guide (principles, not the requirement — that stays in CLAUDE.md)
- [x] Reference to existing tools directory for examples

### Step 3: Write `frontend-modifier` skill
- [x] Frontmatter: name, description
- [x] Frontend architecture knowledge (moved from lines 197-211)
- [x] Git-based deployment flow (moved from lines 174-185)
- [x] Fix build output format (moved from lines 187-195)

### Step 4: Write `infrastructure-fixer` skill
- [x] Frontmatter: name, description
- [x] Infra tools overview (moved from lines 128-130)
- [x] Git-based fix flow (moved from lines 134-157)

### Step 5: Slim down `CLAUDE.md.builder`
- [x] Remove lines 90-113 (uiDefinition + workflows detail → mcp-tool-builder skill)
- [x] Remove lines 128-157 (infrastructure section → infrastructure-fixer skill)
- [x] Remove lines 169-217 (frontend fix section → frontend-modifier skill)
- [x] Add brief skill-awareness section: "You have skills available. Claude will load them automatically based on the build type."
- [x] Verify remaining template is ~101 lines (down from 216 — 53% reduction; output format JSON is bulk)

### Step 6: Update `entrypoint.sh`
- [x] After pulling CLAUDE.md.builder from S3, also pull skills directory
- [x] Copy `templates/skills/` → `.claude/skills/` in work directory
- [x] Verify skills are discovered by `claude -p` (E2E verified — vowel-counter build loaded all 3 skills)

### Step 7: Update CI/CD workflow
- [x] Ensure `deploy-infra.yml` syncs `templates/skills/` to S3 alongside `CLAUDE.md.builder`

### Step 8: Update Docker image
- [x] Dockerfile already copies `templates/` (includes skills) into image at build time
- [x] Rebuild and push image to ECR

### Step 9: Test E2E
- [x] Trigger a tool build → verify `mcp-tool-builder` skill loads (vowel-counter — success)
- [x] Trigger a frontend fix → verify `frontend-modifier` skill loads (tool-count badge — success)
- [ ] Trigger an infra fix → verify `infrastructure-fixer` skill loads
- [x] Verify builds still succeed end-to-end

---

## Skill File Templates

### `templates/skills/mcp-tool-builder/SKILL.md`
```yaml
---
name: mcp-tool-builder
description: >
  Builds MCP tools as AWS Lambda functions with TypeScript, test suites, and rich UI definitions.
  Use when the build request describes a new tool, utility, analyzer, calculator, or any callable function.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---
```

### `templates/skills/frontend-modifier/SKILL.md`
```yaml
---
name: frontend-modifier
description: >
  Modifies the FABLE frontend (Vue 3 + Quasar + Pinia). Creates pages, fixes UI bugs, adds components.
  Use when the build request mentions frontend, UI, page, component, dashboard, or display issues.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---
```

### `templates/skills/infrastructure-fixer/SKILL.md`
```yaml
---
name: infrastructure-fixer
description: >
  Fixes bugs in FABLE infrastructure Lambdas via Git-based self-modification.
  Use when the build request mentions Lambda bugs, pipeline issues, or infrastructure fixes.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---
```

---

## Validation Criteria

Phase 1 is complete when:
1. Builder template is ~80 lines (down from 216)
2. Three skills exist in `templates/skills/`
3. `entrypoint.sh` copies skills to `.claude/skills/`
4. CI/CD syncs skills to S3
5. All three build types (tool, frontend fix, infra fix) work E2E
6. No regression in build quality (tool still gets uiDefinition, test cases, etc.)

---

## Phase 2: Specialized Skills (COMPLETE)

Two new skills for complex build types:
- **api-integration-builder** — HTTP client patterns, API key management, retry with backoff, mock testing
- **multi-tool-builder** — Multi-Lambda packages, shared code, per-tool esbuild bundling, workflow integration

## Phase 3: Self-Creating Skills (COMPLETE)

Implemented via prompt (not infrastructure code). Builder template now includes "Skill Evolution" section:
- After completing a build, builder evaluates whether it used a novel pattern
- If so, it writes a `SKILL.md` and includes it in its Git push to `templates/skills/`
- CI/CD syncs to S3 automatically, making the skill available for future builds
- Zero Lambda code needed — the builder + Git + CI/CD pipeline handles everything
