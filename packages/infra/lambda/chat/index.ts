import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand, PutCommand, UpdateCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand, UpdateScheduleCommand, GetScheduleCommand } from '@aws-sdk/client-scheduler';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const bedrockClient = new BedrockRuntimeClient({ region: 'us-west-2' });
const lambdaClient = new LambdaClient({});
const schedulerClient = new SchedulerClient({});

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const TOOLS_TABLE = process.env.TOOLS_TABLE!;
const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE!;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!;
const MEMORY_LAMBDA_ARN = process.env.MEMORY_LAMBDA_ARN!;
const WORKFLOW_EXECUTOR_ARN = process.env.WORKFLOW_EXECUTOR_ARN!;
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN!;
const STAGE = process.env.STAGE!;

interface ChatEvent {
  connectionId: string;
  message: string;
  userId: string;
  orgId: string;
  context: {
    conversationId: string;
    messages: Array<{ role: string; content: string | ContentBlock[] }>;
    activeBuildId: string | null;
  };
  intent: {
    type: string;
    confidence: number;
    reason: string;
  };
  requestId?: string;
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface FableTool {
  toolName: string;
  functionUrl: string;
  schema: {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
  };
}

interface BedrockTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const handler = async (event: ChatEvent): Promise<void> => {
  const { connectionId, message, userId, orgId, context, intent, requestId } = event;

  console.log(`Chat handler invoked for ${connectionId}, intent: ${intent.type}`);

  const messageId = crypto.randomUUID();

  try {
    // Query relevant memories and available tools in parallel
    const [memories, tools] = await Promise.all([
      queryMemories(message, userId, orgId),
      discoverTools(orgId),
    ]);

    console.log(`Found ${tools.length} tools for org ${orgId}`);

    // Build system prompt
    const systemPrompt = buildSystemPrompt(memories, context, intent, tools);

    // Convert tools to Bedrock format (external + internal workflow tools)
    const bedrockTools: BedrockTool[] = [
      ...tools.map(t => ({
        name: t.schema.name,
        description: t.schema.description,
        input_schema: (t.schema.inputSchema || { type: 'object', properties: {} }) as BedrockTool['input_schema'],
      })),
      ...INTERNAL_WORKFLOW_TOOLS,
    ];

    // Build messages array with conversation history
    const messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }> = [
      ...context.messages.slice(-10).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: message },
    ];

    // Tool use loop - Claude may request multiple tool calls
    let fullContent = '';
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      iterations++;

