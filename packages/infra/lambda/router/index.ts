import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({});
const bedrockClient = new BedrockRuntimeClient({ region: 'us-west-2' });

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE!;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!;
const STAGE = process.env.STAGE!;

interface ClientMessage {
  type: string;
  payload?: {
    content?: string;
    conversationId?: string;
  };
  requestId?: string;
}

interface Intent {
  type: 'CHAT' | 'BUILD' | 'USE_TOOL' | 'MEMORY' | 'CLARIFY';
  confidence: number;
  reason: string;
}

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;

  console.log(`Message received from ${connectionId}:`, event.body);

  try {
    const message: ClientMessage = JSON.parse(event.body || '{}');

    // Handle ping
    if (message.type === 'ping') {
      await sendToConnection(connectionId, { type: 'pong', timestamp: new Date().toISOString() });
      return { statusCode: 200, body: 'OK' };
    }

    // Handle message
    if (message.type === 'message' && message.payload?.content) {
      const content = message.payload.content;

      // Get connection info
      const connection = await getConnection(connectionId);
      if (!connection) {
        await sendToConnection(connectionId, { type: 'error', message: 'Connection not found' });
        return { statusCode: 400, body: 'Connection not found' };
      }

      // Load conversation context
      const context = await loadConversationContext(connection.userId, message.payload.conversationId);

      // Classify intent with hard overrides for known patterns
      // Priority: "build me" > workflow keyword > Bedrock classification
      let intent: Intent;
      if (/^build\s+me\b/i.test(content)) {
        // Explicit "build me" requests are always BUILD — Haiku often misclassifies these as CHAT
        intent = { type: 'BUILD', confidence: 1.0, reason: 'explicit build request' };
      } else if (/\bworkflow\b/i.test(content)) {
        // Workflow management is always CHAT — handled by internal fable_* tools
        intent = { type: 'CHAT', confidence: 1.0, reason: 'workflow management' };
      } else {
        intent = await classifyIntent(content, context);
      }
      console.log(`Intent classified: ${intent.type} (${intent.confidence})`);

      // Route to appropriate handler
      switch (intent.type) {
        case 'CHAT':
        case 'CLARIFY':
          await invokeLambda(`fable-${STAGE}-chat`, {
            connectionId,
            message: content,
            userId: connection.userId,
            orgId: connection.orgId,
            context,
            intent,
            requestId: message.requestId,
          });
          break;

        case 'BUILD':
          // Invoke build-kickoff Lambda to start the build pipeline
          await sendToConnection(connectionId, {
            type: 'chat_chunk',
            payload: { content: `Starting build for: "${content}"...` },
          });

          try {
            const buildResponse = await lambdaClient.send(new InvokeCommand({
              FunctionName: `fable-${STAGE}-build-kickoff`,
              Payload: Buffer.from(JSON.stringify({
                action: 'start',
                payload: {
                  request: content,
                  userId: connection.userId,
                  orgId: connection.orgId,
                  connectionId,
                },
              })),
            }));

            const buildResult = buildResponse.Payload
              ? JSON.parse(new TextDecoder().decode(buildResponse.Payload))
              : null;

            if (buildResult?.body) {
              const body = JSON.parse(buildResult.body);
              await sendToConnection(connectionId, {
                type: 'chat_chunk',
                payload: { content: `\n\nBuild started! Build ID: ${body.buildId}\n\nYou can monitor progress in the Builds tab.` },
              });
            }
          } catch (buildError) {
            console.error('Build kickoff error:', buildError);
            await sendToConnection(connectionId, {
              type: 'chat_chunk',
              payload: { content: '\n\nFailed to start build. Please try again.' },
            });
          }

          await sendToConnection(connectionId, { type: 'chat_complete', messageId: crypto.randomUUID() });
          break;

        case 'USE_TOOL':
          // TODO: Invoke tool Lambda
          await sendToConnection(connectionId, {
            type: 'chat_chunk',
            payload: { content: "Tool usage coming soon! Once you build tools, you'll be able to use them here." },
          });
          await sendToConnection(connectionId, { type: 'chat_complete', messageId: crypto.randomUUID() });
          break;

        case 'MEMORY':
          // TODO: Invoke memory Lambda
          await sendToConnection(connectionId, {
            type: 'chat_chunk',
            payload: { content: "Memory features coming soon! I'll be able to remember your preferences and past interactions." },
          });
          await sendToConnection(connectionId, { type: 'chat_complete', messageId: crypto.randomUUID() });
          break;
      }

      // Update conversation context
      await updateConversationContext(connection.userId, context.conversationId, content, intent.type);

      return { statusCode: 200, body: 'OK' };
    }

    // Handle subscription requests
    if (message.type === 'subscribe_details') {
      await updateConnectionSubscription(connectionId, true);
      await sendToConnection(connectionId, { type: 'subscribed', channel: 'details' });
      return { statusCode: 200, body: 'OK' };
    }

    if (message.type === 'unsubscribe_details') {
      await updateConnectionSubscription(connectionId, false);
      await sendToConnection(connectionId, { type: 'unsubscribed', channel: 'details' });
      return { statusCode: 200, body: 'OK' };
    }

    // Unknown message type
    await sendToConnection(connectionId, { type: 'error', message: `Unknown message type: ${message.type}` });
    return { statusCode: 400, body: 'Unknown message type' };
  } catch (error) {
    console.error('Error routing message:', error);
    await sendToConnection(connectionId, { type: 'error', message: 'Internal server error' });
    return { statusCode: 500, body: 'Internal server error' };
  }
};

