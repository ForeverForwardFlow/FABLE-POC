import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const BUILDS_TABLE = process.env.BUILDS_TABLE!;

interface UpdateBuildStatusEvent {
  buildId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: Record<string, unknown>;
  error?: string | Record<string, unknown>;
  phase?: string;
}

export const handler = async (event: UpdateBuildStatusEvent): Promise<{ statusCode: number; body: string }> => {
  console.log('Update Build Status:', JSON.stringify(event));

  const { buildId, status, result, error, phase } = event;

  try {
    // First, find the build record to get the PK (ORG#xxx)
    // We need to query by buildId using the GSI or scan
    // For now, we'll use a known pattern - builds are stored with PK=ORG#orgId
    // In production, you'd have a GSI on buildId

    // Build the update expression dynamically
    const updateExpressions: string[] = ['#status = :status', '#updatedAt = :updatedAt'];
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':status': status,
      ':updatedAt': new Date().toISOString(),
    };

    if (result) {
      updateExpressions.push('#result = :result');
      expressionAttributeNames['#result'] = 'result';
      expressionAttributeValues[':result'] = result;
    }

    if (error) {
      updateExpressions.push('#error = :error');
      expressionAttributeNames['#error'] = 'error';
      expressionAttributeValues[':error'] = typeof error === 'string' ? error : JSON.stringify(error);
    }

    if (phase) {
      updateExpressions.push('#phase = :phase');
      expressionAttributeNames['#phase'] = 'currentPhase';
      expressionAttributeValues[':phase'] = phase;
    }

    if (status === 'completed' || status === 'failed') {
      updateExpressions.push('#completedAt = :completedAt');
      expressionAttributeNames['#completedAt'] = 'completedAt';
      expressionAttributeValues[':completedAt'] = new Date().toISOString();
    }

    // For this implementation, we'll use a GSI query pattern
    // The Step Functions passes orgId, so we can construct the key
    // But for robustness, let's query first

    // Query to find the build
    const queryResult = await docClient.send(new QueryCommand({
      TableName: BUILDS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      FilterExpression: 'buildId = :buildId',
      ExpressionAttributeValues: {
        ':gsi1pk': `USER#00000000-0000-0000-0000-000000000001`, // Default user for now
        ':buildId': buildId,
      },
      Limit: 1,
    }));

    if (!queryResult.Items || queryResult.Items.length === 0) {
      // Try with default org pattern
      await docClient.send(new UpdateCommand({
        TableName: BUILDS_TABLE,
        Key: {
          PK: 'ORG#00000000-0000-0000-0000-000000000001',
          SK: `BUILD#${buildId}`,
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      }));
    } else {
      const item = queryResult.Items[0];
      await docClient.send(new UpdateCommand({
        TableName: BUILDS_TABLE,
        Key: {
          PK: item.PK,
          SK: item.SK,
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      }));
    }

    console.log(`Build ${buildId} status updated to ${status}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        buildId,
        status,
      }),
    };
  } catch (err) {
    console.error('Error updating build status:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(err) }),
    };
  }
};
