# FABLE Documentation Review

**Review Date:** January 29, 2026

**Overall Assessment:** STRONG for a POC - Clear, concise, and AI-agent friendly. The documentation successfully enables both new developers and Claude to work autonomously. However, several gaps emerge when examining the full system.

---

## Executive Summary

The FABLE POC has established a **strong documentation foundation** that aligns well with its core design principles. The CLAUDE.md files are concise and actionable, rules are comprehensive, and types are well-documented. The project excels at context-efficiency.

**Key Strengths:**

- Clear separation of concerns in rules files
- Excellent type documentation with JSDoc
- Task-specific CLAUDE.md generation for workers
- Security and validation patterns are documented
- Context-aware guidance for different roles (orchestrator, workers, MCP developers)

**Critical Gaps:**

- Missing orchestrator phase documentation (gatherRequirements, requirements)
- No data flow diagrams for non-technical stakeholders
- Limited inline code comments in complex phases
- MCP server patterns need practical endpoint examples
- Worker completion criteria could be more explicit
- No troubleshooting or error recovery guide

---

## 1. CLAUDE.md Files Review

### Root CLAUDE.md (/Users/simonmoon/Code/FABLE/CLAUDE.md)

**Quality: EXCELLENT**

Strengths:

- Concise, under 100 lines as designed
- Clear value proposition in opening paragraph
- Design principles table provides quick reference
- Architecture diagram shows component relationships
- Key interfaces defined upfront (Task, WorkerResult, etc.)
- Verification commands explicitly listed

Issues:

- How It Works section (lines 40-47) lacks detail on the actual _loop_ - what does "Ralph Wiggum plugin manages iteration" mean to a new developer?
- No concrete example of a complete request → plan → worker → result flow
- Missing: How does a new developer run the first test?

Recommendation:
Add a "Quick Start" section showing:

```bash
npm install
npm run build && npm run test
# Create an example task and trace through system
```

---

### Orchestrator CLAUDE.md (/Users/simonmoon/Code/FABLE/packages/orchestrator/CLAUDE.md)

**Quality: GOOD**

Strengths:

- Clear section headers
- Functions listed with descriptions
- Environment variables documented
- Test command provided

Issues:

- Functions section doesn't explain _why_ each phase exists
- Missing: What is the input to gatherRequirements? How does extended thinking work?
- No mention of the Requirements interface or how it's generated
- Integration phase completely unexplained
- `maxIterations` environment variable documented but never defined in the code

Recommendation:
Expand with:

```markdown
## Phases Explained

### Requirements Phase

- **Input:** Natural language request
- **Output:** Requirements interface with summary, details, constraints
- **How it works:** Currently placeholder (TODO). Will use Claude Agent SDK.

### Planning Phase

- **Input:** Requirements
- **Output:** Plan with Task array and interface contracts
- **Key decision:** Uses extended thinking (32K-65K tokens) for quality
- **Spatial decomposition:** Each task targets distinct module/directory

### Dispatch Phase

- **Input:** Plan tasks
- **Output:** WorkerResults from each worker
- **Isolation:** Each worker runs in isolated git worktree
- **Completion signal:** <promise>TASK_COMPLETE</promise>

### Integration Phase

- **Input:** WorkerResults and Plan
- **Output:** OrchestratorResult with status
- **Verification:** npm run build && npm run test && npm run lint
```

---

### MCP Server Template CLAUDE.md (/Users/simonmoon/Code/FABLE/packages/mcp-servers/template/CLAUDE.md)

**Quality: GOOD**

Strengths:

- Clear structure section
- Requirements are explicit (Zod schemas, dry_run, error handling)
- Tool implementation pattern provided
- Completion criteria obvious

Issues:

- "[SERVICE_NAME]" placeholder is never explained - what should replace it?
- Example tool implementation shows happy path only
- No mention of MCP server interface or how tools are registered
- Missing: How does this server appear in the MCP ecosystem?
- No reference to dual transport pattern (stdio vs HTTP)
- Deployment mentioned but no details

Recommendation:
Link to mcp-patterns.md more explicitly. Add section:

