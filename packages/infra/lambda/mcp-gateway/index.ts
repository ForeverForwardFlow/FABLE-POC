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
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({});

const TOOLS_TABLE = process.env.TOOLS_TABLE!;
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
  requestContext: {
    http: {
      method: string;
    };
  };
}

export const handler = async (event: LambdaEvent): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> => {
  const headers = {
    'Content-Type': 'application/json',
  };

  // Only accept POST
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
          message: String(error),
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

async function invokeToolFunction(
  tool: FableTool,
  args: Record<string, unknown>
): Promise<unknown> {
  // Derive function name from tool name (matches tool-deployer pattern)
  const functionName = `fable-${STAGE}-tool-${tool.toolName}`;
  console.log(`Invoking tool ${tool.toolName} via Lambda: ${functionName}`);

  // Build MCP JSON-RPC request payload
  const mcpRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: tool.schema.name,
      arguments: args,
    },
    id: Date.now(),
  };

  // Lambda event structure (matches Function URL event format)
  const lambdaPayload = {
    body: JSON.stringify(mcpRequest),
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
