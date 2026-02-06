# Memory System Design

**Date:** 2026-02-03
**Status:** Design decisions captured, implementation pending

## Purpose

Persistent context layer for:
1. **Personal Assistant** - Organic learning alongside project work
2. **FABLE** - Organizational/user memory for self-extending capabilities

## Core Problem

Current CLAUDE.md approach is reactive - requires manual updates and reminders to recall. Memory needs to be:
- **Automatically captured** without interrupting flow
- **Automatically recalled** at session start and relevant moments
- **Organically growing** alongside the work

---

## Design Decisions

### 1. Storage Location: Hierarchical

```
~/.claude/memory/global.db        # Global: preferences, cross-project patterns
~/Code/PROJECT/.fable/memory.db   # Project: project-specific insights, decisions
```

- Query both stores, merge results
- Project memories take precedence over global on conflicts
- For FABLE multi-tenancy: org-level and user-level stores added later

### 2. Memory Decay: Hybrid with Anchors

**Anchored types (no decay):**
- `insight` - Why decisions were made
- `preference` - User/org preferences
- `capability` - What has been built (FABLE)

**Decaying types:**
- `status` - Current state, where we left off
- `gotcha` - Problems encountered (older ones less relevant)
- `pattern` - Successful approaches (evolve over time)

**Mechanics:**
- Access boosts importance (frequently retrieved = more relevant)
- Explicit pin option for "always relevant"
- Decay means lower ranking in search, not deletion

### 3. Conflict Resolution: Supersession + Source Hierarchy

**Explicit relationships:**
- New memory can `supersedes` old memory
- Superseded memories still exist but rank lower

**Source hierarchy (higher wins):**
1. `user_stated` - User explicitly said this
2. `ai_corrected` - AI updated after user correction
3. `ai_inferred` - AI learned/inferred this

**Tiebreaker:** Recency (newer wins when unclear)

**Not conflicts:** Context-dependent memories ("X for local, Y for production") - tag with context, don't treat as contradiction

### 4. Privacy/Scope: Simple Levels with Expansion Path

**Current (assistant + FABLE POC):**

| Scope | Who Sees | Examples |
|-------|----------|----------|
| `private` | Only owner | Personal preferences, communication style |
| `project` | Repo collaborators | Architecture decisions, project gotchas |
| `global` | Cross-project | General patterns, learned capabilities |

**Future (FABLE multi-tenancy):**

| Scope | Who Sees | Examples |
|-------|----------|----------|
| `fable_core` | All FABLE instances | How to build MCP servers, general patterns |
| `org` | Organization members | Tech stack, deployment practices |
| `user` | Individual user | Their requests, their preferences |

**Default scope by memory type:**
- `preference` → `private`
- `insight`, `gotcha` → `project`
- `pattern`, `capability` → `global`

---

## Memory Types

| Type | Purpose | Anchored | Default Scope |
|------|---------|----------|---------------|
| `insight` | Why a decision was made | Yes | project |
| `gotcha` | What went wrong, how to avoid | No | project |
| `preference` | How user/org likes things done | Yes | private |
| `pattern` | Successful approach to problem type | No | global |
| `capability` | Built tool/server (FABLE) | Yes | global |
| `status` | Where we left off, current state | No | project |

---

## Automatic Triggers (To Implement)

### Capture Triggers

1. **Pattern detection during conversation**
   - "I learned that..." → capture as `insight` or `gotcha`
   - "You prefer..." → capture as `preference`
   - "This worked well..." → capture as `pattern`

2. **Hook-based capture**
   - Stop hook: "Anything from this session worth remembering?"
   - Error resolution: Capture what fixed it as `gotcha`
   - Task completion: Capture approach as `pattern`

3. **Context compaction**
   - Before summary: Extract critical memories
   - Preserve continuity across compactions

### Recall Triggers

1. **Session start**
   - After reading CLAUDE.md: Query for project memories
   - Inject recent work, open issues, critical gotchas

2. **Context-aware retrieval**
   - Working on specific feature → query related memories
   - Encountering error → check for similar past errors

3. **Proactive reminders**
   - Surface relevant gotchas before repeating mistakes
   - Remind of related patterns when approaching similar problems

---

## Knowledge Graph Relationships

| Relationship | Meaning |
|--------------|---------|
| `supersedes` | New memory replaces old understanding |
| `relates_to` | Connected concepts |
| `caused_by` | This gotcha caused by that decision |
| `fixed_by` | This problem solved by that pattern |
| `implements` | This capability implements that pattern |

---

## Implementation Path

### Phase 1: Foundation
- [ ] Deploy memory MCP server (Memora or similar)
- [ ] Configure for hierarchical storage (global + project)
- [ ] Test basic create/search

### Phase 2: Automatic Capture
- [ ] Add capture instructions to CLAUDE.md
- [ ] Implement Stop hook for session reflection
- [ ] Test organic capture during normal work

### Phase 3: Automatic Recall
- [ ] Add session start protocol to CLAUDE.md
- [ ] Implement memory query at conversation start
- [ ] Test context injection

### Phase 4: FABLE Integration
- [ ] Extend for capability tracking
- [ ] Add to OI/Worker templates
- [ ] Test memory across FABLE builds

---

## Open for Future

- Team collaboration patterns
- Memory export/import for backup
- Analytics on memory usage patterns
- Memory quality scoring
- Consolidation/summarization of related memories
