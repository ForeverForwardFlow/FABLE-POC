/**
 * MCP Gateway Lambda
 *
 * A single MCP server that proxies to all FABLE-deployed tools.
 * Claude Code connects to this gateway, which dynamically discovers
 * and routes to tools registered in DynamoDB.
 *
 * This enables immediate tool uptake - new tools are available
 * as soon as they're registered, without restarting Claude Code.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const lambdaClient = new LambdaClient({});

const TOOLS_TABLE = process.env.TOOLS_TABLE!;
const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE!;
const WORKFLOW_EXECUTOR_ARN = process.env.WORKFLOW_EXECUTOR_ARN!;
const STAGE = process.env.STAGE || 'dev';
const GATEWAY_NAME = 'fable-tools-gateway';
const GATEWAY_VERSION = '1.0.0';

interface McpRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
}

interface McpResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface FableTool {
  toolName: string;
  functionUrl: string;
  schema: {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
  };
  orgId: string;
}

interface LambdaEvent {
  headers: Record<string, string>;
  body: string;
  rawPath?: string;
  requestContext: {
    http: {
      method: string;
      path?: string;
    };
  };
}

export const handler = async (event: LambdaEvent): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> => {
  // Content-Type header + CORS for HTTP API routes
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add CORS headers for public API routes
  const requestPath = event.rawPath || event.requestContext.http.path || '/';
  if (requestPath.startsWith('/tools') || requestPath.startsWith('/workflows')) {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'content-type';
  }

  // Handle GET /tools — tool listing (browser-friendly)
  if (event.requestContext.http.method === 'GET' && (requestPath === '/tools' || requestPath === '/')) {
    try {
      const response = await handleToolsList();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(response.result),
      };
    } catch (error) {
      console.error('MCP Gateway GET error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Internal server error' }),
      };
    }
  }

  // Handle POST /tools/call — direct tool invocation from frontend
  if (requestPath === '/tools/call' && event.requestContext.http.method === 'POST') {
    try {
      const body = JSON.parse(event.body);
      const { name, arguments: args } = body;
      if (!name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing tool name' }) };
      }
      const response = await handleToolsCall({ name, arguments: args || {} });
      if (response.error) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: response.error.message }) };
      }
      // Extract the text content from MCP response
      const content = (response.result as { content?: Array<{ text: string }> })?.content;
      const text = content?.[0]?.text;
      let result: unknown;
      try {
        result = text ? JSON.parse(text) : response.result;
      } catch {
        result = text || response.result;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ result }) };
    } catch (error) {
      console.error('Tool call error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Tool invocation failed' }) };
    }
  }

  // Handle DELETE /tools/delete — tool deletion from frontend
  if (requestPath === '/tools/delete' && event.requestContext.http.method === 'POST') {
    try {
      const body = JSON.parse(event.body);
      const { name } = body;
      if (!name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing tool name' }) };
      }
      await handleToolDelete(name);
      return { statusCode: 200, headers, body: JSON.stringify({ deleted: true, name }) };
    } catch (error) {
      console.error('Tool delete error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: `Delete failed: ${error}` }) };
    }
  }

  // Handle GET /workflows — list all workflows
  if (requestPath === '/workflows' && event.requestContext.http.method === 'GET') {
    try {
      const workflows = await handleWorkflowsList();
      return { statusCode: 200, headers, body: JSON.stringify({ workflows }) };
    } catch (error) {
      console.error('Workflows list error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to list workflows' }) };
    }
  }

  // Handle POST /workflows/run — trigger a workflow manually
  if (requestPath === '/workflows/run' && event.requestContext.http.method === 'POST') {
    try {
      const body = JSON.parse(event.body);
      const { workflowId, orgId } = body;
      if (!workflowId || !orgId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing workflowId or orgId' }) };
      }
      await handleWorkflowRun(workflowId, orgId);
      return { statusCode: 200, headers, body: JSON.stringify({ triggered: true, workflowId }) };
    } catch (error) {
      console.error('Workflow run error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: `Run failed: ${error}` }) };
    }
  }

  // Handle POST /workflows/pause — toggle workflow active/paused
  if (requestPath === '/workflows/pause' && event.requestContext.http.method === 'POST') {
    try {
      const body = JSON.parse(event.body);
      const { workflowId, orgId, status } = body;
      if (!workflowId || !orgId || !status) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing workflowId, orgId, or status' }) };
      }
      await handleWorkflowStatusUpdate(workflowId, orgId, status);
      return { statusCode: 200, headers, body: JSON.stringify({ updated: true, workflowId, status }) };
    } catch (error) {
      console.error('Workflow pause error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: `Status update failed: ${error}` }) };
    }
  }

  // Handle POST /workflows/delete — delete a workflow
  if (requestPath === '/workflows/delete' && event.requestContext.http.method === 'POST') {
    try {
      const body = JSON.parse(event.body);
      const { workflowId, orgId } = body;
      if (!workflowId || !orgId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing workflowId or orgId' }) };
      }
      await handleWorkflowDelete(workflowId, orgId);
      return { statusCode: 200, headers, body: JSON.stringify({ deleted: true, workflowId }) };
    } catch (error) {
      console.error('Workflow delete error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: `Delete failed: ${error}` }) };
    }
  }

  // Only accept POST for MCP protocol
  if (event.requestContext.http.method !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const request: McpRequest = JSON.parse(event.body);
    console.log(`MCP Gateway received: ${request.method}`);

    const response = await handleMcpRequest(request);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('MCP Gateway error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
      }),
    };
  }
};

async function handleMcpRequest(request: McpRequest): Promise<McpResponse> {
  const { method, params, id } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: GATEWAY_NAME,
            version: GATEWAY_VERSION,
          },
        },
      };

    case 'notifications/initialized':
      // Client notification, no response needed
      return { jsonrpc: '2.0', id };

    case 'tools/list':
      return await handleToolsList(id);

    case 'tools/call':
      return await handleToolsCall(params as { name: string; arguments: Record<string, unknown> }, id);

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}

async function handleToolsList(id?: string | number): Promise<McpResponse> {
  console.log('Discovering tools from DynamoDB...');

  try {
    // Query all tools across all orgs (for now - could filter by org later)
    // Using Scan since we want all tools; for production, consider GSI
    const result = await docClient.send(new ScanCommand({
      TableName: TOOLS_TABLE,
      FilterExpression: 'begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':sk': 'TOOL#',
      },
    }));

    const tools = (result.Items || []).map((item: Record<string, unknown>) => {
      const schema = item.schema as FableTool['schema'];
      return {
        name: schema.name,
        description: schema.description,
        inputSchema: schema.inputSchema || {
          type: 'object',
          properties: {},
        },
        ...(item.uiDefinition && { uiDefinition: typeof item.uiDefinition === 'string' ? JSON.parse(item.uiDefinition) : item.uiDefinition }),
      };
    });

    console.log(`Found ${tools.length} tools`);

    return {
      jsonrpc: '2.0',
      id,
      result: { tools },
    };
  } catch (error) {
    console.error('Error listing tools:', error);
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: `Failed to list tools: ${error}`,
      },
    };
  }
}

async function handleToolsCall(
  params: { name: string; arguments: Record<string, unknown> },
  id?: string | number
): Promise<McpResponse> {
  const { name, arguments: args } = params;
  console.log(`Tool call: ${name}`);

  try {
    // Find the tool in DynamoDB
    const tool = await findTool(name);

    if (!tool) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32602,
          message: `Tool not found: ${name}`,
        },
      };
    }

    // Invoke the tool's Function URL
    const result = await invokeToolFunction(tool, args);

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      },
    };
  } catch (error) {
    console.error(`Tool ${name} failed:`, error);
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: `Tool execution failed: ${error}`,
      },
    };
  }
}

async function findTool(name: string): Promise<FableTool | null> {
  // Scan for the tool by name (could optimize with GSI)
  const result = await docClient.send(new ScanCommand({
    TableName: TOOLS_TABLE,
    FilterExpression: 'begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':sk': 'TOOL#',
    },
  }));

  for (const item of result.Items || []) {
    const schema = item.schema as FableTool['schema'];
    if (schema.name === name) {
      return {
        toolName: item.toolName as string,
        functionUrl: item.functionUrl as string,
        schema,
        orgId: item.orgId as string,
      };
    }
  }

  return null;
}

async function handleToolDelete(name: string): Promise<void> {
  console.log(`Deleting tool: ${name}`);

  // Find all DynamoDB records for this tool (may exist in multiple orgs)
  const result = await docClient.send(new ScanCommand({
    TableName: TOOLS_TABLE,
    FilterExpression: 'begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':sk': 'TOOL#' },
  }));

  const toDelete = (result.Items || []).filter((item) => {
    const schema = item.schema as FableTool['schema'];
    return schema.name === name;
  });

  if (toDelete.length === 0) {
    throw new Error(`Tool not found: ${name}`);
  }

  // Delete Lambda function
  const toolName = toDelete[0].toolName as string;
  const functionName = `fable-${STAGE}-tool-${toolName}`;
  try {
    await lambdaClient.send(new DeleteFunctionCommand({ FunctionName: functionName }));
    console.log(`Deleted Lambda: ${functionName}`);
  } catch (err: unknown) {
    // Ignore if Lambda doesn't exist (already deleted)
    if ((err as { name?: string }).name !== 'ResourceNotFoundException') {
      console.warn(`Failed to delete Lambda ${functionName}:`, err);
    }
  }

  // Delete all DynamoDB records for this tool
  for (const item of toDelete) {
    await docClient.send(new DeleteCommand({
      TableName: TOOLS_TABLE,
      Key: { PK: item.PK as string, SK: item.SK as string },
    }));
    console.log(`Deleted DynamoDB record: ${item.PK}/${item.SK}`);
  }
}

// ============================================================
// Workflow handlers
// ============================================================

async function handleWorkflowsList(): Promise<unknown[]> {
  console.log('Listing workflows from DynamoDB...');

  // Scan all orgs for now (small dataset). Query by org when auth is added.
  const result = await docClient.send(new ScanCommand({
    TableName: WORKFLOWS_TABLE,
    FilterExpression: 'begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':sk': 'WORKFLOW#' },
  }));

  const workflows = (result.Items || []).map((item: Record<string, unknown>) => ({
    workflowId: item.workflowId,
    name: item.name,
    description: item.description,
    status: item.status,
    trigger: item.trigger,
    model: item.model,
    tools: item.tools,
    maxTurns: item.maxTurns,
    orgId: item.orgId,
    lastExecutedAt: item.lastExecutedAt || null,
    executionCount: item.executionCount || 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));

  console.log(`Found ${workflows.length} workflows`);
  return workflows;
}

async function handleWorkflowRun(workflowId: string, orgId: string): Promise<void> {
  console.log(`Running workflow: ${workflowId}`);

  await lambdaClient.send(new InvokeCommand({
    FunctionName: WORKFLOW_EXECUTOR_ARN,
    InvocationType: 'Event', // Async
    Payload: Buffer.from(JSON.stringify({
      workflowId,
      orgId,
      trigger: 'manual',
    })),
  }));
}

async function handleWorkflowStatusUpdate(workflowId: string, orgId: string, status: string): Promise<void> {
  console.log(`Updating workflow ${workflowId} status to ${status}`);

  await docClient.send(new UpdateCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
    UpdateExpression: 'SET #s = :status, updatedAt = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':status': status,
      ':now': new Date().toISOString(),
    },
    ConditionExpression: 'attribute_exists(PK)',
  }));
}

async function handleWorkflowDelete(workflowId: string, orgId: string): Promise<void> {
  console.log(`Deleting workflow: ${workflowId}`);

  await docClient.send(new DeleteCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
  }));
}

// ============================================================
// Tool invocation
// ============================================================

async function invokeToolFunction(
  tool: FableTool,
  args: Record<string, unknown>
): Promise<unknown> {
  // Derive function name from tool name (matches tool-deployer pattern)
  const functionName = `fable-${STAGE}-tool-${tool.toolName}`;
  console.log(`Invoking tool ${tool.toolName} via Lambda: ${functionName}`);

  // Send arguments directly - FABLE-built tools expect { arguments: {...} }
  const lambdaPayload = {
    arguments: args,
  };

  // Invoke the tool Lambda directly
  const response = await lambdaClient.send(new InvokeCommand({
    FunctionName: functionName,
    Payload: Buffer.from(JSON.stringify(lambdaPayload)),
  }));

  if (response.FunctionError) {
    const errorPayload = response.Payload ? JSON.parse(new TextDecoder().decode(response.Payload)) : {};
    throw new Error(`Tool invocation failed: ${errorPayload.errorMessage || response.FunctionError}`);
  }

  if (!response.Payload) {
    throw new Error('Tool returned no payload');
  }

  const lambdaResult = JSON.parse(new TextDecoder().decode(response.Payload));

  // Parse the body from the Lambda response
  const result = typeof lambdaResult.body === 'string'
    ? JSON.parse(lambdaResult.body)
    : lambdaResult.body || lambdaResult;

  // Extract result from MCP response
  if (result.result?.content?.[0]?.text) {
    try {
      return JSON.parse(result.result.content[0].text);
    } catch {
      return result.result.content[0].text;
    }
  }
  if (result.result) {
    return result.result;
  }
  if (result.error) {
    throw new Error(result.error.message || 'Tool returned error');
  }

  return result;
}
