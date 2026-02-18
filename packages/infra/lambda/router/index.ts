import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const lambdaClient = new LambdaClient({});
const bedrockClient = new BedrockRuntimeClient({ region: 'us-west-2' });

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE!;
const BUILDS_TABLE = process.env.BUILDS_TABLE!;
const MEMORY_LAMBDA_ARN = process.env.MEMORY_LAMBDA_ARN || '';
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!;
const STAGE = process.env.STAGE!;

// UUID mapping for anonymous users (Memory Lambda requires UUID format)
const DEFAULT_ORG_UUID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_USER_UUID = '00000000-0000-0000-0000-000000000001';
function toMemoryOrgId(orgId: string): string {
  return orgId === 'default' ? DEFAULT_ORG_UUID : orgId;
}
function toMemoryUserId(userId: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    ? userId : DEFAULT_USER_UUID;
}

interface ClientMessage {
  type: string;
  payload?: {
    content?: string;
    conversationId?: string;
    memoryId?: string;
  };
  requestId?: string;
}

interface ConversationSummary {
  conversationId: string;
  title: string;
  updatedAt: string;
  intent?: string;
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
      // Build requests route through Chat for conversational requirement gathering
      let intent: Intent;
      if (/^build\s+me\b/i.test(content) || /^(build|create|make)\s+(me\s+)?a?\s+/i.test(content)) {
        // Build requests go through Chat — Chat gathers requirements then calls fable_start_build
        intent = { type: 'CHAT', confidence: 1.0, reason: 'build request - gather requirements' };
      } else if (/\bworkflow\b/i.test(content)) {
        // Workflow management is always CHAT — handled by internal fable_* tools
        intent = { type: 'CHAT', confidence: 1.0, reason: 'workflow management' };
      } else {
        intent = await classifyIntent(content, context);
      }
      console.log(`Intent classified: ${intent.type} (${intent.confidence})`);

      // Route to appropriate handler
      // BUILD intent also goes through Chat — Chat gathers requirements then calls fable_start_build
      switch (intent.type) {
        case 'CHAT':
        case 'CLARIFY':
        case 'BUILD':
        case 'USE_TOOL':
        case 'MEMORY':
          // All intents route to Chat Lambda — it handles tool discovery/invocation,
          // build requirement gathering (fable_start_build), and general conversation
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
      }

      // Update conversation context (save user message)
      await updateConversationContext(connection.userId, connection.orgId, context.conversationId, content, intent.type);

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

    // Handle conversation management
    if (message.type === 'list_conversations') {
      const connection = await getConnection(connectionId);
      if (!connection) {
        await sendToConnection(connectionId, { type: 'error', message: 'Connection not found' });
        return { statusCode: 400, body: 'Connection not found' };
      }
      const conversations = await listConversations(connection.userId);
      await sendToConnection(connectionId, { type: 'conversations_list', payload: { conversations } });
      return { statusCode: 200, body: 'OK' };
    }

    if (message.type === 'load_conversation' && message.payload?.conversationId) {
      const connection = await getConnection(connectionId);
      if (!connection) {
        await sendToConnection(connectionId, { type: 'error', message: 'Connection not found' });
        return { statusCode: 400, body: 'Connection not found' };
      }
      const conversation = await loadFullConversation(connection.userId, message.payload.conversationId);
      if (conversation) {
        await sendToConnection(connectionId, { type: 'conversation_loaded', payload: conversation });
      } else {
        await sendToConnection(connectionId, { type: 'error', message: 'Conversation not found' });
      }
      return { statusCode: 200, body: 'OK' };
    }

    if (message.type === 'delete_conversation' && message.payload?.conversationId) {
      const connection = await getConnection(connectionId);
      if (!connection) {
        await sendToConnection(connectionId, { type: 'error', message: 'Connection not found' });
        return { statusCode: 400, body: 'Connection not found' };
      }
      await deleteConversation(connection.userId, message.payload.conversationId);
      await sendToConnection(connectionId, { type: 'conversation_deleted', payload: { conversationId: message.payload.conversationId } });
      return { statusCode: 200, body: 'OK' };
    }

    // Handle memory management
    if (message.type === 'list_memories') {
      const connection = await getConnection(connectionId);
      if (!connection) {
        await sendToConnection(connectionId, { type: 'error', message: 'Connection not found' });
        return { statusCode: 400, body: 'Connection not found' };
      }
      const memories = await listUserMemories(connection.userId, connection.orgId || 'default');
      await sendToConnection(connectionId, { type: 'memories_list', payload: { memories } });
      return { statusCode: 200, body: 'OK' };
    }

    if (message.type === 'delete_memory' && message.payload?.memoryId) {
      const result = await deleteUserMemory(message.payload.memoryId);
      await sendToConnection(connectionId, {
        type: 'memory_deleted',
        payload: { memoryId: message.payload.memoryId, success: result },
      });
      return { statusCode: 200, body: 'OK' };
    }

