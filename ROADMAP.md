# FABLE Comprehensive Roadmap

**Generated**: February 17, 2026
**Status**: Living document — update as work progresses

---

## Current State Assessment

### What Works (Proven E2E)
- **Self-extending loop**: Chat -> build -> deploy -> use tool in same chat (28+ tools deployed)
- **Conversational build flow**: Multi-turn requirement gathering -> build kickoff
- **Memory-driven builds**: Builder searches 49 seeded memories + creates new ones during builds
- **Self-modification**: Builder patched its own build-completion Lambda, deployed frontend fixes
- **Dynamic tool UI**: uiDefinition drives forms, result cards, examples — no per-tool Vue code
- **Workflows**: Create, pause, resume, delete via chat + UI. Cron + manual triggers
- **Auth**: Cognito PKCE flow, WebSocket JWT auth, anonymous fallback
- **QA pipeline**: Smoke tests + AI fidelity check + outer retry loop (up to 5 cycles)
- **Tool-use visibility**: Expandable ToolUseBlock shows params + result JSON in chat
- **Markdown rendering**: Chat responses render bold, lists, code blocks, headings
- **Frontend**: Vue 3 + Quasar SPA with tools grid, workflows page, conversation history

### Architecture at a Glance
```
User -> WebSocket -> Router (Haiku intent) -> Chat Lambda (Sonnet + tool discovery)
                                                    |
                                          [fable_start_build]
                                                    |
                                            Build-Kickoff -> ECS Fargate (Claude Code + MCP sidecar)
                                                                    |
                                                             EventBridge (task stopped)
                                                                    |
                                                          Build-Completion -> Tool-Deployer -> Live Lambda
                                                                    |
                                                        WebSocket notification -> UI
```

---

## Critical Gaps (Must Fix)

### 1. MCP Gateway Has No Multitenancy
**Severity**: CRITICAL
**Current**: `GET /tools` scans ALL tools across ALL orgs. Any user can discover, invoke, and DELETE tools from other orgs. Workflow operations also unscoped.
**Impact**: Complete multitenancy violation. No org isolation at the API layer.
**Fix**:
- Extract orgId from JWT on protected MCP routes
- Filter tool queries by `ORG#{orgId}` partition key (already indexed)
- Add auth to tool deletion and workflow management endpoints
- Public `/tools` route should only show `ORG#default` tools (shared/demo)

### 2. Memory Tenant Isolation Bug
**Severity**: CRITICAL
**Current**: Builders default to UUID `00000000-0000-0000-0000-000000000001` for orgId/userId. All seeded memories use this same default. Chat Lambda queries with the actual user's orgId (`default` for anonymous), so seeded memories may not surface for real users.
**Impact**: (a) Memories leak across tenants if multiple orgs share the default UUID, (b) Seeded build knowledge may not reach builders using different orgIds.
**Fix**:
- Pass `FABLE_ORG_ID` and `FABLE_USER_ID` to ECS container from build-kickoff (already has orgId/userId)
- Re-seed memories under `orgId: 'default'` (matching anonymous connections)
- Validate orgId/userId are never empty in Memory Lambda (reject rather than default)

### 3. Memory Decay Never Runs
**Severity**: HIGH
**Current**: Aurora `decay_memories()` function defined but never scheduled. No Lambda or cron invokes it.
**Impact**: Stale status memories accumulate forever, polluting search results.
**Fix**: EventBridge scheduled rule -> Lambda that calls `SELECT decay_memories()` weekly.

### 4. No User-Facing Memory Management
**Severity**: HIGH
**Current**: Users cannot see, edit, or delete what FABLE remembers about them. No consent flow.
**Impact**: Users can't understand why FABLE behaves a certain way; no GDPR-style data control.
**Fix**: Phase 2 work item — memory management UI + API endpoints.

### 5. Chat Lambda Doesn't Make Users Feel "Known"
**Severity**: HIGH
**Current**: Chat Lambda queries memories with the user's message as search key, but only uses results to populate the system prompt. No proactive recall like "Last time you asked about pricing tools..." or "I remember you prefer simple UIs."
**Impact**: Users don't experience FABLE as learning about them. The memory system exists but is invisible.
**Fix**: Enhance system prompt to reference user history. Add `memory_session_start` equivalent in Chat Lambda. Surface relevant preferences and past interactions proactively.

---

## Significant Gaps (Should Fix)

