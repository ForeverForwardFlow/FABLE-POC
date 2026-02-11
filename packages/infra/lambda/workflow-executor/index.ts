import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const bedrockClient = new BedrockRuntimeClient({ region: 'us-west-2' });

const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE!;
const TOOLS_TABLE = process.env.TOOLS_TABLE!;
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!;

// Model name → Bedrock model ID mapping
const MODEL_MAP: Record<string, string> = {
  haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  opus: 'us.anthropic.claude-opus-4-20250514-v1:0',
};
const DEFAULT_MODEL = 'sonnet';

interface WorkflowExecutorEvent {
  workflowId: string;
  orgId: string;
  userId?: string;
  connectionId?: string;
  trigger: 'cron' | 'webhook' | 'manual';
  triggerPayload?: Record<string, unknown>;
}

interface WorkflowDefinition {
  workflowId: string;
  name: string;
  description?: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  tools?: string[];
  maxTurns?: number;
  status: 'active' | 'paused' | 'draft';
  orgId: string;
  userId: string;
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

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

export const handler = async (event: WorkflowExecutorEvent): Promise<{ statusCode: number; body: string }> => {
  const { workflowId, orgId, trigger, triggerPayload, connectionId } = event;
  const executionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  console.log(`Workflow executor: ${workflowId}, trigger: ${trigger}, execution: ${executionId}`);

  try {
    // 1. Load workflow definition
    const workflow = await loadWorkflow(workflowId, orgId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    // 2. Verify status
    if (workflow.status !== 'active') {
      console.log(`Workflow ${workflowId} is ${workflow.status}, skipping execution`);
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `Workflow is ${workflow.status}` }) };
    }

    // 3. Write RUNNING execution record
    await writeExecutionRecord(workflowId, executionId, orgId, {
      status: 'running',
      trigger,
      startedAt,
    });

    // 4. Discover tools (filtered to workflow's allowed tools if specified)
    const allTools = await discoverTools(orgId);
    const tools = workflow.tools && workflow.tools.length > 0
      ? allTools.filter(t => workflow.tools!.includes(t.schema.name))
      : allTools;

    console.log(`Using ${tools.length}/${allTools.length} tools for workflow`);

    // 5. Resolve model
    const modelId = MODEL_MAP[workflow.model || DEFAULT_MODEL] || MODEL_MAP[DEFAULT_MODEL];

    // 6. Build prompts
    const systemPrompt = workflow.systemPrompt || buildDefaultSystemPrompt(workflow, tools);
    const userPrompt = buildUserPrompt(workflow.prompt, trigger, triggerPayload);

    // 7. Run Bedrock tool-use loop
    const result = await runToolUseLoop({
      systemPrompt,
      userPrompt,
      modelId,
      tools,
      maxTurns: workflow.maxTurns || 10,
      connectionId,
      workflowId,
      executionId,
    });

    // 8. Write COMPLETED execution record
    const completedAt = new Date().toISOString();
    await writeExecutionRecord(workflowId, executionId, orgId, {
      status: 'completed',
      trigger,
      startedAt,
      completedAt,
      result: {
        summary: result.fullContent.slice(0, 2000),
        toolsCalled: result.toolsCalled,
        tokensUsed: result.tokensUsed,
        iterations: result.iterations,
      },
    });

    // Update workflow lastExecutedAt + increment executionCount
    await updateWorkflowLastExecuted(workflowId, orgId);

    // 9. Notify user via WebSocket
    if (connectionId) {
      await notifyUser(connectionId, {
        type: 'workflow_complete',
        payload: {
          workflowId,
          executionId,
          workflowName: workflow.name,
          summary: result.fullContent.slice(0, 500),
          toolsCalled: result.toolsCalled,
          trigger,
        },
      });
    }

    console.log(`Workflow ${workflowId} execution ${executionId} completed successfully`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        executionId,
        summary: result.fullContent.slice(0, 500),
        toolsCalled: result.toolsCalled,
      }),
    };
  } catch (error) {
    console.error(`Workflow ${workflowId} execution ${executionId} failed:`, error);

    // Write FAILED execution record
    await writeExecutionRecord(workflowId, executionId, orgId, {
      status: 'failed',
      trigger,
      startedAt,
      completedAt: new Date().toISOString(),
      error: String(error),
    }).catch(e => console.error('Failed to write failure record:', e));

    // Notify user of failure
    if (connectionId) {
      await notifyUser(connectionId, {
        type: 'workflow_error',
        payload: {
          workflowId,
          executionId,
          error: String(error),
          trigger,
        },
      }).catch(() => {});
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(error), executionId }),
    };
  }
};

// ---------------------------------------------------------------------------
// Workflow CRUD helpers
// ---------------------------------------------------------------------------

async function loadWorkflow(workflowId: string, orgId: string): Promise<WorkflowDefinition | null> {
  const result = await docClient.send(new GetCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
  }));

  if (!result.Item) return null;

  return {
    workflowId: result.Item.workflowId,
    name: result.Item.name,
    description: result.Item.description,
    prompt: result.Item.prompt,
    systemPrompt: result.Item.systemPrompt,
    model: result.Item.model,
    tools: result.Item.tools,
    maxTurns: result.Item.maxTurns,
    status: result.Item.status,
    orgId: result.Item.orgId,
    userId: result.Item.userId,
  };
}