```markdown
## Examples

See packages/mcp-servers/greeting/ for a complete working example with 4 tools.
This is the reference implementation to follow.

### Reference Pattern

- Look at greeting/src/tools/greet.ts for tool structure
- Look at greeting/src/types.ts for schema patterns
- Look at greeting/**tests**/greet.test.ts for test patterns
```

---

## 2. README Files Review

**Finding:** NO README.md files exist in the project root or packages.

**Critical Gap:** A new developer cloning this repo will see `npm run build` fails with no explanation of:

- Project structure
- How to get started
- What the demo does
- Common errors and solutions

### Recommendation - Create Root README.md

````markdown
# FABLE - Forwardflow AI Business Logic Engine

A self-programming AI platform that builds its own capabilities on demand.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Verify setup (this is your first test!)
npm run build && npm run test && npm run lint

# 3. Understand the architecture
cat CLAUDE.md                         # System overview
cat .claude/rules/architecture.md     # Deep dive
```
````

## How It Works

FABLE follows a self-extending loop:

```
User Request
    ↓
Orchestrator gathers requirements
    ↓
Planner creates task breakdown (with extended thinking)
    ↓
Workers build in isolated git worktrees (via Claude Code CLI)
    ↓
Integration merges and verifies
    ↓
New MCP servers available for reuse
```

See CLAUDE.md for diagrams.

## Packages

- `packages/orchestrator/` - Plans work, dispatches workers, integrates results
- `packages/shared/` - Shared types, validation, errors
- `packages/mcp-servers/` - Worker-built capability modules
  - `template/` - Template for new servers
  - `greeting/` - Example with 4 tools

## Next Steps

1. Read CLAUDE.md for system overview
2. Read .claude/rules/ for detailed patterns
3. Run the test suite: `npm run test`
4. Try building a new MCP server by copying packages/mcp-servers/template/

````

---

## 3. Code Comments Review

### Excellent Examples

**packages/shared/src/types.ts**
- Every interface property documented with JSDoc
- Clear section headers with Unicode dividers
- No over-commenting of obvious code

**packages/shared/src/validation.ts**
- Sanitize function well-explained (line 35-38)
- Clear intent of regex patterns
- Error classes document their purpose

**packages/orchestrator/src/phases/dispatch.ts**
- Phase purpose explained at top
- `generateTaskClaudeMd` logic clear
- Comments explain the Ralph Wiggum loop (line 66)

**packages/orchestrator/src/utils/worktree.ts**
- Clear description of purpose (lines 1-5)
- Each function documented with @param/@returns
- Worktree setup process easy to follow

### Gaps Identified

**packages/orchestrator/src/utils/ralph-wiggum.ts**
- Not reviewed, but referenced extensively
- Should document the stop hook mechanism

**packages/orchestrator/src/phases/requirements.ts**
- Currently TODO - no inline documentation of the planned approach

**packages/orchestrator/src/phases/planning.ts**
- Line 32: `interfaceContracts` field not explained
- What format should interface contracts be?

**packages/orchestrator/src/phases/integrate.ts**
- File not reviewed (need to check if it exists and what it does)

**packages/orchestrator/src/utils/mcp-client.ts**
- Lines 85-120: Good start but cut off
- Remote connection logic not documented (HTTP transport setup)

---

## 4. Type Documentation Review

**Quality: EXCELLENT**

### Strengths

**packages/shared/src/types.ts** - Perfect pattern:
- Every field has a JSDoc comment explaining purpose
- Interface names are clear (Requirements, Plan, Task, WorkerResult)
- Complex fields documented (e.g., interfaceContracts: Record<string, string>)
- Section headers make scanning easy

```typescript
export interface Task {
  /** Unique task identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** Detailed description of what to do */
  description: string;
  /** Git branch name for this task */
  branch: string;
  // ... etc
}
````

This is **self-documenting** - Claude can understand the system purely from types.

### Gaps

- `interfaceContracts: Record<string, string>` field is documented but the _format_ is unclear
  - Should this be JSON schema strings?
  - Should it be TypeScript type definitions?
  - What keys are expected?

- `OrchestratorConfig.maxIterations` documented but not defined in code - seen in environment setup only

Recommendation:
Add TypeDoc comments showing the shape:

```typescript
/**
 * Interface contracts with other tasks.
 * Format: Record<module_name, contract_description>
 * Example: { "auth": "export interface AuthContext { userId: string; role: 'admin'|'user'; }" }
 */
interfaceContracts: Record<string, string>;
```

