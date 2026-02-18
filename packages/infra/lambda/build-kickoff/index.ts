import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const ecsClient = new ECSClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const BUILD_CLUSTER_ARN = process.env.BUILD_CLUSTER_ARN!;
const BUILD_TASK_DEF = process.env.BUILD_TASK_DEF!;
const BUILD_SUBNETS = process.env.BUILD_SUBNETS!;
const BUILD_SECURITY_GROUP = process.env.BUILD_SECURITY_GROUP!;
const BUILDS_TABLE = process.env.BUILDS_TABLE!;
const STAGE = process.env.STAGE || 'dev';
const MAX_CONCURRENT_BUILDS = parseInt(process.env.MAX_CONCURRENT_BUILDS || '3', 10);

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
  // Optional: connection ID for WebSocket notifications
  connectionId?: string;
  // Outer retry loop: which build cycle this is (1 = first attempt)
  buildCycle?: number;
  // QA failure context from previous cycle (if retrying)
  qaFailure?: Record<string, unknown>;
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
    orgId = 'default',
    conversationId,
    connectionId,
    buildCycle = 1,
    qaFailure,
  } = request;

  console.log(`Starting build: ${buildId} (cycle ${buildCycle})`);
  console.log(`Request: ${buildRequest}`);

  // Create the build spec for the container
  const baseSpec = spec || Object.fromEntries(
    Object.entries({ request: buildRequest, conversationId }).filter(([, v]) => v !== undefined)
  );
  // Augment spec with QA failure context if this is a retry cycle
  const buildSpec = qaFailure
    ? { ...baseSpec, qaFailure, buildCycle }
    : baseSpec;

  // Record build in DynamoDB
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
  if (connectionId) item.connectionId = connectionId;
  if (buildCycle > 1) item.buildCycle = buildCycle;

  // Check concurrent build limit before recording
  const activeBuilds = await docClient.send(new QueryCommand({
    TableName: BUILDS_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    FilterExpression: '#s IN (:pending, :retrying)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':pk': `ORG#${orgId}`,
      ':sk': 'BUILD#',
      ':pending': 'pending',
      ':retrying': 'retrying',
    },
    Select: 'COUNT',
  }));

  if ((activeBuilds.Count || 0) >= MAX_CONCURRENT_BUILDS) {
    console.log(`Concurrency limit hit: ${activeBuilds.Count} active builds for org ${orgId} (limit: ${MAX_CONCURRENT_BUILDS})`);
    return {
      statusCode: 429,
      body: JSON.stringify({
        error: 'Too many concurrent builds',
        activeBuilds: activeBuilds.Count,
        limit: MAX_CONCURRENT_BUILDS,
        message: `You have ${activeBuilds.Count} builds running. Please wait for one to finish before starting another.`,
      }),
    };
  }

  await docClient.send(new PutCommand({
    TableName: BUILDS_TABLE,
    Item: item,
  }));

  // Start ECS builder task directly
  const taskResult = await ecsClient.send(new RunTaskCommand({
    cluster: BUILD_CLUSTER_ARN,
    taskDefinition: BUILD_TASK_DEF,
    launchType: 'FARGATE',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: BUILD_SUBNETS.split(','),
        securityGroups: [BUILD_SECURITY_GROUP],
        assignPublicIp: 'DISABLED',
      },
    },
    overrides: {
      containerOverrides: [{
        name: 'fable-build',
        environment: [
          { name: 'FABLE_PHASE', value: 'builder' },
          { name: 'FABLE_BUILD_SPEC', value: JSON.stringify(buildSpec) },
          { name: 'FABLE_BUILD_ID', value: buildId },
          { name: 'FABLE_ORG_ID', value: orgId },
          { name: 'FABLE_USER_ID', value: userId },
        ],
      }],
    },
    startedBy: `fable-build:${buildId}`,
    count: 1,
  }));

  const taskArn = taskResult.tasks?.[0]?.taskArn;
  console.log(`Build started: ${buildId}, ECS task: ${taskArn}`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      buildId,
      taskArn,
      status: 'pending',
      message: 'Build started. You will be notified when complete.',
    }),
  };
}

async function getBuildStatus(buildId: string): Promise<{ statusCode: number; body: string }> {
  return {
    statusCode: 200,
    body: JSON.stringify({
      buildId,
      message: 'Status lookup - query builds table by buildId',
    }),
  };
}