async function writeExecutionRecord(
  workflowId: string,
  executionId: string,
  orgId: string,
  data: Record<string, unknown>
): Promise<void> {
  const now = new Date().toISOString();
  await docClient.send(new PutCommand({
    TableName: WORKFLOWS_TABLE,
    Item: {
      PK: `WORKFLOW#${workflowId}`,
      SK: `EXEC#${now}#${executionId}`,
      executionId,
      workflowId,
      orgId,
      ...data,
      // TTL: 90 days from now
      ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
      // GSI1 for querying executions by org
      GSI1PK: `ORG#${orgId}`,
      GSI1SK: `EXEC#${now}`,
    },
  }));
}

async function updateWorkflowLastExecuted(workflowId: string, orgId: string): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
    UpdateExpression: 'SET lastExecutedAt = :now, executionCount = if_not_exists(executionCount, :zero) + :one',
    ExpressionAttributeValues: {
      ':now': new Date().toISOString(),
      ':zero': 0,
      ':one': 1,
    },
  }));
}

// ---------------------------------------------------------------------------
// Tool discovery + invocation (same pattern as Chat Lambda)
// ---------------------------------------------------------------------------

async function discoverTools(orgId: string): Promise<FableTool[]> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: TOOLS_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `ORG#${orgId}` },
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

  const mcpRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: tool.schema.name, arguments: input },
    id: Date.now(),
  };

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

  const response = await fetch(tool.functionUrl, {
    method: 'POST',
    headers: signedRequest.headers as Record<string, string>,
    body: requestBody,
  });

  if (!response.ok) {
    throw new Error(`Tool invocation failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as { result?: unknown; error?: { message?: string } };

  if (result.result) return result.result;
  if (result.error) throw new Error(result.error.message || 'Tool returned error');
  return result;
}

// ---------------------------------------------------------------------------
// Bedrock tool-use loop
// ---------------------------------------------------------------------------

interface ToolUseLoopParams {
  systemPrompt: string;
  userPrompt: string;
  modelId: string;
  tools: FableTool[];
  maxTurns: number;
  connectionId?: string;
  workflowId: string;
  executionId: string;
}

interface ToolUseLoopResult {
  fullContent: string;
  toolsCalled: string[];
  tokensUsed: number;
  iterations: number;
}

async function runToolUseLoop(params: ToolUseLoopParams): Promise<ToolUseLoopResult> {
  const { systemPrompt, userPrompt, modelId, tools, maxTurns } = params;

  const bedrockTools = tools.map(t => ({
    name: t.schema.name,
    description: t.schema.description,
    input_schema: t.schema.inputSchema || { type: 'object', properties: {} },
  }));

  const messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }> = [
    { role: 'user', content: userPrompt },
  ];

  let fullContent = '';
  let totalTokens = 0;
  const toolsCalled: string[] = [];
  let iterations = 0;

  while (iterations < maxTurns) {
    iterations++;

    const requestBody: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    };

    if (bedrockTools.length > 0) {
      requestBody.tools = bedrockTools;
    }

    const response = await bedrockClient.send(new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody),
    }));

    const result = JSON.parse(new TextDecoder().decode(response.body));
    totalTokens += (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0);

    const assistantContent: ContentBlock[] = [];
    let hasToolUse = false;

    for (const block of result.content || []) {
      if (block.type === 'text') {
        fullContent += block.text;
        assistantContent.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        hasToolUse = true;
        assistantContent.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        });
        if (block.name && !toolsCalled.includes(block.name)) {
          toolsCalled.push(block.name);
        }
        console.log(`[Workflow ${params.workflowId}] Tool use: ${block.name}`);
      }
    }

    messages.push({ role: 'assistant', content: assistantContent });

    if (!hasToolUse || result.stop_reason === 'end_turn') {
      break;
    }

    // Execute tool calls
    const toolResults: ContentBlock[] = [];

    for (const block of assistantContent) {
      if (block.type === 'tool_use' && block.name && block.id) {
        const tool = tools.find(t => t.schema.name === block.name);
        if (tool) {
          try {
            const toolResult = await invokeToolFunction(tool, block.input || {});
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(toolResult),
            });
          } catch (error) {
            console.error(`[Workflow ${params.workflowId}] Tool ${block.name} failed:`, error);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: String(error) }),
            });
          }
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: `Tool ${block.name} not found` }),
          });
        }
      }
    }

    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
    }
  }

  return { fullContent, toolsCalled, tokensUsed: totalTokens, iterations };
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildDefaultSystemPrompt(workflow: WorkflowDefinition, tools: FableTool[]): string {
  let prompt = `You are FABLE executing a workflow called "${workflow.name}".`;

  if (workflow.description) {
    prompt += `\n\nWorkflow description: ${workflow.description}`;
  }

  prompt += `\n\nExecute the user's prompt using the tools available to you. Be thorough and complete the task fully.`;

  if (tools.length > 0) {
    prompt += `\n\n## Available Tools\n${tools.map(t => `- **${t.schema.name}**: ${t.schema.description}`).join('\n')}`;
  }

  return prompt;
}

function buildUserPrompt(
  basePrompt: string,
  trigger: string,
  triggerPayload?: Record<string, unknown>
): string {
  let prompt = basePrompt;

  if (trigger === 'cron') {
    prompt += `\n\n[Triggered by schedule at ${new Date().toISOString()}]`;
  } else if (trigger === 'webhook' && triggerPayload) {
    prompt += `\n\n[Triggered by webhook with payload: ${JSON.stringify(triggerPayload)}]`;
  } else if (trigger === 'manual') {
    prompt += `\n\n[Triggered manually by user]`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// WebSocket notification
// ---------------------------------------------------------------------------

async function notifyUser(connectionId: string, message: unknown): Promise<void> {
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
      console.log(`Connection ${connectionId} is gone`);
    } else {
      console.error('Failed to notify user:', error);
    }
  }
}
