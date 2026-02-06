import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const sfnClient = new SFNClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;
const BUILDS_TABLE = process.env.BUILDS_TABLE!;
const STAGE = process.env.STAGE || 'dev';

interface BuildRequest {
  // What the user wants built
  request: string;
  // Optional: pre-decomposed spec from CORE (if skipping CORE phase)
  spec?: Record<string, unknown>;
  // User context
  userId?: string;
  orgId?: string;
  // Optional: conversation ID for context
  conversationId?: string;
}

interface BuildKickoffEvent {
  action: 'start' | 'status';
  payload: BuildRequest | { buildId: string };
}

export const handler = async (event: BuildKickoffEvent): Promise<{ statusCode: number; body: string }> => {
  console.log('Build Kickoff invoked:', event.action);

  try {
    switch (event.action) {
      case 'start':
        return await startBuild(event.payload as BuildRequest);
      case 'status':
        return await getBuildStatus((event.payload as { buildId: string }).buildId);
      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${event.action}` }) };
    }
  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: String(error) }) };
  }
};

async function startBuild(request: BuildRequest): Promise<{ statusCode: number; body: string }> {
  const buildId = randomUUID();
  const now = new Date().toISOString();
  const {
    request: buildRequest,
    spec,
    userId = '00000000-0000-0000-0000-000000000001',
    orgId = '00000000-0000-0000-0000-000000000001',
    conversationId,
  } = request;

  console.log(`Starting build: ${buildId}`);
  console.log(`Request: ${buildRequest}`);

  // Create the build spec for the container (filter out undefined values)
  const buildSpec = spec || Object.fromEntries(
    Object.entries({ request: buildRequest, conversationId }).filter(([, v]) => v !== undefined)
  );

  // Record build in DynamoDB (filter out undefined values)
  const item: Record<string, unknown> = {
    PK: `ORG#${orgId}`,
    SK: `BUILD#${buildId}`,
    buildId,
    request: buildRequest,
    spec: buildSpec,
    status: 'pending',
    userId,
    orgId,
    createdAt: now,
    updatedAt: now,
    GSI1PK: `USER#${userId}`,
    GSI1SK: `BUILD#${now}`,
  };
  if (conversationId) item.conversationId = conversationId;

  await docClient.send(new PutCommand({
    TableName: BUILDS_TABLE,
    Item: item,
  }));

  // Start Step Functions execution
  const executionName = `build-${buildId.slice(0, 8)}-${Date.now()}`;

  await sfnClient.send(new StartExecutionCommand({
    stateMachineArn: STATE_MACHINE_ARN,
    name: executionName,
    input: JSON.stringify({
      buildId,
      buildSpec: JSON.stringify(buildSpec),
      userId,
      orgId,
      conversationId,
    }),
  }));

  console.log(`Build started: ${buildId}, execution: ${executionName}`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      buildId,
      status: 'pending',
      message: 'Build started. Use status action to check progress.',
    }),
  };
}

async function getBuildStatus(buildId: string): Promise<{ statusCode: number; body: string }> {
  // For now, just return that we'd query DynamoDB
  // Full implementation would query the builds table
  return {
    statusCode: 200,
    body: JSON.stringify({
      buildId,
      message: 'Status lookup - query builds table by buildId',
    }),
  };
}