      // Call Bedrock (non-streaming for tool use simplicity)
      const requestBody: Record<string, unknown> = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        system: systemPrompt,
        messages,
      };

      if (bedrockTools.length > 0) {
        requestBody.tools = bedrockTools;
      }

      const response = await bedrockClient.send(new InvokeModelCommand({
        modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      }));

      const result = JSON.parse(new TextDecoder().decode(response.body));

      // Process response content
      const assistantContent: ContentBlock[] = [];
      let hasToolUse = false;

      for (const block of result.content || []) {
        if (block.type === 'text') {
          fullContent += block.text;
          assistantContent.push({ type: 'text', text: block.text });

          // Send text to client
          await sendToConnection(connectionId, {
            type: 'chat_chunk',
            payload: { content: block.text, messageId },
            requestId,
          });
        } else if (block.type === 'tool_use') {
          hasToolUse = true;
          assistantContent.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          });

          // Notify client about tool use
          await sendToConnection(connectionId, {
            type: 'tool_use',
            payload: { toolName: block.name, toolId: block.id, messageId },
            requestId,
          });

          console.log(`Tool use requested: ${block.name}`);
        }
      }

      // Add assistant message to history
      messages.push({ role: 'assistant', content: assistantContent });

      // If no tool use, we're done
      if (!hasToolUse || result.stop_reason === 'end_turn') {
        break;
      }

      // Execute tool calls and add results
      const toolResults: ContentBlock[] = [];

      for (const block of assistantContent) {
        if (block.type === 'tool_use' && block.name && block.id) {
          try {
            let toolResult: unknown;

            if (block.name.startsWith('fable_')) {
              // Internal workflow tool — dispatch locally
              toolResult = await handleInternalTool(block.name, block.input || {}, orgId, userId, connectionId);
            } else {
              // External tool — invoke via Function URL
              const tool = tools.find(t => t.schema.name === block.name);
              if (!tool) {
                throw new Error(`Tool ${block.name} not found`);
              }
              toolResult = await invokeToolFunction(tool, block.input || {});
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(toolResult),
            });

            // Notify client about tool result
            await sendToConnection(connectionId, {
              type: 'tool_result',
              payload: { toolId: block.id, result: toolResult, messageId },
              requestId,
            });
          } catch (error) {
            console.error(`Tool ${block.name} failed:`, error);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: String(error) }),
            });
          }
        }
      }

      // Add tool results to messages
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
    }

    // Send completion signal
    await sendToConnection(connectionId, {
      type: 'chat_complete',
      payload: { messageId, fullContent, intent: intent.type },
      requestId,
    });

    console.log(`Chat response complete for ${connectionId}, length: ${fullContent.length}`);
  } catch (error) {
    console.error('Error in chat handler:', error);

    await sendToConnection(connectionId, {
      type: 'error',
      payload: {
        message: 'Sorry, I encountered an error processing your message. Please try again.',
        code: 'CHAT_ERROR',
      },
      requestId,
    });
  }
};

interface MemoryResult {
  id: string;
  type: string;
  content: string;
  scope: string;
  importance: number;
  similarity: number;
  createdAt: string;
}

async function queryMemories(query: string, userId: string, orgId: string): Promise<string[]> {
  try {
    const response = await lambdaClient.send(new InvokeCommand({
      FunctionName: MEMORY_LAMBDA_ARN,
      Payload: JSON.stringify({
        action: 'search',
        payload: {
          query,
          userId,
          orgId,
          scopes: ['user', 'org', 'global'],
          limit: 5,
        },
      }),
    }));

    if (response.Payload) {
      const result = JSON.parse(new TextDecoder().decode(response.Payload));
      const body = JSON.parse(result.body);

      if (body.success && body.memories) {
        // Filter by minimum similarity threshold and format for prompt
        return body.memories
          .filter((m: MemoryResult) => m.similarity >= 0.5)
          .map((m: MemoryResult) => {
            const typeLabel = {
              insight: '💡',
              gotcha: '⚠️',
              preference: '⭐',
              pattern: '🔄',
              capability: '🛠️',
              status: '📍',
            }[m.type] || '📝';
            return `${typeLabel} ${m.content} (${m.scope} scope, ${Math.round(m.similarity * 100)}% relevant)`;
          });
      }
    }

    return [];
  } catch (error) {
    console.error('Error querying memories:', error);
    // Don't fail the chat if memory lookup fails
    return [];
  }
}

async function discoverTools(orgId: string): Promise<FableTool[]> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: TOOLS_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
      },
    }));

    if (!result.Items) return [];

    return result.Items.map(item => ({
      toolName: item.toolName,
      functionUrl: item.functionUrl,
      schema: item.schema,
    }));
  } catch (error) {
    console.error('Error discovering tools:', error);
    return [];
  }
}

