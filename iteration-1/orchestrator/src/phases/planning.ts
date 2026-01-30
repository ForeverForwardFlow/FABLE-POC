/**
 * Planning Phase
 *
 * Takes structured requirements and produces a detailed plan
 * with tasks that can be dispatched to workers.
 *
 * Uses extended thinking for deep reasoning about:
 * - How to decompose the work
 * - What interfaces/contracts are needed
 * - Dependencies between tasks
 */

import type { Requirements, Plan, Task } from '@fable/shared';

/**
 * Keywords that suggest the request involves creating an MCP server.
 */
const MCP_SERVER_KEYWORDS = [
  'mcp server',
  'mcp tool',
  'create a tool',
  'add a tool',
  'build a tool',
  'integration',
  'api wrapper',
];

/**
 * Keywords that suggest multiple tools are requested.
 */
const MULTI_TOOL_PATTERNS = [
  /(?:tools?|functions?)[:\s]+(?:\d+|multiple|several)/i,
  /\b(?:with\s+)?(\d+)\s+tools?\b/i, // "with 3 tools" or "3 tools"
  /\b(?:and|,)\s+\w+\s+tool/i,
  /\btools?\s+(?:for|to)\s+\w+\s+and\s+\w+/i,
  /-\s+\w+[\s_]*tool/gi, // bullet point tool lists like "- list_repos tool"
];

/**
 * Analyze requirements to determine if multi-task decomposition is needed.
 *
 * @param requirements - The requirements to analyze
 * @returns Whether multi-task decomposition should be used
 */
