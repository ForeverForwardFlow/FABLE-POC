# Design Principles

Core philosophy for FABLE development. These principles guide every architectural and implementation decision.

## The Self-Extending Loop

FABLE's core value proposition:

```
User request → Orchestrator plans → Workers build → Tests pass → FABLE uses new capability
```

Every implementation decision should support this loop. If a change makes the loop harder to complete, it's likely wrong.

## Principles

### 1. Lightweight > Overwrought

- Prefer standard library over dependencies
- Simple patterns over clever abstractions
- 3 similar lines of code > premature abstraction
- If you need to explain why it's not over-engineered, it probably is

### 2. Few Moving Parts

- One language: TypeScript
- One test framework: Vitest
- One package manager: npm workspaces
- One build tool: tsc (via Turborepo)
- One deployment target per concern (Cloudflare for MCP, local for orchestrator)

### 3. Autonomous-Friendly

Workers must complete tasks without human intervention:

- Clear acceptance criteria (testable, not subjective)
- Programmatic verification (exit code 0 = success)
- Self-correcting iteration (Ralph Wiggum loop)
- No "ask a human" escape hatches

### 4. Context-Efficient

AI context is expensive. Minimize what's loaded:

- CLAUDE.md files < 100 lines
- Rules files loaded by path scope, not globally
- No duplication between config files and docs
- If it's in `package.json`, don't repeat it in CLAUDE.md

### 5. Verify Programmatically

Every assertion must have a command:

- "It works" → `npm run test` exits 0
- "It's type-safe" → `npm run typecheck` exits 0
- "It follows standards" → `npm run lint` exits 0
- "It deploys" → `npm run deploy` exits 0

Workers run verification before signaling completion. Integration runs verification after merge.

## Anti-Patterns

### Don't Do This

| Anti-Pattern                                    | Why It's Wrong                           | Do This Instead                  |
| ----------------------------------------------- | ---------------------------------------- | -------------------------------- |
| Add feature flags for hypothetical future needs | Adds complexity now for uncertain future | Just change the code when needed |
| Create utility classes/helpers for one-time use | Premature abstraction                    | Inline the logic                 |
| Add backwards-compatibility shims               | Creates maintenance burden               | Make the breaking change cleanly |
| Over-document with excessive comments           | Comments go stale, types don't           | Use clear types and names        |
| Add "just in case" error handling               | Handles impossible scenarios             | Trust internal code contracts    |
| Create config for things that don't vary        | Illusion of flexibility                  | Hardcode sensible defaults       |

### Recognize These Smells

- "We might need this later" → You don't need it now
- "This makes it more flexible" → Flexibility you won't use
- "Let's add an abstraction layer" → Premature generalization
- "I'll add comprehensive error handling" → For errors that can't happen

## Decision Framework

When making implementation choices:

1. **Does it make the self-extending loop work?** If no, reconsider.
2. **Is this the simplest thing that could work?** If no, simplify.
3. **Can a worker complete this autonomously?** If no, add clearer criteria.
4. **Is verification programmatic?** If no, add a command.
5. **Would I be embarrassed by over-engineering?** Trust your instinct.

## POC vs Production

This is a proof-of-concept. Different rules apply:

**POC priorities:**

- Prove the loop works end-to-end
- Fast iteration over perfect architecture
- Working code over comprehensive tests
- Simple patterns that can be replaced later

**NOT POC priorities:**

- Multi-tenancy, authentication, rate limiting
- Production error handling and monitoring
- Comprehensive test coverage
- Performance optimization

Get the loop working first. Production concerns come after POC validation.