async function invokeToolFunction(tool: FableTool, input: Record<string, unknown>): Promise<unknown> {
  console.log(`Invoking tool ${tool.toolName} at ${tool.functionUrl}`);

  // Build MCP JSON-RPC request
  const mcpRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: tool.schema.name,
      arguments: input,
    },
    id: Date.now(),
  };

  // Sign the request with IAM (Function URLs use AWS_IAM auth)
  const url = new URL(tool.functionUrl);
  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: 'us-west-2',
    service: 'lambda',
    sha256: Sha256,
  });

  const requestBody = JSON.stringify(mcpRequest);

  const signedRequest = await signer.sign({
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    protocol: url.protocol,
    headers: {
      'Content-Type': 'application/json',
      host: url.hostname,
    },
    body: requestBody,
  });

  // Make the request
  const response = await fetch(tool.functionUrl, {
    method: 'POST',
    headers: signedRequest.headers as Record<string, string>,
    body: requestBody,
  });

  if (!response.ok) {
    throw new Error(`Tool invocation failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as { result?: unknown; error?: { message?: string } };

  // Extract result from MCP response
  if (result.result) {
    return result.result;
  }
  if (result.error) {
    throw new Error(result.error.message || 'Tool returned error');
  }

  return result;
}

function buildSystemPrompt(
  memories: string[],
  context: ChatEvent['context'],
  intent: ChatEvent['intent'],
  tools: FableTool[] = []
): string {
  let prompt = `You are FABLE, a friendly AI assistant that can build tools and automate workflows.

## Your Capabilities
- General conversation and explanations
- Building MCP tools on request (tell users to say "build me a..." to start a build)
- Using existing tools (you have ${tools.length} tools available)
- Creating and managing workflows (scheduled or manual automation using your tools)
- Remembering user preferences and context

## Your Personality
- Helpful and concise
- Enthusiastic about building tools
- Technical but approachable

## Current Context
- Conversation has ${context.messages.length} previous messages
- Active build: ${context.activeBuildId || 'none'}
- Detected intent: ${intent.type} (${Math.round(intent.confidence * 100)}% confidence)`;

  if (tools.length > 0) {
    prompt += `

## Available Tools
You have access to these tools. Use them when they can help answer the user's question:
${tools.map(t => `- **${t.schema.name}**: ${t.schema.description}`).join('\n')}`;
  }

  if (memories.length > 0) {
    prompt += `

## Relevant Memories
${memories.map(m => `- ${m}`).join('\n')}`;
  }

  if (intent.type === 'CLARIFY') {
    prompt += `

## Note
The user's message was ambiguous. Ask clarifying questions to understand what they want.`;
  }

  prompt += `

Be helpful, concise, and friendly. Use your tools when they're relevant to the user's request. If the user wants to build something new, acknowledge their request and let them know the build will start.`;

  return prompt;
}

async function sendToConnection(connectionId: string, message: unknown): Promise<void> {
  const client = new ApiGatewayManagementApiClient({
    endpoint: `https://${WEBSOCKET_ENDPOINT}`,
  });

  try {
    await client.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(message)),
    }));
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'GoneException') {
      console.log(`Connection ${connectionId} is gone, cleaning up`);
      await docClient.send(new DeleteCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId },
      }));
    } else {
      throw error;
    }
  }
}

// ============================================================
// Internal Workflow Tools
// ============================================================