function shouldDecompose(requirements: Requirements): boolean {
  const text = `${requirements.summary} ${requirements.details}`.toLowerCase();

  // Check for explicit multi-tool patterns
  for (const pattern of MULTI_TOOL_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }

  // Check if multiple acceptance criteria suggest separate modules
  if (requirements.acceptanceCriteria.length >= 4) {
    const toolCriteria = requirements.acceptanceCriteria.filter(
      (c) => c.toLowerCase().includes('tool') || c.toLowerCase().includes('implement')
    );
    if (toolCriteria.length >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Detect if this is an MCP server creation request.
 */
function isMcpServerRequest(requirements: Requirements): boolean {
  const text = `${requirements.summary} ${requirements.details}`.toLowerCase();
  return MCP_SERVER_KEYWORDS.some((keyword) => text.includes(keyword));
}

/**
 * Common words to filter out as tool names.
 */
const TOOL_NAME_STOP_WORDS = [
  'the',
  'a',
  'an',
  'this',
  'that',
  'new',
  'mcp',
  'echo',
  'with',
  'for',
  'to',
  'from',
  'and',
  'or',
  'each',
  'every',
  'first',
  'second',
  'third',
  'following',
  'different',
  'multiple',
  'various',
  'several',
  'some',
  'any',
  'other',
  'another',
];

/**
 * Extract tool names from requirements text.
 *
 * @param text - Text to extract tool names from
 * @returns List of detected tool names
 */
function extractToolNames(text: string): string[] {
  const tools: string[] = [];

  // Look for patterns like "tool X", "X tool", "create X", "add X"
  const patterns = [
    // Bullet list format: "- list_repos tool:" or "- get_pr tool"
    /-\s+([\w_]+)\s+tool[:\s]/gi,
    // Named format: "tool called X" or "tool named X"
    /tool\s+(?:called|named)\s+([\w_]+)/gi,
    // Create/implement format
    /(?:create|add|build|implement)\s+(?:a\s+)?([\w_]+)\s+tool/gi,
    // Generic "X tool" format (less specific, run last)
    /([\w_]+)\s+tool(?:\s|:|,|$)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].toLowerCase();
      // Filter out common non-tool words and ensure minimum length
      if (name.length >= 2 && !TOOL_NAME_STOP_WORDS.includes(name)) {
        tools.push(name);
      }
    }
  }

  return [...new Set(tools)]; // Remove duplicates
}

/**
 * Create a detailed plan from requirements.
 *
 * In the full implementation, this will use Claude Agent SDK
 * with high thinking token budget (32K-65K) for deep planning.
 * For now, uses rule-based decomposition to demonstrate the pattern.
 *
 * @param requirements - Structured requirements
 * @returns Plan with tasks ready for worker dispatch
 */
export async function createPlan(requirements: Requirements): Promise<Plan> {
  const timestamp = Date.now();
  // Include short timestamp suffix to make branch names unique across test runs
  const shortId = timestamp.toString(36).slice(-6);
  const baseSlug = `${slugify(requirements.summary)}-${shortId}`;

  // Determine if we should decompose into multiple tasks
  const decompose = shouldDecompose(requirements);
  const isMcp = isMcpServerRequest(requirements);

  // For MCP server requests with multiple tools, create separate tasks
  // Uses SPATIAL DECOMPOSITION - each task owns specific files, enabling parallelism
  if (decompose && isMcp) {
    const tools = extractToolNames(requirements.details);

    if (tools.length >= 2) {
      console.log(`[planning] Spatial decomposition: ${tools.length} parallel tool tasks: ${tools.join(', ')}`);

      // Task 1: Setup the MCP server structure
      // This task creates the base structure WITHOUT modifying tools/index.ts
      // (tools/index.ts is auto-generated during integration)
      const setupTask: Task = {
        id: `task-${timestamp}-setup`,
        title: 'Setup MCP server structure',
        description: `Create the MCP server boilerplate based on the template. Setup:
- Copy packages/mcp-servers/template/ to new directory
- Update package.json with correct name
- Copy tool-registry.ts and server-setup.ts
- Remove src/tools/example.ts (template placeholder)
- Ensure npm run build passes

IMPORTANT: Do NOT create src/tools/index.ts - it will be auto-generated during integration.`,
        branch: `feat/${baseSlug}-setup`,
        dependencies: [],
        acceptanceCriteria: [
          'MCP server directory created from template',
          'package.json updated with correct name',
          'tool-registry.ts copied from template',
          'example.ts removed from tools/',
          'npm run build passes',
        ],
        interfaceContracts: {
          serverSetup: 'export function create*Server(): Server',
        },
        fileOwnership: {
          create: [
            'packages/mcp-servers/*/package.json',
            'packages/mcp-servers/*/tsconfig.json',
            'packages/mcp-servers/*/src/index.ts',
            'packages/mcp-servers/*/src/server-setup.ts',
            'packages/mcp-servers/*/src/tool-registry.ts',
          ],
          modify: [],
        },
      };

      // Task 2+: Create each tool - these can run in PARALLEL
      // Each task owns ONLY its tool file and test file
      const toolTasks: Task[] = tools.map((toolName) => ({
        id: `task-${timestamp}-tool-${toolName}`,
        title: `Implement ${toolName} tool`,
        description: `Implement the ${toolName} tool for the MCP server.

IMPORTANT: Use the auto-registration pattern!

Create src/tools/${toolName}.ts following this pattern:
\`\`\`typescript
import { z } from 'zod';
import { registerTool } from '../tool-registry.js';

export const ${toPascalCase(toolName)}Input = z.object({
  // Define input schema
});

export async function ${toolName}Tool(input: z.infer<typeof ${toPascalCase(toolName)}Input>) {
  const validated = ${toPascalCase(toolName)}Input.parse(input);
  // Implementation
  return { result: ... };
}

// Self-register the tool
registerTool({
  name: '${toolName}',
  description: '...',
  inputSchema: ${toPascalCase(toolName)}Input,
  handler: ${toolName}Tool,
});
\`\`\`

DO NOT modify:
- src/tools/index.ts (auto-generated during integration)
- server-setup.ts
- Any other tool files`,
        branch: `feat/${baseSlug}-${toolName}`,
        dependencies: [setupTask.id], // All tools depend on setup
        acceptanceCriteria: [
          `src/tools/${toolName}.ts created with Zod schema`,
          `Tool uses registerTool() for self-registration`,
          `Tests written in __tests__/${toolName}.test.ts`,
          'npm run build && npm run test passes',
        ],
        interfaceContracts: {},
        fileOwnership: {
          create: [
            `packages/mcp-servers/*/src/tools/${toolName}.ts`,
            `packages/mcp-servers/*/__tests__/${toolName}.test.ts`,
          ],
          modify: [],
        },
      }));

      return {
        id: `plan-${timestamp}`,
        summary: `Create MCP server with ${tools.length} tools (parallel): ${tools.join(', ')}`,
        tasks: [setupTask, ...toolTasks],
        createdAt: new Date().toISOString(),
      };
    }
  }

  // Default: single task for simple requests
  const task: Task = {
    id: `task-${timestamp}`,
    title: requirements.summary,
    description: requirements.details,
    branch: `feat/${baseSlug}`,
    dependencies: [],
    acceptanceCriteria: requirements.acceptanceCriteria,
    interfaceContracts: {},
  };

  return {
    id: `plan-${timestamp}`,
    summary: requirements.summary,
    tasks: [task],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Convert a string to a URL-safe slug for branch names.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
    .replace(/-+$/, ''); // Remove any trailing hyphens after truncation
}

/**
 * Convert a snake_case or kebab-case string to PascalCase.
 * Examples: "add" -> "Add", "list_repos" -> "ListRepos"
 */
function toPascalCase(text: string): string {
  return text
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}