### 6. No Streaming Response Indicator
**Current**: Chat shows messages only after full completion. No typing indicator or streaming cursor.
**Impact**: User stares at blank screen for 5-15 seconds while Bedrock generates response.
**Fix**: Chat Lambda already sends `chat_response` chunks. Frontend needs streaming cursor component (FLINT has ThinkingBlock we can adapt).

### 7. No Conversation Search
**Current**: Sidebar lists conversations but no search/filter.
**Impact**: Users with 30+ conversations can't find past work.
**Fix**: Add search input to sidebar, filter by title/content.

### 8. No Settings Page
**Current**: Settings icon is a placeholder.
**Impact**: No user preferences, no memory controls, no display settings.
**Fix**: Create SettingsPage with sections for profile, preferences, memory, display.

### 9. DynamoDB Scan Performance
**Current**: MCP Gateway scans entire tools table on every request. Build-completion falls back to full table scan to find build records.
**Impact**: Degrades as data grows. O(n) per request.
**Fix**: Use GSI queries instead of scans. Add buildId GSI to builds table.

### 10. No Build History UI
**Current**: Build status visible only during active build (WebSocket). No way to see past builds.
**Impact**: Users can't audit what FABLE has built or retry failed builds.
**Fix**: Build history page with status, duration, retry count, links to deployed tools.

### 11. No Tool Versioning / Rollback
**Current**: Each deploy overwrites the previous version. No rollback mechanism.
**Impact**: If a build deploys a broken tool update, previous version is lost.
**Fix**: Store versioned zips in S3; tool-deployer maintains version history in DynamoDB.

### 12. Missing Observability
**Current**: Basic CloudWatch logs per Lambda. No distributed tracing, no metrics dashboards, no alerts.
**Impact**: Hard to debug cross-service failures; no visibility into system health.
**Fix**: Enable X-Ray tracing, add CloudWatch alarms for error rates, create operational dashboard.

### 13. No Error Boundaries in Frontend
**Current**: Component errors crash the entire page (blank screen).
**Fix**: Vue error handler + fallback components for graceful degradation.

### 14. WebSocket Reconnection is Naive
**Current**: Fixed 3-second delay on disconnect. No exponential backoff, no jitter.
**Fix**: Implement exponential backoff with jitter. Show connection status indicator in UI.

---

## Improvement Areas (Nice to Have)

### 15. FLINT Features Not Yet Ported
- ThinkingBlock (expandable AI reasoning display)
- Streaming cursor (animated typing indicator)
- Image paste in chat input
- Conversation search
- Design token system (comprehensive `app.scss`)
- IndexedDB persistence (offline-capable)

### 16. Workflow Edit UI
**Current**: Workflows created via chat only. No UI to edit existing workflows.

### 17. Tool Analytics
**Current**: No usage tracking. Can't see which tools are used most.

### 18. Multi-Tab Sync
**Current**: Multiple browser tabs don't sync conversation state.

### 19. Keyboard Shortcuts
**Current**: No Cmd+K search, no Cmd+/ help.

### 20. Dark/Light Theme Toggle
**Current**: Hard-coded dark mode.

### 21. Tool Approval Dialog
**Current**: Chat invokes tools automatically. No user opt-in/opt-out per tool.
**FLINT has**: ToolApprovalDialog with per-tool allow/deny + session-scope auto-approve.

---

## Roadmap Phases

### Phase 1: Multitenancy & Security Hardening (CRITICAL)
**Goal**: Make FABLE safe for multiple orgs/users.

| # | Work Item | Effort | Priority |
|---|-----------|--------|----------|
| 1.1 | MCP Gateway: filter tools by orgId from JWT | S | P0 |
| 1.2 | MCP Gateway: auth on delete/workflow endpoints | S | P0 |
| 1.3 | Pass orgId/userId to builder container from build-kickoff | S | P0 |
| 1.4 | Memory Lambda: reject empty orgId/userId instead of defaulting | S | P0 |
| 1.5 | Re-seed memories under orgId='default' | S | P0 |
| 1.6 | Audit all DynamoDB queries for org-scoping | M | P0 |
| 1.7 | Add buildId GSI to builds table (eliminate scan fallback) | S | P1 |
| 1.8 | Schedule memory decay function (weekly EventBridge -> Lambda) | S | P1 |

**Estimated effort**: 1-2 sessions

### Phase 2: Memory Experience ("FABLE Knows You")
**Goal**: Users feel FABLE is learning about them and their work.