const INTERNAL_WORKFLOW_TOOLS: BedrockTool[] = [
  {
    name: 'fable_create_workflow',
    description: 'Create a new workflow (stored prompt that runs on a schedule or manually). Workflows can use any of your available tools.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        description: { type: 'string', description: 'What this workflow does' },
        prompt: { type: 'string', description: 'The prompt that will be executed when the workflow runs' },
        system_prompt: { type: 'string', description: 'Optional custom system prompt for the workflow' },
        model: { type: 'string', description: 'Model to use: haiku (fast/cheap), sonnet (balanced), opus (most capable). Default: sonnet' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Tool names the workflow can use. Empty = all available tools.' },
        trigger_type: { type: 'string', description: 'Trigger type: cron (scheduled), manual (on-demand). Default: manual' },
        schedule: { type: 'string', description: 'Cron expression for scheduled workflows (e.g., "cron(0 9 * * ? *)" for daily at 9am UTC)' },
        timezone: { type: 'string', description: 'Timezone for schedule (e.g., "America/New_York"). Default: UTC' },
        max_turns: { type: 'number', description: 'Max tool-use iterations. Default: 10' },
      },
      required: ['name', 'prompt'],
    },
  },
  {
    name: 'fable_list_workflows',
    description: 'List all workflows for the current organization.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'fable_get_workflow',
    description: 'Get details of a specific workflow by ID or name.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'Workflow ID' },
        name: { type: 'string', description: 'Workflow name (fuzzy match)' },
      },
    },
  },
  {
    name: 'fable_update_workflow',
    description: 'Update a workflow\'s configuration, prompt, or schedule.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'Workflow ID to update' },
        name: { type: 'string', description: 'New name' },
        description: { type: 'string', description: 'New description' },
        prompt: { type: 'string', description: 'New prompt' },
        system_prompt: { type: 'string', description: 'New system prompt' },
        model: { type: 'string', description: 'New model' },
        tools: { type: 'array', items: { type: 'string' }, description: 'New tool list' },
        schedule: { type: 'string', description: 'New cron expression' },
        timezone: { type: 'string', description: 'New timezone' },
        max_turns: { type: 'number', description: 'New max turns' },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'fable_delete_workflow',
    description: 'Delete a workflow and its EventBridge schedule (if any).',
    input_schema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'Workflow ID to delete' },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'fable_run_workflow',
    description: 'Run a workflow immediately (manual trigger). The workflow executes asynchronously.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'Workflow ID to run' },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'fable_pause_workflow',
    description: 'Pause or resume a workflow. Paused workflows will not run on schedule.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'Workflow ID' },
        action: { type: 'string', description: '"pause" or "resume"' },
      },
      required: ['workflow_id', 'action'],
    },
  },
];

async function handleInternalTool(
  toolName: string,
  input: Record<string, unknown>,
  orgId: string,
  userId: string,
  connectionId: string,
): Promise<unknown> {
  switch (toolName) {
    case 'fable_create_workflow':
      return handleCreateWorkflow(input, orgId, userId, connectionId);
    case 'fable_list_workflows':
      return handleListWorkflows(orgId);
    case 'fable_get_workflow':
      return handleGetWorkflow(input, orgId);
    case 'fable_update_workflow':
      return handleUpdateWorkflow(input, orgId);
    case 'fable_delete_workflow':
      return handleDeleteWorkflow(input, orgId);
    case 'fable_run_workflow':
      return handleRunWorkflow(input, orgId, userId, connectionId);
    case 'fable_pause_workflow':
      return handlePauseWorkflow(input, orgId);
    default:
      throw new Error(`Unknown internal tool: ${toolName}`);
  }
}

// ---------------------------------------------------------------------------
// Workflow CRUD handlers
// ---------------------------------------------------------------------------

async function handleCreateWorkflow(
  input: Record<string, unknown>,
  orgId: string,
  userId: string,
  connectionId: string,
): Promise<unknown> {
  const workflowId = crypto.randomUUID();
  const now = new Date().toISOString();
  const triggerType = (input.trigger_type as string) || 'manual';
  const schedule = input.schedule as string | undefined;
  const timezone = (input.timezone as string) || 'UTC';

  const item: Record<string, unknown> = {
    PK: `ORG#${orgId}`,
    SK: `WORKFLOW#${workflowId}`,
    workflowId,
    name: input.name,
    description: input.description || '',
    prompt: input.prompt,
    systemPrompt: input.system_prompt || null,
    model: input.model || 'sonnet',
    tools: input.tools || [],
    trigger: { type: triggerType, schedule, timezone },
    status: 'active',
    maxTurns: input.max_turns || 10,
    orgId,
    userId,
    createdAt: now,
    updatedAt: now,
    executionCount: 0,
    // GSI1: user-scoped query
    GSI1PK: `USER#${userId}`,
    GSI1SK: `WORKFLOW#${now}`,
  };

  // If cron trigger, create EventBridge schedule
  let eventBridgeRuleName: string | undefined;
  if (triggerType === 'cron' && schedule) {
    eventBridgeRuleName = `fable-${STAGE}-wf-${workflowId.slice(0, 8)}`;
    await schedulerClient.send(new CreateScheduleCommand({
      Name: eventBridgeRuleName,
      ScheduleExpression: schedule,
      ScheduleExpressionTimezone: timezone,
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: WORKFLOW_EXECUTOR_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          workflowId,
          orgId,
          userId,
          connectionId,
          trigger: 'cron',
        }),
      },
      State: 'ENABLED',
    }));
    item.eventBridgeRuleName = eventBridgeRuleName;
  }

  await docClient.send(new PutCommand({
    TableName: WORKFLOWS_TABLE,
    Item: item,
  }));

  return {
    success: true,
    workflowId,
    name: input.name,
    status: 'active',
    trigger: triggerType,
    schedule: schedule || null,
    eventBridgeRule: eventBridgeRuleName || null,
  };
}

