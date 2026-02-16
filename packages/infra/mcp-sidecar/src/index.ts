#!/usr/bin/env node
/**
 * FABLE MCP Sidecar
 *
 * Stdio MCP server that bridges to Memory Lambda + Infra-Ops Lambda
 * via AWS SDK direct invocation (not HTTP Function URLs).
 * Runs as a sidecar subprocess in ECS, providing memory and infrastructure tools to Claude Code.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const MEMORY_LAMBDA_NAME = process.env.MEMORY_LAMBDA_NAME;
const INFRA_OPS_LAMBDA_NAME = process.env.INFRA_OPS_LAMBDA_NAME;
const BUILD_ID = process.env.FABLE_BUILD_ID || 'unknown';
const ORG_ID = process.env.FABLE_ORG_ID || '00000000-0000-0000-0000-000000000001';
const USER_ID = process.env.FABLE_USER_ID || '00000000-0000-0000-0000-000000000001';

if (!MEMORY_LAMBDA_NAME) {
  console.error('MEMORY_LAMBDA_NAME environment variable is required');
  process.exit(1);
}

const lambdaClient = new LambdaClient({});

// Memory tool definitions
const MEMORY_TOOLS = [
  {
    name: 'mcp__memory__memory_create',
    description: 'Create a new persistent memory. Use this to capture insights, gotchas, preferences, patterns, capabilities, or status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['insight', 'gotcha', 'preference', 'pattern', 'capability', 'status'],
          description: 'Type of memory'
        },
        content: { type: 'string', description: 'The memory content - what should be remembered' },
        scope: { type: 'string', enum: ['private', 'project', 'global'], description: 'Visibility scope' },
        source: { type: 'string', enum: ['user_stated', 'ai_corrected', 'ai_inferred'], description: 'Source of memory' },
        importance: { type: 'number', minimum: 0, maximum: 1, description: 'Initial importance (0-1)' },
        pinned: { type: 'boolean', description: 'Pin memory to prevent decay' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        context: { type: 'object', description: 'Additional context' },
        project: { type: 'string', description: 'Project identifier' },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'mcp__memory__memory_search',
    description: 'Search for relevant memories using semantic similarity and keyword matching.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query - describe what you are looking for' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum results' },
        types: { type: 'array', items: { type: 'string' }, description: 'Filter by memory types' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        project: { type: 'string', description: 'Filter by project' },
      },
      required: ['query'],
    },
  },
  {
    name: 'mcp__memory__memory_session_start',
    description: 'Retrieve relevant context at the start of a session. Returns prioritized memories.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Current project identifier' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum memories to retrieve' },
      },
    },
  },
  {
    name: 'mcp__memory__memory_boost',
    description: "Increase a memory's importance score when it proves useful.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'ID of the memory to boost' },
        amount: { type: 'number', minimum: 0.01, maximum: 0.5, description: 'Boost amount' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mcp__memory__memory_pin',
    description: 'Pin or unpin a memory. Pinned memories never decay.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'ID of the memory to pin/unpin' },
        pinned: { type: 'boolean', description: 'Pin state' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mcp__memory__memory_relate',
    description: 'Create a relationship between two memories.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fromId: { type: 'string', description: 'ID of the source memory' },
        toId: { type: 'string', description: 'ID of the target memory' },
        type: {
          type: 'string',
          enum: ['supersedes', 'relates_to', 'caused_by', 'fixed_by', 'implements'],
          description: 'Relationship type'
        },
      },
      required: ['fromId', 'toId', 'type'],
    },
  },
];

// Infra-ops tool definitions (only if INFRA_OPS_LAMBDA_NAME is configured)
const INFRA_TOOLS = [
  {
    name: 'mcp__infra__read_logs',
    description: 'Read CloudWatch logs for a FABLE component. Use this to diagnose failures.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        component: { type: 'string', description: 'Component name (e.g. "build-completion", "tool-deployer", "router")' },
        timeRange: { type: 'number', description: 'Time range in minutes (default: 30)' },
        filterPattern: { type: 'string', description: 'CloudWatch filter pattern (e.g. "ERROR", "buildId")' },
        limit: { type: 'number', description: 'Max log events to return (default: 100, max: 500)' },
      },
      required: ['component'],
    },
  },
  {
    name: 'mcp__infra__get_lambda_config',
    description: 'Get Lambda function configuration (runtime, timeout, memory, env vars). Sensitive values are redacted.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        component: { type: 'string', description: 'Component name (e.g. "build-completion", "tool-deployer")' },
      },
      required: ['component'],
    },
  },
  {
    name: 'mcp__infra__get_lambda_code',
    description: 'Download and return Lambda source code from its deployment package.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        component: { type: 'string', description: 'Component name (e.g. "build-completion", "tool-deployer")' },
      },
      required: ['component'],
    },
  },
  {
    name: 'mcp__infra__test_invoke',
    description: 'Invoke a FABLE Lambda with a test payload and return the response.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        component: { type: 'string', description: 'Component name (e.g. "tool-deployer", "build-completion")' },
        payload: { type: 'object', description: 'JSON payload to send to the Lambda' },
      },
      required: ['component', 'payload'],
    },
  },
  {
    name: 'mcp__infra__describe_ecs_tasks',
    description: 'List recent ECS build tasks with status, exit codes, and stop reasons.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['RUNNING', 'STOPPED'], description: 'Task status filter (default: STOPPED)' },
        limit: { type: 'number', description: 'Max tasks to return (default: 10, max: 50)' },
      },
    },
  },
  {
    name: 'mcp__infra__update_lambda_code',
    description: 'Update a FABLE Lambda function code from an S3 artifact. Protected functions cannot be modified.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        component: { type: 'string', description: 'Component name to update' },
        s3Key: { type: 'string', description: 'S3 key of the deployment zip in the artifacts bucket' },
        reason: { type: 'string', description: 'Explanation of why this change is needed (required for audit)' },
      },
      required: ['component', 's3Key', 'reason'],
    },
  },
  {
    name: 'mcp__infra__update_template',
    description: 'Update the builder template (CLAUDE.md.builder) in S3. Takes effect on the next build.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        templateName: { type: 'string', description: 'Template name (currently only "CLAUDE.md.builder")' },
        content: { type: 'string', description: 'New template content' },
        reason: { type: 'string', description: 'Explanation of why this change is needed (required for audit)' },
      },
      required: ['templateName', 'content', 'reason'],
    },
  },
];

// Map tool names to Lambda actions
const memoryToolToAction: Record<string, string> = {
  'mcp__memory__memory_create': 'create',
  'mcp__memory__memory_search': 'search',
  'mcp__memory__memory_session_start': 'session_start',
  'mcp__memory__memory_boost': 'boost',
  'mcp__memory__memory_pin': 'pin',
  'mcp__memory__memory_relate': 'relate',
};

const infraToolToAction: Record<string, string> = {
  'mcp__infra__read_logs': 'read_logs',
  'mcp__infra__get_lambda_config': 'get_lambda_config',
  'mcp__infra__get_lambda_code': 'get_lambda_code',
  'mcp__infra__test_invoke': 'test_invoke',
  'mcp__infra__describe_ecs_tasks': 'describe_ecs_tasks',
  'mcp__infra__update_lambda_code': 'update_lambda_code',
  'mcp__infra__update_template': 'update_template',
};

// Invoke a Lambda function directly via AWS SDK (auto-signs with ECS task role)
async function invokeLambda(functionName: string, payload: unknown): Promise<unknown> {
  const response = await lambdaClient.send(new InvokeCommand({
    FunctionName: functionName,
    Payload: Buffer.from(JSON.stringify(payload)),
  }));

  if (response.FunctionError) {
    const errorBody = Buffer.from(response.Payload!).toString();
    throw new Error(`Lambda ${functionName} error: ${errorBody}`);
  }

  const resultStr = Buffer.from(response.Payload!).toString();
  return JSON.parse(resultStr);
}

// Call the Memory Lambda (direct invocation format: { action, payload, orgId, userId })
async function callMemoryLambda(action: string, payload: Record<string, unknown>): Promise<unknown> {
  const result = await invokeLambda(MEMORY_LAMBDA_NAME!, {
    action,
    payload: {
      ...payload,
      userId: USER_ID,
      orgId: ORG_ID,
    },
    orgId: ORG_ID,
    userId: USER_ID,
  }) as { statusCode: number; body: string };

  if (result.statusCode !== 200) {
    const body = JSON.parse(result.body);
    throw new Error(body.error || `Memory Lambda returned ${result.statusCode}`);
  }

  return JSON.parse(result.body);
}

// Call the Infra-Ops Lambda (direct invocation format: { action, buildId, params })
async function callInfraOpsLambda(action: string, params: Record<string, unknown>): Promise<unknown> {
  if (!INFRA_OPS_LAMBDA_NAME) {
    throw new Error('INFRA_OPS_LAMBDA_NAME not configured');
  }

  const result = await invokeLambda(INFRA_OPS_LAMBDA_NAME, {
    action,
    buildId: BUILD_ID,
    params,
  }) as Record<string, unknown>;

  if (result.error) {
    throw new Error(String(result.error));
  }

  return result;
}

// Create and run the MCP server
async function main() {
  const server = new Server(
    {
      name: 'fable-sidecar',
      version: '3.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Build the tool list: memory tools always, infra tools only if configured
  const allTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [...MEMORY_TOOLS];
  if (INFRA_OPS_LAMBDA_NAME) {
    allTools.push(...INFRA_TOOLS);
    console.error(`Infra-ops tools enabled (${INFRA_TOOLS.length} tools)`);
  } else {
    console.error('INFRA_OPS_LAMBDA_NAME not set, infra tools disabled');
  }

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: allTools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Check memory tools first
      const memoryAction = memoryToolToAction[name];
      if (memoryAction) {
        const result = await callMemoryLambda(memoryAction, args as Record<string, unknown>);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Check infra tools
      const infraAction = infraToolToAction[name];
      if (infraAction) {
        const result = await callInfraOpsLambda(infraAction, args as Record<string, unknown>);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`FABLE MCP Sidecar running on stdio (${allTools.length} tools: ${MEMORY_TOOLS.length} memory + ${INFRA_OPS_LAMBDA_NAME ? INFRA_TOOLS.length : 0} infra)`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