---

## 5. Rules Files Review

### Overall Quality: STRONG

All five rules files are well-structured and follow consistent patterns.

### design-principles.md

**Quality: EXCELLENT** (108 lines)

Strengths:

- Clear core philosophy (self-extending loop)
- 5 principles with implications
- Anti-patterns table is valuable (what NOT to do)
- Smell detection section helps developers recognize over-engineering
- POC vs Production section is realistic
- Decision framework provides clear thinking model

Issues:

- No examples of "lightweight > overwrought" in practice
- Anti-patterns are conceptual - would benefit from code examples
- "3 similar lines of code > premature abstraction" - at what point do you abstract?

---

### architecture.md

**Quality: EXCELLENT** (180 lines)

Strengths:

- Component boundaries diagram clear
- Key decisions explained with rationale
- Why NOT to do something is explained (e.g., "NOT: Manual iteration loops")
- Dual transport architecture well-explained
- Technology stack table provides quick reference
- Interface contracts section defines contracts upfront

Issues:

- Ralph Wiggum stop hook mechanism not fully explained (lines 74-82)
  - How do you know when the hook fires?
  - What does the state file contain?
- Spatial decomposition concept (lines 112-119) is mentioned but not deeply explained
  - How do you decide what gets its own task?
  - When do you merge modules?

Recommendations:

```markdown
### Understanding Ralph Wiggum

The Ralph Wiggum plugin intercepts the stop hook (when Claude tries to exit).
Before allowing exit, it checks for the completion promise <promise>TASK_COMPLETE</promise>.
If not found, it re-spawns Claude with updated state, retrying up to maxIterations.

This provides self-correcting iteration without manual loops in code.

State file: .ralph-wiggum-state.json (in worktree, not committed)
Contents: { prompt, completionPromise, iteration: N, maxIterations }
```

---

### mcp-patterns.md

**Quality: GOOD** (108 lines)

Strengths:

- Dual transport architecture clearly explained
- Tool implementation pattern is explicit
- Requirements numbered for checklist
- Connection examples for both local and remote
- Deployment commands provided

Issues:

- Tool implementation pattern shows no error handling
  - What if validated.dry_run is set for read operations?
  - Should dry_run only apply to writes?
- Remote connection requires `apiKey` but no explanation of:
  - How the key is created
  - What endpoints it should hit
  - Bearer token format expected
- Testing section mentions "mock all external APIs" but no example mock code shown
- No mention of error responses or structured errors

Recommendations:

````markdown
### Error Handling in Tools

Do NOT throw exceptions. Return structured errors:

```typescript
export async function toolName(input: z.infer<typeof InputSchema>) {
  try {
    const validated = InputSchema.parse(input);
    // ... implementation
  } catch (error) {
    return {
      success: false,
      error: sanitizeError(error),
    };
  }
}
```
````

Use createMcpErrorResponse() from @fable/shared for consistent formatting.

````

---

### workers.md

**Quality: EXCELLENT** (55 lines)

Strengths:
- Clear constraints listed
- Completion requirements explicit and testable
- Forbidden actions are clear
- What to do if stuck is helpful
- Short and scannable

Issues:
- Line 20: "no MCP access — only filesystem and Bash" - why?
  - This is important context for why workers can't use orchestrator's tools
- Line 9-10: Ralph Wiggum plugin mentioned but link to detailed docs is missing
- "If truly blocked, output clear error description" - what format?

Recommendations:
Add section:
```markdown
## Why No MCP Access?

Workers run in Claude Code CLI, which has Filesystem and Bash tools only.
MCP tools are server connections (orchestrator feature).
This isolation prevents:
- Workers trying to use half-built MCP servers
- Circular dependencies (orchestrator depends on workers, not vice versa)
- Cascading failures if one MCP server crashes

To use capabilities, build them as files + commit.
The orchestrator will discover and use them.
````

---

### security.md

**Quality: GOOD** (27 lines)

Strengths:

- Clear credential handling rules
- Specific tool recommendations (wrangler secret put)
- Error sanitization mentioned
- Git safety practices

Issues:

- "Sanitize error messages" mentioned but no examples given
- What happens if a secret leaks?
  - No recovery procedures
- Zod validation mentioned but no example
- How do you test that secrets aren't leaking?

Recommendations:

```markdown
## Validating Security