async function handleListWorkflows(orgId: string): Promise<unknown> {
  const result = await docClient.send(new QueryCommand({
    TableName: WORKFLOWS_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `ORG#${orgId}`,
      ':prefix': 'WORKFLOW#',
    },
  }));

  const workflows = (result.Items || []).map(item => ({
    workflowId: item.workflowId,
    name: item.name,
    description: item.description,
    status: item.status,
    trigger: item.trigger,
    model: item.model,
    lastExecutedAt: item.lastExecutedAt || null,
    executionCount: item.executionCount || 0,
    createdAt: item.createdAt,
  }));

  return { workflows, count: workflows.length };
}

async function handleGetWorkflow(input: Record<string, unknown>, orgId: string): Promise<unknown> {
  if (input.workflow_id) {
    const result = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${input.workflow_id}` },
    }));

    if (!result.Item) return { error: 'Workflow not found' };

    // Also get recent executions
    const execResult = await docClient.send(new QueryCommand({
      TableName: WORKFLOWS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `WORKFLOW#${input.workflow_id}`,
        ':prefix': 'EXEC#',
      },
      ScanIndexForward: false,
      Limit: 5,
    }));

    return {
      ...result.Item,
      recentExecutions: (execResult.Items || []).map(e => ({
        executionId: e.executionId,
        status: e.status,
        trigger: e.trigger,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        result: e.result,
        error: e.error,
      })),
    };
  }

  // Fuzzy name match
  if (input.name) {
    const searchName = (input.name as string).toLowerCase();
    const allWorkflows = await docClient.send(new QueryCommand({
      TableName: WORKFLOWS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':prefix': 'WORKFLOW#',
      },
    }));

    const match = (allWorkflows.Items || []).find(
      item => (item.name as string).toLowerCase().includes(searchName)
    );

    if (match) return match;
    return { error: `No workflow found matching "${input.name}"` };
  }

  return { error: 'Provide workflow_id or name' };
}

async function handleUpdateWorkflow(input: Record<string, unknown>, orgId: string): Promise<unknown> {
  const workflowId = input.workflow_id as string;

  // Build update expression dynamically
  const updates: string[] = ['updatedAt = :now'];
  const values: Record<string, unknown> = { ':now': new Date().toISOString() };

  const fieldMap: Record<string, string> = {
    name: 'name', description: 'description', prompt: 'prompt',
    system_prompt: 'systemPrompt', model: 'model', tools: 'tools',
    max_turns: 'maxTurns',
  };

  for (const [inputKey, dbKey] of Object.entries(fieldMap)) {
    if (input[inputKey] !== undefined) {
      updates.push(`${dbKey} = :${dbKey}`);
      values[`:${dbKey}`] = input[inputKey];
    }
  }

  await docClient.send(new UpdateCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
    UpdateExpression: `SET ${updates.join(', ')}`,
    ExpressionAttributeValues: values,
    ConditionExpression: 'attribute_exists(PK)',
  }));

  // Update EventBridge schedule if schedule changed
  if (input.schedule) {
    const existing = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
    }));

    if (existing.Item?.eventBridgeRuleName) {
      await schedulerClient.send(new UpdateScheduleCommand({
        Name: existing.Item.eventBridgeRuleName,
        ScheduleExpression: input.schedule as string,
        ScheduleExpressionTimezone: (input.timezone as string) || existing.Item.trigger?.timezone || 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: {
          Arn: WORKFLOW_EXECUTOR_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
          Input: JSON.stringify({
            workflowId,
            orgId,
            userId: existing.Item.userId,
            trigger: 'cron',
          }),
        },
      }));
    }
  }

  return { success: true, workflowId, updated: Object.keys(fieldMap).filter(k => input[k] !== undefined) };
}

