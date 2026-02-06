import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockClient = new BedrockRuntimeClient({ region: 'us-west-2' });
const lambdaClient = new LambdaClient({});

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const TOOLS_TABLE = process.env.TOOLS_TABLE!;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!;
const MEMORY_LAMBDA_ARN = process.env.MEMORY_LAMBDA_ARN!;

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

    // Convert tools to Bedrock format
    const bedrockTools = tools.map(t => ({
      name: t.schema.name,
      description: t.schema.description,
      input_schema: t.schema.inputSchema || { type: 'object', properties: {} },
    }));

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
          const tool = tools.find(t => t.schema.name === block.name);
          if (tool) {
            try {
              const toolResult = await invokeToolFunction(tool, block.input || {});
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
  let prompt = `You are FABLE, a friendly AI assistant that can build tools.

## Your Capabilities
- General conversation and explanations
- Building MCP tools on request (tell users to say "build me a..." to start a build)
- Using existing tools (you have ${tools.length} tools available)
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