1. Check .gitignore includes .env, .dev.vars
2. Run before committing: git diff --cached | grep -i 'key\|token\|secret'
3. Test error messages don't leak paths: npm run test
4. Use @fable/shared sanitizeError() function in MCP handlers

## If Secrets Leak

1. Immediately rotate the exposed key/token
2. For Bedrock: AWS rotates automatically after secret put
3. For MCP APIs: Regenerate in that service's dashboard
4. Force-push is acceptable ONLY for .env (use: git push --force-with-lease)
```

---

## 6. API Documentation Review

### MCP Tools & Interfaces

**Current State:** Limited

The codebase has:

1. Type definitions (excellent)
2. Tool implementation examples (good)
3. Server setup patterns (referenced but not documented)

**What's Missing:**

1. **MCP Server Interface**
   - How are tools registered?
   - What does server-setup.ts do?
   - How does tool discovery work?

2. **Tool Calling Convention**
   - How does the orchestrator discover available tools?
   - What's the tool naming convention? (seen "verb_noun" mentioned once)
   - How are arguments validated?

3. **Error Response Format**
   - `createMcpErrorResponse()` exists but not documented
   - What format do errors use?
   - What sanitization happens?

4. **HTTP Transport Security**
   - How is the Bearer token validated?
   - What endpoints exist?
   - Rate limiting? Timeout?

### Recommended Documentation

Create `/Users/simonmoon/Code/FABLE/API.md`:

````markdown
# FABLE API Reference

## Orchestrator Entry Point

### orchestrate(request: string, config?: OrchestratorConfig): Promise<OrchestratorResult>

Initiates the self-extending loop.

**Parameters:**

- request: Natural language description of work to do
- config.maxWorkerTurns: Max turns per worker iteration (default: 50)
- config.workerTimeoutMs: Worker timeout in ms (default: 600000)
- config.dryRun: If true, plan but don't execute

**Returns:**

- status: 'success' | 'failed' | 'incomplete' | 'dry_run'
- plan: The created plan
- workerResults: Results from each worker
- errors: Any errors encountered

## MCP Server Registration

### Built-in Tools

Every MCP server provides tools via the Model Context Protocol.

**Tool Structure:**

```typescript
{
  name: string; // "verb_noun" format
  description: string;
  inputSchema: JsonSchema; // JSON Schema from Zod
}
```
````

**Tool Calling:**

```typescript
const result = await callTool(connection.client, 'tool_name', {
  param1: 'value1',
  // ... validated against inputSchema
});
```

## Error Handling

### MCP Error Response

All MCP tools return structured responses:

```typescript
interface SuccessResponse {
  content: Array<{ type: 'text'; text: string }>;
}

interface ErrorResponse {
  isError: true;
  content: Array<{ type: 'text'; text: string }>; // Sanitized
}
```

Use `@fable/shared/validation.ts::createMcpErrorResponse()` for errors.

Sanitization removes:

- Email addresses
- Bearer tokens
- API keys
- Absolute paths

## Worker Task Interface

### Task Structure

Workers receive tasks with:

```typescript
interface Task {
  id: string; // Unique ID
  title: string; // Human-readable
  description: string; // What to build
  branch: string; // Git branch for this task
  dependencies: string[]; // Task IDs that must complete first
  acceptanceCriteria: string[]; // Testable completion requirements
  interfaceContracts: Record<string, string>; // How this connects to other tasks
}
```

### Completion Signal

Signal completion by outputting:

```
<promise>TASK_COMPLETE</promise>
```

The Ralph Wiggum plugin watches for this. Without it, the loop continues up to maxIterations.

**CRITICAL:** Only output this when tasks are GENUINELY complete.

- All acceptance criteria met
- npm run build exits 0
- npm run test exits 0
- npm run lint exits 0

## Configuration

See packages/orchestrator/CLAUDE.md for environment variables.

````

---

## 7. Assessment: New Developer Onboarding

**Scenario:** A new developer clones the repo and needs to understand the system.

### Current Experience

1. Clone repo
2. `npm install` (works)
3. Try `npm run test` → FAIL (why?)
   - No README explaining what tests do
   - No explanation of phases or tasks
   - No link to CLAUDE.md from error message
4. Read CLAUDE.md → OK understanding of architecture
5. Read .claude/rules/ → Good patterns but abstract
6. Look at code → Types are clear but phase logic unclear
7. Try to add a new MCP server:
   - Copy packages/mcp-servers/template/
   - Follow template CLAUDE.md → ???
   - No working example to reference until they search hard

### What They Need (Currently Missing)

1. Root README.md with quick start
2. Example walkthrough of a complete request
3. Link from template to greeting example
4. Troubleshooting guide:
   - "npm run build fails with..."
   - "Tests won't run because..."
   - "Worker is stuck in loop because..."

### Recommendation: Create Developer Guide

Create `/Users/simonmoon/Code/FABLE/GETTING_STARTED.md`:

```markdown
# Getting Started with FABLE