    // Handle build history
    if (message.type === 'list_builds') {
      const connection = await getConnection(connectionId);
      if (!connection) {
        await sendToConnection(connectionId, { type: 'error', message: 'Connection not found' });
        return { statusCode: 400, body: 'Connection not found' };
      }
      const builds = await listBuilds(connection.orgId || 'default');
      await sendToConnection(connectionId, { type: 'builds_list', payload: { builds } });
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
  const convId = conversationId || crypto.randomUUID();

  if (conversationId) {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { PK: `USER#${userId}`, SK: `CONV#${conversationId}` },
      }));

      if (result.Item) {
        return {
          conversationId,
          messages: (result.Item.messages || []) as Array<{ role: string; content: string }>,
          activeBuildId: (result.Item.activeBuildId as string) || null,
        };
      }
    } catch (error) {
      console.error('Error loading conversation:', error);
    }
  }

  return {
    conversationId: convId,
    messages: [] as Array<{ role: string; content: string }>,
    activeBuildId: null,
  };
}

async function updateConversationContext(
  userId: string,
  orgId: string,
  conversationId: string,
  userMessage: string,
  intent: string,
) {
  try {
    // Load existing conversation to append
    const existing = await docClient.send(new GetCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { PK: `USER#${userId}`, SK: `CONV#${conversationId}` },
    }));

    const now = new Date().toISOString();
    const messages = (existing.Item?.messages || []) as Array<{ role: string; content: string; timestamp: string }>;

    // Append user message
    messages.push({ role: 'user', content: userMessage, timestamp: now });

    // Cap at last 50 messages
    const capped = messages.slice(-50);

    // Auto-generate title from first user message
    const title = existing.Item?.title || userMessage.slice(0, 80);

    await docClient.send(new PutCommand({
      TableName: CONVERSATIONS_TABLE,
      Item: {
        PK: `USER#${userId}`,
        SK: `CONV#${conversationId}`,
        conversationId,
        orgId,
        title,
        messages: capped,
        activeBuildId: existing.Item?.activeBuildId || null,
        intent,
        createdAt: existing.Item?.createdAt || now,
        updatedAt: now,
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
      },
    }));
  } catch (error) {
    console.error('Error updating conversation:', error);
  }
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
    return { type: 'CHAT', confidence: 0.8, reason: 'Build request - route through chat for requirement gathering' };
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

async function listConversations(userId: string) {
  const result = await docClient.send(new QueryCommand({
    TableName: CONVERSATIONS_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':sk': 'CONV#',
    },
    ProjectionExpression: 'conversationId, title, updatedAt, intent',
    ScanIndexForward: false, // newest first
  }));

  return (result.Items || [])
    .sort((a, b) => (b.updatedAt as string).localeCompare(a.updatedAt as string))
    .slice(0, 50); // cap at 50 conversations
}

async function loadFullConversation(userId: string, conversationId: string) {
  const result = await docClient.send(new GetCommand({
    TableName: CONVERSATIONS_TABLE,
    Key: { PK: `USER#${userId}`, SK: `CONV#${conversationId}` },
  }));

  if (!result.Item) return null;

  return {
    conversationId: result.Item.conversationId,
    title: result.Item.title,
    messages: result.Item.messages || [],
    activeBuildId: result.Item.activeBuildId || null,
    updatedAt: result.Item.updatedAt,
  };
}

async function deleteConversation(userId: string, conversationId: string) {
  await docClient.send(new DeleteCommand({
    TableName: CONVERSATIONS_TABLE,
    Key: { PK: `USER#${userId}`, SK: `CONV#${conversationId}` },
  }));
}

async function listBuilds(orgId: string) {
  const result = await docClient.send(new QueryCommand({
    TableName: BUILDS_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `ORG#${orgId}`,
      ':sk': 'BUILD#',
    },
    ProjectionExpression: 'buildId, #s, request, createdAt, updatedAt, completedAt, buildCycle, userId',
    ExpressionAttributeNames: { '#s': 'status' },
    ScanIndexForward: false,
  }));

  return (result.Items || [])
    .sort((a, b) => (b.createdAt as string).localeCompare(a.createdAt as string))
    .slice(0, 50);
}

async function listUserMemories(userId: string, orgId: string) {
  if (!MEMORY_LAMBDA_ARN) return [];
  try {
    const response = await lambdaClient.send(new InvokeCommand({
      FunctionName: MEMORY_LAMBDA_ARN,
      Payload: JSON.stringify({
        action: 'list',
        payload: {
          userId: toMemoryUserId(userId),
          orgId: toMemoryOrgId(orgId),
          limit: 50,
        },
      }),
    }));

    if (response.Payload) {
      const result = JSON.parse(new TextDecoder().decode(response.Payload));
      const body = JSON.parse(result.body);
      if (body.success && body.memories) {
        return body.memories;
      }
    }
    return [];
  } catch (error) {
    console.error('Error listing memories:', error);
    return [];
  }
}

async function deleteUserMemory(memoryId: string): Promise<boolean> {
  if (!MEMORY_LAMBDA_ARN) return false;
  try {
    const response = await lambdaClient.send(new InvokeCommand({
      FunctionName: MEMORY_LAMBDA_ARN,
      Payload: JSON.stringify({
        action: 'delete',
        payload: { id: memoryId },
      }),
    }));

    if (response.Payload) {
      const result = JSON.parse(new TextDecoder().decode(response.Payload));
      const body = JSON.parse(result.body);
      return body.success === true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting memory:', error);
    return false;
  }
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