| # | Work Item | Effort | Priority |
|---|-----------|--------|----------|
| 2.1 | Chat Lambda: call `session_start` per user to load preferences/history | M | P0 |
| 2.2 | System prompt: inject user preferences + recent context proactively | M | P0 |
| 2.3 | Chat Lambda: save user-stated preferences as memories automatically | M | P0 |
| 2.4 | Memory management API: list, view, delete user's own memories | M | P1 |
| 2.5 | Settings page: "What FABLE remembers" section with delete controls | M | P1 |
| 2.6 | Conversation-to-memory: extract key decisions/preferences from completed builds | L | P2 |
| 2.7 | Per-org memory: shared team knowledge ("Our API uses snake_case") | M | P2 |

**Estimated effort**: 2-3 sessions

### Phase 3: Chat UX Polish
**Goal**: Production-quality chat experience.

| # | Work Item | Effort | Priority |
|---|-----------|--------|----------|
| 3.1 | Streaming cursor / typing indicator while Bedrock responds | S | P0 |
| 3.2 | WebSocket reconnection with exponential backoff + status indicator | S | P0 |
| 3.3 | Vue error boundaries (prevent blank page crashes) | S | P1 |
| 3.4 | Conversation search in sidebar | S | P1 |
| 3.5 | Settings page (profile, preferences, display) | M | P1 |
| 3.6 | Build history page (past builds, status, retry info) | M | P1 |
| 3.7 | ThinkingBlock for extended reasoning visibility | S | P2 |
| 3.8 | Keyboard shortcuts (Cmd+K search, Cmd+N new chat) | S | P2 |
| 3.9 | Tool approval dialog (opt-in/out per tool in chat) | M | P2 |
| 3.10 | Connection health indicator in header | S | P2 |

**Estimated effort**: 2-3 sessions

### Phase 4: Build Pipeline Hardening
**Goal**: Reliable, auditable, scalable builds.

| # | Work Item | Effort | Priority |
|---|-----------|--------|----------|
| 4.1 | Distributed tracing (X-Ray across Lambda + ECS) | M | P1 |
| 4.2 | CloudWatch alarms (Lambda errors, build failures, ECS timeouts) | M | P1 |
| 4.3 | ECS task timeout enforcement | S | P1 |
| 4.4 | Build concurrency limits per org | S | P1 |
| 4.5 | Tool versioning in DynamoDB (semantic versions, rollback) | L | P2 |
| 4.6 | Immutable audit log table for infrastructure modifications | M | P2 |
| 4.7 | Pre-deployment schema validation | S | P2 |
| 4.8 | Cost attribution tags per org | M | P2 |

**Estimated effort**: 2-3 sessions

### Phase 5: Vertical Packs & Extensibility
**Goal**: Industry-specific capability bundles that accelerate adoption.

| # | Work Item | Effort | Priority |
|---|-----------|--------|----------|
| 5.1 | Vertical pack framework (template + seeded memories + onboarding) | L | P2 |
| 5.2 | First vertical pack (TBD — insurance, healthcare, or retail) | XL | P2 |
| 5.3 | Custom MCP server integration (user-provided tools) | L | P2 |
| 5.4 | Tool marketplace (shared across orgs) | XL | P3 |
| 5.5 | Multi-region deployment support | XL | P3 |

**Estimated effort**: Multiple sessions per item

### Phase 6: Infrastructure Optimization
**Goal**: Cost-efficient, scalable production infrastructure.

| # | Work Item | Effort | Priority |
|---|-----------|--------|----------|
| 6.1 | VPC endpoints for S3/DynamoDB (reduce NAT costs) | S | P2 |
| 6.2 | DynamoDB Point-in-Time Recovery for prod | S | P2 |
| 6.3 | RDS Proxy for Lambda -> Aurora connections | M | P2 |
| 6.4 | Lambda layers for shared dependencies | M | P3 |
| 6.5 | API Gateway response caching for tool listings | S | P3 |
| 6.6 | Aurora auto-pause for dev (cost savings) | S | P3 |

**Estimated effort**: 1-2 sessions

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| **P0** | Must fix before any new features. Security/correctness issue. |
| **P1** | Should fix soon. Affects user experience or reliability. |
| **P2** | Important but not urgent. Plan for next quarter. |
| **P3** | Nice to have. Optimize when convenient. |

## Effort Legend

| Size | Meaning |
|------|---------|
| **S** | Small — < 1 hour, single file change |
| **M** | Medium — 1-4 hours, multiple files |
| **L** | Large — Full session, architectural change |
| **XL** | Extra Large — Multiple sessions |

---

## Architecture Principles (From Brainstorm Docs)

These guide ALL roadmap decisions:

1. **The Loop is the Moat**: The self-extending loop (user request -> build -> deploy -> use) is the only defensible advantage. Everything else is commodity.

2. **Trust the Machine Spirit**: Don't over-engineer guardrails. CLAUDE.md templates guide behavior; Claude's reasoning fills the gaps.

3. **Prompts Over Code**: If you're writing TypeScript for orchestration, reconsider. Templates cascade knowledge; code is brittle.

4. **Observe, Don't Rescue**: When FABLE processes fail, fix the template or architecture — not the output.

5. **Self-Modification is a Feature**: FABLE can and should fix its own infrastructure. Dedicated "fix builds" are the preferred path for infrastructure bugs.

---

## Key Decisions Needed (3)

### Decision 1: Memory Scoping Model
**Context**: FABLE's runtime memory (Aurora PostgreSQL via Memory Lambda) needs clear scoping rules. Seeded memories currently use a hardcoded UUID org that doesn't match real user sessions.
**Options**:
- (A) Global "system" memories visible to all orgs + org-specific overlay
- (B) Copy seeded memories into each new org on first build
**Recommendation**: (A) — system knowledge (architecture patterns) is universal; org knowledge (preferences, domain) is scoped
**Note**: `packages/mcp-servers/memory/` (SQLite) is the local dev memory for Claude Code during development — NOT part of FABLE's runtime.

### Decision 2: Public Tools vs Org-Private Tools
**Context**: MCP Gateway currently exposes all tools publicly. Need to decide on visibility model.
**Options**:
- (A) All tools private to org by default, explicit "publish" action for public
- (B) All tools public by default (current behavior), explicit "private" flag
- (C) Two registries: org-private (DynamoDB) + public marketplace (separate)
**Recommendation**: (A) — private by default, with option to publish to a shared catalog

### Decision 3: Chat Streaming Architecture
**Context**: Chat Lambda already sends `chat_response` chunks via WebSocket. Frontend currently waits for `chat_complete`.
**Options**:
- (A) Real streaming: render each chunk as it arrives (requires frontend changes only)
- (B) Token-by-token streaming from Bedrock (requires Chat Lambda changes for invoke-with-response-stream)
**Recommendation**: (A) — the WebSocket infrastructure already supports it, just wire up the frontend

---

## Tracking

Update this section as work progresses:

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Multitenancy | COMPLETE | All 8 items done. GSI deployed, decay scheduled weekly. |
| Phase 2: Memory Experience | PARTIALLY DONE | Items 2.1-2.3 done (session_start, proactive recall, auto-save preferences). Items 2.4-2.7 remaining. |
| Phase 3: Chat UX | PARTIALLY DONE | ToolUseBlock, ChatInput, markdown done |
| Phase 4: Build Pipeline | NOT STARTED | |
| Phase 5: Vertical Packs | NOT STARTED | Depends on Phase 1-2 |
| Phase 6: Infrastructure | NOT STARTED | |

---

## Files Reference

| Area | Key Files |
|------|-----------|
| CDK Stack | `packages/infra/lib/fable-stack.ts` |
| Config | `packages/infra/lib/fable-config.ts`, `packages/infra/fable.config.ts` |
| Router | `packages/infra/lambda/router/index.ts` |
| Chat | `packages/infra/lambda/chat/index.ts` |
| Memory | `packages/infra/lambda/memory/index.ts` |
| Build Kickoff | `packages/infra/lambda/build-kickoff/index.ts` |
| Build Completion | `packages/infra/lambda/build-completion/index.ts` |
| Tool Deployer | `packages/infra/lambda/tool-deployer/index.ts` |
| MCP Gateway | `packages/infra/lambda/mcp-gateway/index.ts` |
| Infra Ops | `packages/infra/lambda/infra-ops/index.ts` |
| WS Auth | `packages/infra/lambda/ws-authorizer/index.ts` |
| Workflows | `packages/infra/lambda/workflow-executor/index.ts` |
| DB Init | `packages/infra/lambda/db-init/index.ts` |
| Builder Docker | `packages/infra/build/Dockerfile` |
| Builder Entry | `packages/infra/build/entrypoint.sh` |
| Builder Template | `iteration-2/templates/CLAUDE.md.builder` |
| MCP Sidecar | `packages/infra/mcp-sidecar/src/index.ts` |
| Frontend | `packages/ui/src/` |
| Chat Components | `packages/ui/src/components/chat/` |
| Stores | `packages/ui/src/stores/` |
| Types | `packages/ui/src/types/index.ts` |
| Seed Script | `scripts/seed-memories.ts` |