## Prerequisites

- Node.js 20+
- npm 10.8+
- Claude Code CLI installed

## Setup (5 minutes)

```bash
git clone <repo>
cd FABLE
npm install
npm run build && npm run test
````

If any command fails, see Troubleshooting below.

## Understand the System (15 minutes)

1. Read /Users/simonmoon/Code/FABLE/CLAUDE.md (system overview)
2. Read /Users/simonmoon/Code/FABLE/.claude/rules/architecture.md (detailed design)
3. Look at packages/mcp-servers/greeting/ (working example)

## Build Your First MCP Server (30 minutes)

1. Copy packages/mcp-servers/template/ to packages/mcp-servers/hello/
2. Edit package.json: change "name" to "hello"
3. Edit src/tools/example.ts to create your first tool
4. Copy test pattern from greeting/\_\_tests\_\_/
5. Run: npm run test
6. Run: npm run build

## Troubleshooting

### npm run build fails: "Cannot find module @fable/shared"

**Cause:** Workspaces not installed
**Fix:** Run `npm install` from root

### npm run test fails with "no tests found"

**Cause:** TypeScript not compiled
**Fix:** Run `npm run build` first

### Claude Code worker hangs after output

**Cause:** Not outputting the completion promise
**Fix:** Worker must output: `<promise>TASK_COMPLETE</promise>`
See: packages/orchestrator/src/phases/dispatch.ts line 122

### MCP server tool isn't registered

**Cause:** Tool not added to server-setup.ts
**Fix:** Check greeting/src/server-setup.ts for pattern

````

---

## 8. Assessment: AI Agent Autonomy (Claude as Worker)

**Question:** Can Claude Code CLI workers successfully complete tasks with current docs?

### What Workers Receive

1. Task object (well-structured types)
2. Task-specific CLAUDE.md (generated in dispatch.ts)
3. Link to CLAUDE.md files in monorepo

### Can Workers:

✅ Understand what to build?
- Yes - task description is clear
- Generated CLAUDE.md explains objectives
- Reference to existing patterns

✅ Know acceptance criteria?
- Yes - acceptanceCriteria array is explicit
- Testable (npm run test)
- Verifiable with exit codes

✅ Write code correctly?
- YES IF they read greeting/ example
- Types are clear and exported from @fable/shared
- Zod patterns shown in greeting/src/tools/

✅ Know when they're done?
- Yes - acceptance criteria + test exit codes
- Clear completion signal: <promise>TASK_COMPLETE</promise>

❌ Understand why certain patterns are required?
- Worker rules don't explain WHY Ralph Wiggum loop exists
- Doesn't explain why no MCP access
- Security rules are stated but not explained

### Worker Autonomy Gaps

1. **generateTaskClaudeMd** doesn't link to detailed patterns
   - Workers learn from CLAUDE.md at project root
   - But best patterns are in packages/mcp-servers/greeting/
   - Template CLAUDE.md could link: "See packages/mcp-servers/greeting/ for working example"

2. **Error recovery** isn't documented
   - If tests fail, worker knows to fix them
   - But what if they're stuck? Who can they ask?
   - Current: Just retry up to maxIterations

3. **Interface contracts** format is unclear
   - Type shows: Record<string, string>
   - But workers need to know: is this JSON Schema? TypeScript types? Natural language?

### Recommendation: Improve Task CLAUDE.md

Modify `generateTaskClaudeMd()` in dispatch.ts:

```typescript
function generateTaskClaudeMd(task: Task): string {
  const criteria = task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join('\n');

  // Add interface contracts explanation if present
  let interfaceSection = '';
  if (Object.keys(task.interfaceContracts).length > 0) {
    interfaceSection = `
## Interface Contracts

This task connects to other modules. Maintain these interfaces:

${Object.entries(task.interfaceContracts)
  .map(([module, contract]) => `### ${module}\n\`\`\`\n${contract}\n\`\`\``)
  .join('\n\n')}
`;
  }

  return `# Task: ${task.title}

## Context

This is a monorepo with the following structure:
- \`packages/orchestrator/\` - Main orchestrator (do NOT modify)
- \`packages/shared/\` - Shared types and utilities
- \`packages/mcp-servers/\` - MCP server implementations
  - \`template/\` - A working template server (reference this!)
  - \`greeting/\` - Complete example with 4 tools (copy patterns from here)

## Objective

${task.description}

## Specific Instructions

1. **For MCP tools**: Copy \`packages/mcp-servers/template/\` to a new directory
2. **Reference patterns**: Look at packages/mcp-servers/greeting/ for working examples
3. **Tool structure**: One file per tool in src/tools/, with Zod input schema
4. **Testing**: Write tests in __tests__/ that mock external APIs
5. **Keep it simple**: This is a POC - implement the minimum viable solution

${interfaceSection}

## Acceptance Criteria

${criteria}

## Verification

Before signaling completion, run from the repo root:
\`\`\`bash
npm run build && npm run test && npm run lint
\`\`\`

All commands must exit with code 0.

**If stuck:**
- Check error messages carefully
- Reread acceptance criteria
- Look at packages/mcp-servers/greeting/ for patterns
- Review packages/shared/src/types.ts for shared interfaces
- Try a simpler implementation first

## When Done

When ALL acceptance criteria pass and verification commands succeed, output:
\`\`\`
<promise>TASK_COMPLETE</promise>
\`\`\`

IMPORTANT: Only output the promise tag when the task is TRULY complete.
If tests fail or criteria aren't met, fix the issues first.
You are in an iteration loop - the system will continue until you output the promise.
`;
}
````