async function handleDeleteWorkflow(input: Record<string, unknown>, orgId: string): Promise<unknown> {
  const workflowId = input.workflow_id as string;

  // Get workflow to check for EventBridge rule
  const existing = await docClient.send(new GetCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
  }));

  if (!existing.Item) return { error: 'Workflow not found' };

  // Delete EventBridge schedule if exists
  if (existing.Item.eventBridgeRuleName) {
    try {
      await schedulerClient.send(new DeleteScheduleCommand({
        Name: existing.Item.eventBridgeRuleName,
      }));
    } catch (e) {
      console.warn('Failed to delete EventBridge schedule:', e);
    }
  }

  // Delete workflow record
  await docClient.send(new DeleteCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
  }));

  return { success: true, deleted: workflowId, name: existing.Item.name };
}

async function handleRunWorkflow(
  input: Record<string, unknown>,
  orgId: string,
  userId: string,
  connectionId: string,
): Promise<unknown> {
  const workflowId = input.workflow_id as string;

  // Verify workflow exists and is active
  const existing = await docClient.send(new GetCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
  }));

  if (!existing.Item) return { error: 'Workflow not found' };
  if (existing.Item.status !== 'active') return { error: `Workflow is ${existing.Item.status}` };

  // Invoke workflow executor asynchronously
  await lambdaClient.send(new InvokeCommand({
    FunctionName: WORKFLOW_EXECUTOR_ARN,
    InvocationType: 'Event', // Async invocation
    Payload: JSON.stringify({
      workflowId,
      orgId,
      userId,
      connectionId,
      trigger: 'manual',
    }),
  }));

  return {
    success: true,
    message: `Workflow "${existing.Item.name}" is now running. You'll be notified when it completes.`,
    workflowId,
  };
}

async function handlePauseWorkflow(input: Record<string, unknown>, orgId: string): Promise<unknown> {
  const workflowId = input.workflow_id as string;
  const action = input.action as string; // 'pause' or 'resume'

  const newStatus = action === 'pause' ? 'paused' : 'active';

  // Update status in DynamoDB
  await docClient.send(new UpdateCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
    UpdateExpression: 'SET #s = :status, updatedAt = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':status': newStatus,
      ':now': new Date().toISOString(),
    },
    ConditionExpression: 'attribute_exists(PK)',
  }));

  // Enable/disable EventBridge schedule if it exists
  const existing = await docClient.send(new GetCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
  }));

  if (existing.Item?.eventBridgeRuleName) {
    try {
      const schedule = await schedulerClient.send(new GetScheduleCommand({
        Name: existing.Item.eventBridgeRuleName,
      }));

      await schedulerClient.send(new UpdateScheduleCommand({
        Name: existing.Item.eventBridgeRuleName,
        ScheduleExpression: schedule.ScheduleExpression!,
        ScheduleExpressionTimezone: schedule.ScheduleExpressionTimezone,
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: schedule.Target!,
        State: action === 'pause' ? 'DISABLED' : 'ENABLED',
      }));
    } catch (e) {
      console.warn('Failed to update EventBridge schedule state:', e);
    }
  }

  return { success: true, workflowId, status: newStatus };
}
