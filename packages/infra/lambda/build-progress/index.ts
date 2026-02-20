import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const BUILDS_TABLE = process.env.BUILDS_TABLE!;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!;

interface ProgressEvent {
  buildId: string;
  orgId: string;
  userId: string;
  phase: string;
  message: string;
  progress?: number;
  iteration?: number;
  maxIterations?: number;
}

export const handler = async (event: ProgressEvent): Promise<{ statusCode: number }> => {
  const { buildId, orgId, userId, phase, message, progress, iteration, maxIterations } = event;
  const timestamp = new Date().toISOString();

  console.log(`Build progress: ${buildId} phase=${phase} msg=${message}`);

  // 1. Send WebSocket notification to user's active connections
  await notifyUser(userId, {
    type: 'build_progress',
    payload: { buildId, phase, message, progress, iteration, maxIterations, timestamp },
  });

  // 2. Update build record with current phase (fire-and-forget)
  try {
    await docClient.send(new UpdateCommand({
      TableName: BUILDS_TABLE,
      Key: { PK: `ORG#${orgId}`, SK: `BUILD#${buildId}` },
      UpdateExpression: 'SET currentPhase = :phase, updatedAt = :ts, progressLog = list_append(if_not_exists(progressLog, :empty), :entry)',
      ExpressionAttributeValues: {
        ':phase': phase,
        ':ts': timestamp,
        ':empty': [],
        ':entry': [{ phase, message, progress, timestamp }],
      },
    }));
  } catch (err) {
    console.error('Failed to update build progress in DynamoDB:', err);
  }

  return { statusCode: 200 };
};

async function notifyUser(userId: string, message: Record<string, unknown>): Promise<void> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      Limit: 5,
    }));

    if (!result.Items || result.Items.length === 0) {
      console.log(`No active connections for user ${userId}`);
      return;
    }

    const apiClient = new ApiGatewayManagementApiClient({
      endpoint: `https://${WEBSOCKET_ENDPOINT}`,
    });

    for (const conn of result.Items) {
      try {
        await apiClient.send(new PostToConnectionCommand({
          ConnectionId: conn.connectionId as string,
          Data: Buffer.from(JSON.stringify(message)),
        }));
      } catch (err: unknown) {
        if ((err as { name?: string }).name === 'GoneException') {
          console.log(`Connection ${conn.connectionId} is gone, skipping`);
        } else {
          console.error(`Failed to notify connection ${conn.connectionId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Failed to look up user connections:', err);
  }
}
