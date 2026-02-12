import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!;

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;
  const routeKey = event.requestContext.routeKey;

  console.log(`Connection event: ${routeKey}, connectionId: ${connectionId}`);

  try {
    if (routeKey === '$connect') {
      // Extract userId and orgId from WebSocket authorizer context
      const authorizer = event.requestContext.authorizer as Record<string, unknown> | undefined;
      const userId = (authorizer?.userId as string) || 'anonymous';
      const orgId = (authorizer?.orgId as string) || 'default';

      // Store connection in DynamoDB
      const ttl = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 hours

      await docClient.send(new PutCommand({
        TableName: CONNECTIONS_TABLE,
        Item: {
          connectionId,
          userId,
          orgId,
          connectedAt: new Date().toISOString(),
          detailsSubscribed: false,
          ttl,
        },
      }));

      console.log(`Connection stored: ${connectionId}`);
      return { statusCode: 200, body: 'Connected' };
    }

    if (routeKey === '$disconnect') {
      // Remove connection from DynamoDB
      await docClient.send(new DeleteCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId },
      }));

      console.log(`Connection removed: ${connectionId}`);
      return { statusCode: 200, body: 'Disconnected' };
    }

    // Unknown route
    return { statusCode: 400, body: 'Unknown route' };
  } catch (error) {
    console.error('Error handling connection:', error);
    return { statusCode: 500, body: 'Internal server error' };
  }
};

// Helper to send message to a connection
export async function sendToConnection(connectionId: string, message: unknown): Promise<void> {
  const client = new ApiGatewayManagementApiClient({
    endpoint: `https://${WEBSOCKET_ENDPOINT}`,
  });

  await client.send(new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: Buffer.from(JSON.stringify(message)),
  }));
}