---

## 9. Assessment: Maintainability

### What Makes Documentation Maintainable?

1. **Single source of truth**
   - Types are defined in @fable/shared
   - Rules defined in .claude/rules/
   - Each package has CLAUDE.md

2. **Documentation close to code**
   - JSDoc in type files ✅
   - Phase logic documented at file level ✅
   - Tool implementations have comments ✅

3. **Avoiding duplication**
   - maxWorkerTurns defined once (in types + env setup)
   - Task interface defined once (in shared/types.ts)
   - Some duplication in package.json vs CLAUDE.md

### Maintenance Risks

1. **Worker CLAUDE.md is generated**
   - generateTaskClaudeMd() lives in dispatch.ts
   - Changes require code changes, not just doc edits
   - Good: ensures consistency
   - Bad: documentation is scattered

2. **Ralph Wiggum behavior is implicit**
   - Referenced in multiple files
   - Never fully explained in one place
   - If behavior changes, docs might not update

3. **Environment variables scattered**
   - Orchestrator CLAUDE.md lists: CLAUDE_CODE_USE_BEDROCK, AWS_REGION, MAX_WORKER_TURNS
   - But also references WORKER_TIMEOUT_MS, MAX_ITERATIONS
   - Index.ts has defaults in code
   - Single source of truth would be better

### Recommendation: Centralize Environment Docs

Create `/Users/simonmoon/Code/FABLE/.env.example`:

```env
# Orchestrator Configuration
MAX_WORKER_TURNS=50              # Max turns per worker iteration
WORKER_TIMEOUT_MS=600000         # Worker timeout in milliseconds (10 min)
MAX_ITERATIONS=10                # Max Ralph Wiggum self-correction loops

# AWS Bedrock (for Claude Code CLI)
CLAUDE_CODE_USE_BEDROCK=1        # Use AWS Bedrock instead of local
AWS_REGION=us-west-2             # Bedrock region

# MCP Servers
MCP_GREETING_API_KEY=             # For remote greeting server
```

