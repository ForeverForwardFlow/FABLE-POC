import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const s3Client = new S3Client({});
const lambdaClient = new LambdaClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET!;
const BUILDS_TABLE = process.env.BUILDS_TABLE!;
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const TOOL_DEPLOYER_ARN = process.env.TOOL_DEPLOYER_ARN!;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!;
const STAGE = process.env.STAGE || 'dev';
const VERSION = '2'; // bump to force deploy

interface EcsTaskStateChangeEvent {
  detail: {
    clusterArn: string;
    taskArn: string;
    lastStatus: string;
    startedBy?: string;
    stoppedReason?: string;
    stopCode?: string;
    containers?: Array<{
      name: string;
      exitCode?: number;
      reason?: string;
    }>;
  };
}

export const handler = async (event: EcsTaskStateChangeEvent): Promise<void> => {
  const { detail } = event;
  console.log('Build completion triggered:', JSON.stringify({
    taskArn: detail.taskArn,
    startedBy: detail.startedBy,
    stopCode: detail.stopCode,
    stoppedReason: detail.stoppedReason,
  }));

  // Extract buildId from startedBy field ("fable-build:{buildId}")
  const startedBy = detail.startedBy || '';
  if (!startedBy.startsWith('fable-build:')) {
    console.log('Not a FABLE build task, ignoring');
    return;
  }
  const buildId = startedBy.replace('fable-build:', '');
  console.log(`Processing build completion for: ${buildId}`);

  // Check container exit code
  const container = detail.containers?.find(c => c.name === 'fable-build');
  const exitCode = container?.exitCode ?? -1;
  const taskSucceeded = exitCode === 0;

  // Look up build record to get orgId, userId
  const buildRecord = await findBuildRecord(buildId);
  if (!buildRecord) {
    console.error(`Build record not found for ${buildId}`);
    return;
  }

  const { orgId, userId } = buildRecord;

  // Try to read builder output from S3
  let builderOutput: Record<string, unknown> | null = null;
  try {
    const s3Response = await s3Client.send(new GetObjectCommand({
      Bucket: ARTIFACTS_BUCKET,
      Key: `builds/${buildId}/builder-output.json`,
    }));
    const body = await s3Response.Body?.transformToString();
    if (body) {
      builderOutput = JSON.parse(body);
      console.log('Builder output:', JSON.stringify(builderOutput).slice(0, 500));
    }
  } catch (err) {
    console.log('No builder output found in S3 (task may have crashed):', String(err));
  }

  const buildSucceeded = taskSucceeded && builderOutput?.status === 'success';

  if (buildSucceeded && builderOutput) {
    // Deploy the built tools
    try {
      console.log('Deploying tools...');
      const deployResult = await lambdaClient.send(new InvokeCommand({
        FunctionName: TOOL_DEPLOYER_ARN,
        Payload: Buffer.from(JSON.stringify({
          action: 'deploy',
          payload: {
            buildId,
            oiOutput: builderOutput,  // Compatible with BatchDeployPayload
            orgId,
            userId,
          },
        })),
      }));

      const deployResponse = JSON.parse(Buffer.from(deployResult.Payload!).toString());
      console.log('Deploy result:', JSON.stringify(deployResponse).slice(0, 500));

      // Update build status to completed
      await updateBuildStatus(buildRecord, 'completed', deployResponse);

      // Notify user
      await notifyUser(userId, {
        type: 'build_completed',
        payload: {
          buildId,
          status: 'completed',
          tools: deployResponse.body ? JSON.parse(deployResponse.body)?.deployed : [],
        },
      });
    } catch (deployErr) {
      console.error('Deployment failed:', deployErr);
      await updateBuildStatus(buildRecord, 'failed', undefined, `Deployment failed: ${String(deployErr)}`);
      await notifyUser(userId, {
        type: 'build_failed',
        payload: { buildId, status: 'failed', error: `Deployment failed: ${String(deployErr)}` },
      });
    }
  } else {
    // Build failed
    const error = builderOutput?.error
      || detail.stoppedReason
      || `Builder exited with code ${exitCode}`;

    console.log(`Build failed: ${error}`);
    await updateBuildStatus(buildRecord, 'failed', undefined, String(error));
    await notifyUser(userId, {
      type: 'build_failed',
      payload: { buildId, status: 'failed', error: String(error) },
    });
  }
};

async function findBuildRecord(buildId: string): Promise<Record<string, unknown> | null> {
  // Direct lookup using default org (anonymous connections use 'default')
  const defaultOrgId = 'default';

  try {
    const result = await docClient.send(new GetCommand({
      TableName: BUILDS_TABLE,
      Key: {
        PK: `ORG#${defaultOrgId}`,
        SK: `BUILD#${buildId}`,
      },
    }));

    if (result.Item) {
      console.log('Found build record via direct lookup');
      return result.Item;
    }
  } catch (err) {
    console.log('Default org lookup failed:', err);
  }

  // Fallback: scan table by buildId (covers all orgs)
  try {
    const scanResult = await docClient.send(new ScanCommand({
      TableName: BUILDS_TABLE,
      FilterExpression: 'buildId = :buildId',
      ExpressionAttributeValues: {
        ':buildId': buildId,
      },
      Limit: 100,
    }));

    if (scanResult.Items && scanResult.Items.length > 0) {
      console.log('Found build record via table scan');
      return scanResult.Items[0];
    }
  } catch (err) {
    console.error('Fallback scan failed:', err);
  }

  return null;
}

async function updateBuildStatus(
  buildRecord: Record<string, unknown>,
  status: string,
  result?: unknown,
  error?: string,
): Promise<void> {
  const updateExpressions = ['#status = :status', '#updatedAt = :updatedAt'];
  const names: Record<string, string> = { '#status': 'status', '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':status': status, ':updatedAt': new Date().toISOString() };

  if (result) {
    updateExpressions.push('#result = :result');
    names['#result'] = 'result';
    values[':result'] = result;
  }
  if (error) {
    updateExpressions.push('#error = :error');
    names['#error'] = 'error';
    values[':error'] = error;
  }
  if (status === 'completed' || status === 'failed') {
    updateExpressions.push('#completedAt = :completedAt');
    names['#completedAt'] = 'completedAt';
    values[':completedAt'] = new Date().toISOString();
  }

  await docClient.send(new UpdateCommand({
    TableName: BUILDS_TABLE,
    Key: { PK: buildRecord.PK as string, SK: buildRecord.SK as string },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

async function notifyUser(userId: string, message: Record<string, unknown>): Promise<void> {
  // Find active connection for this user
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
        console.log(`Notified user via connection ${conn.connectionId}`);
      } catch (err: unknown) {
        // Connection may have been closed
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