async function getConnection(connectionId: string) {
  const result = await docClient.send(new GetCommand({
    TableName: CONNECTIONS_TABLE,
    Key: { connectionId },
  }));
  return result.Item;
}

async function loadConversationContext(userId: string, conversationId?: string) {
  // For now, return a simple context. TODO: Load from DynamoDB
  return {
    conversationId: conversationId || crypto.randomUUID(),
    messages: [] as Array<{ role: string; content: string }>,
    activeBuildId: null,
  };
}

async function updateConversationContext(userId: string, conversationId: string, content: string, intent: string) {
  // TODO: Store in DynamoDB conversations table
  console.log(`Updating conversation ${conversationId} for user ${userId}`);
}

async function updateConnectionSubscription(connectionId: string, subscribed: boolean) {
  await docClient.send(new UpdateCommand({
    TableName: CONNECTIONS_TABLE,
    Key: { connectionId },
    UpdateExpression: 'SET detailsSubscribed = :subscribed',
    ExpressionAttributeValues: { ':subscribed': subscribed },
  }));
}

async function classifyIntent(content: string, context: unknown): Promise<Intent> {
  // Use Bedrock Haiku for fast, cheap intent classification
  const prompt = `Classify the user's intent. Respond with JSON only.

User message: "${content}"

Intent types:
- CHAT: General conversation, questions, explanations, AND managing workflows. Any message mentioning "workflow" is ALWAYS CHAT, never BUILD. Examples: "create a workflow", "list my workflows", "run my daily report workflow", "pause the backup workflow", "show workflow history"
- BUILD: Request to build a new software tool/function (e.g., "build me a calculator", "create a weather tool"). NOT for workflows — workflows are CHAT.
- USE_TOOL: Use an existing tool (e.g., "calculate 20% of $50")
- MEMORY: Query or manage memories (e.g., "what do you remember about me?")
- CLARIFY: Ambiguous, needs clarification

IMPORTANT: If the message contains the word "workflow", classify as CHAT.

Respond with: {"type": "CHAT|BUILD|USE_TOOL|MEMORY|CLARIFY", "confidence": 0.0-1.0, "reason": "brief explanation"}`;

  try {
    const response = await bedrockClient.send(new InvokeModelCommand({
      modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
    }));

    const result = JSON.parse(new TextDecoder().decode(response.body));
    const text = result.content[0].text;

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('Error classifying intent:', error);
  }

  // Fallback: Simple keyword-based classification when Bedrock fails
  const lowerContent = content.toLowerCase();
  if (/^(build|create|make)\s+(me\s+)?a?\s+/i.test(content)) {
    return { type: 'BUILD', confidence: 0.8, reason: 'Keyword match: starts with build/create/make' };
  }
  if (lowerContent.includes('what do you remember') || lowerContent.includes('my memories')) {
    return { type: 'MEMORY', confidence: 0.7, reason: 'Keyword match: memory query' };
  }

  // Default to CHAT if classification fails
  return { type: 'CHAT', confidence: 0.5, reason: 'Classification failed, defaulting to chat' };
}

async function invokeLambda(functionName: string, payload: unknown) {
  await lambdaClient.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'Event', // Async invocation
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
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