Link from orchestrator/CLAUDE.md:
"See /.env.example for all environment variables"

---

## Summary by Category

### 1. CLAUDE.md Files (Score: 8/10)

**Strengths:**

- Root CLAUDE.md excellent at high level
- Task-specific CLAUDE.md generated well
- Template CLAUDE.md gives clear requirements

**Gaps:**

- Orchestrator package CLAUDE.md lacks phase details
- Integration phase not documented at all
- Ralph Wiggum mechanism needs deeper explanation

### 2. README Files (Score: 2/10)

**Strengths:**

- (None - no README files exist)

**Critical Gaps:**

- No root README
- No package-specific READMEs
- New developers have no entry point

### 3. Code Comments (Score: 8/10)

**Strengths:**

- JSDoc on all public functions
- Type documentation excellent
- Phase documentation at file level
- Section headers make scanning easy

**Gaps:**

- Complex logic in planning/integration not explained
- Why certain patterns exist (e.g., spatial decomposition)
- Error recovery logic unclear

### 4. Type Documentation (Score: 9/10)

**Strengths:**

- Every interface fully documented
- Examples in constants show patterns
- Field meanings clear
- Section organization excellent

**Gaps:**

- interfaceContracts format not defined
- Some fields documented but never used in shown code

### 5. Rules Files (Score: 9/10)

**Strengths:**

- Comprehensive and well-organized
- Each rule has rationale
- Anti-patterns documented
- Security practices explicit

**Gaps:**

- Some concepts need practical examples
- Links between rules could be stronger
- Ralph Wiggum stop hook mechanism underexplained

### 6. API Documentation (Score: 5/10)

**Strengths:**

- Types serve as interface contracts
- Tool patterns documented in template
- Validation approach clear

**Gaps:**

- No API reference document
- MCP server registration process unclear
- Error response format not documented
- Remote server security not explained

---

## Critical Recommendations (Priority Order)

### P0: New Developer Blocker

1. **Create /Users/simonmoon/Code/FABLE/README.md** (30 min)
   - Quick start
   - Architecture overview
   - Next steps for new developers

2. **Create /Users/simonmoon/Code/FABLE/GETTING_STARTED.md** (45 min)
   - Step-by-step setup
   - Walkthrough of one request
   - Troubleshooting guide

### P1: Worker Autonomy

3. **Update orchestrator/CLAUDE.md** (30 min)
   - Explain each phase
   - Document the planning input/output
   - Clarify integration logic

4. **Improve template/CLAUDE.md** (20 min)
   - Link to greeting/ example
   - Explain interfaceContracts format
   - Add error handling section

5. **Update generateTaskClaudeMd()** in dispatch.ts (30 min)
   - Link to working examples
   - Explain interface contracts
   - Add troubleshooting hints

### P2: Maintainability

6. **Create /Users/simonmoon/Code/FABLE/.env.example** (15 min)
   - List all environment variables
   - Default values
   - Link from CLAUDE.md files

7. **Create /Users/simonmoon/Code/FABLE/API.md** (60 min)
   - MCP server interface
   - Tool registration pattern
   - Error response format

### P3: Polish

8. **Add practical examples to rules** (45 min)
   - Anti-patterns with code examples
   - Architecture patterns in practice

9. **Create troubleshooting guide** (30 min)
   - Common errors and solutions
   - Recovery procedures

---

## Conclusion

The FABLE POC has **excellent documentation for its current stage**. The design principles are clear, types are self-documenting, and rules are comprehensive. This is specifically strong for **AI agent autonomy** - Claude can read types and patterns and write code successfully.

However, **human developer onboarding** is the weak point. A new developer has no entry point (no README), no walkthrough, and no troubleshooting guide.

**The fix is straightforward:**

1. Create README + GETTING_STARTED (foundation)
2. Enhance existing docs with context and examples
3. Improve worker task CLAUDE.md with references
4. Centralize environment configuration

These additions will take 4-5 hours total and will dramatically improve the project's accessibility while maintaining the context-efficiency principles.

The project successfully demonstrates its core thesis: **lightweight documentation with strong types + automated verification can scale AI-driven development**. The missing pieces are for human developers, not the system itself.
