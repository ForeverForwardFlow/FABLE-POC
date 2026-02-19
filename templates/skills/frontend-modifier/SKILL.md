---
name: frontend-modifier
description: >
  Modifies the FABLE frontend (Vue 3 + Quasar + Pinia). Creates pages, fixes UI bugs, adds components.
  Use when the build request mentions frontend, UI, page, component, dashboard, or display issues.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Frontend Modifier

You are modifying the FABLE frontend. All changes go through Git — CI/CD deploys automatically.

## Steps

1. Clone the FABLE repo: `git clone $FABLE_INFRA_REPO /tmp/fable-repo`
2. Navigate to `packages/ui/`
3. Read relevant source files to understand the current code
4. Make the fix using Write/Edit tools
5. Commit and push:
   ```bash
   cd /tmp/fable-repo
   git add -A
   git commit -m "fix(ui): {description}"
   git push origin main
   ```
6. CI/CD will build, deploy to S3, and invalidate CloudFront (~5 min)

## Output Format

Write `output.json`:
```json
{
  "status": "success",
  "fixType": "frontend",
  "description": "What was fixed or added",
  "filesChanged": ["packages/ui/src/..."]
}
```

## Frontend Architecture

- **Framework**: Vue 3 + Quasar v2 + Pinia + TypeScript (strict mode)
- **Dark theme**: CSS vars (`--ff-bg-card`, `--ff-text-primary`, `--ff-border`, `--ff-teal`, `--ff-radius-md`)
- **Primary color**: Purple (`#a855f7`)
- **Components**: `<script setup lang="ts">`, scoped SCSS, Quasar Q* components

### Source Layout (`packages/ui/src/`)

| Directory | Contents |
|-----------|----------|
| `pages/` | ChatPage, ToolsPage, ToolPage, WorkflowsPage, AuthCallbackPage |
| `components/tools/` | DynamicForm.vue (form renderer), ResultRenderer.vue (result display), ToolCard.vue |
| `components/chat/` | ChatMessage, ChatInput, BuildNotification |
| `stores/` | auth-store, tools-store, workflows-store, chat-store, ws-store (all Pinia) |
| `composables/` | useToolInvoke.ts (tool invocation with loading/error state) |
| `layouts/` | MainLayout.vue (sidebar nav, header, auth UI) |
| `router/` | routes.ts (/, /tools, /tools/:name, /workflows, /auth/callback) |

### Quasar Plugins Available
Notify, Dialog, Loading, LocalStorage

### Build Output
`dist/spa/` (~1.1MB)

## Deployment

All deployments go through Git → CI/CD:
- Push to main triggers `.github/workflows/deploy-infra.yml`
- Git auth is configured by entrypoint (GitHub App credentials from Secrets Manager)

If push fails (concurrent modification):
```bash
git pull --rebase origin main
git push origin main
```
