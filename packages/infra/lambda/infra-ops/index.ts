import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  DescribeLogGroupsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {
  LambdaClient,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  InvokeCommand,
  UpdateFunctionCodeCommand,
} from '@aws-sdk/client-lambda';
import {
  ECSClient,
  ListTasksCommand,
  DescribeTasksCommand,
} from '@aws-sdk/client-ecs';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const logsClient = new CloudWatchLogsClient({});
const lambdaClient = new LambdaClient({});
const ecsClient = new ECSClient({});
const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const STAGE = process.env.STAGE || 'dev';
const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET!;
const BUILDS_TABLE = process.env.BUILDS_TABLE!;
const BUILD_CLUSTER_ARN = process.env.BUILD_CLUSTER_ARN!;
const FABLE_PREFIX = `fable-${STAGE}-`;

// Functions FABLE can NEVER modify (hardcoded deny list)
const PROTECTED_FUNCTIONS = [
  `${FABLE_PREFIX}infra-ops`,
  `${FABLE_PREFIX}ws-authorizer`,
  `${FABLE_PREFIX}db-init`,
];

// Sensitive env var keys to strip from config responses
const SENSITIVE_KEYS = ['SECRET', 'PASSWORD', 'TOKEN', 'KEY', 'CREDENTIAL'];

interface InfraRequest {
  action: string;
  buildId?: string;
  params: Record<string, unknown>;
}

export const handler = async (event: InfraRequest): Promise<unknown> => {
  const { action, buildId, params } = event;
  console.log(`[infra-ops] action=${action} buildId=${buildId || 'none'}`);

  try {
    switch (action) {
      case 'read_logs':
        return await readLogs(params);
      case 'get_lambda_config':
        return await getLambdaConfig(params);
      case 'get_lambda_code':
        return await getLambdaCode(params);
      case 'test_invoke':
        return await testInvoke(params);
      case 'describe_ecs_tasks':
        return await describeEcsTasks(params);
      case 'update_lambda_code':
        await auditModification(action, params, buildId);
        return await updateLambdaCode(params);
      case 'update_template':
        await auditModification(action, params, buildId);
        return await updateTemplate(params);
      default:
        return { error: `Unknown action: ${action}` };
    }
  } catch (err) {
    console.error(`[infra-ops] Error in ${action}:`, err);
    return { error: String(err) };
  }
};

// ============================================================
// Validation helpers
// ============================================================

function validateFableResource(name: string): void {
  if (!name.startsWith(FABLE_PREFIX)) {
    throw new Error(`Access denied: ${name} is not a FABLE resource (must start with ${FABLE_PREFIX})`);
  }
}

function validateNotProtected(functionName: string): void {
  if (PROTECTED_FUNCTIONS.includes(functionName)) {
    throw new Error(`Access denied: ${functionName} is a protected function and cannot be modified`);
  }
}

function stripSensitiveEnvVars(envVars: Record<string, string>): Record<string, string> {
  const stripped: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    if (SENSITIVE_KEYS.some(s => key.toUpperCase().includes(s))) {
      stripped[key] = '[REDACTED]';
    } else {
      stripped[key] = value;
    }
  }
  return stripped;
}

// ============================================================
// Read-only actions
// ============================================================

async function readLogs(params: Record<string, unknown>): Promise<unknown> {
  const component = params.component as string;
  const timeRange = (params.timeRange as number) || 30; // minutes
  const filterPattern = params.filterPattern as string | undefined;
  const limit = Math.min((params.limit as number) || 100, 500);

  if (!component) throw new Error('Missing required param: component');

  // Resolve log group name from component
  const functionName = component.startsWith(FABLE_PREFIX) ? component : `${FABLE_PREFIX}${component}`;
  validateFableResource(functionName);

  // Try Lambda log group first, then ECS
  const logGroupCandidates = [
    `/aws/lambda/${functionName}`,
    `/ecs/${FABLE_PREFIX}builds`, // ECS builder logs
  ];

  const startTime = Date.now() - timeRange * 60 * 1000;
  const events: Array<{ timestamp: number; message: string }> = [];

  for (const logGroup of logGroupCandidates) {
    try {
      const result = await logsClient.send(new FilterLogEventsCommand({
        logGroupName: logGroup,
        startTime,
        endTime: Date.now(),
        filterPattern: filterPattern || undefined,
        limit,
      }));

      if (result.events && result.events.length > 0) {
        for (const ev of result.events) {
          events.push({
            timestamp: ev.timestamp || 0,
            message: (ev.message || '').trim(),
          });
        }
        break; // Found logs in this group, stop looking
      }
    } catch (err: unknown) {
      // Log group may not exist, continue to next candidate
      if ((err as { name?: string }).name !== 'ResourceNotFoundException') {
        console.log(`Log group ${logGroup} query failed:`, err);
      }
    }
  }

  return {
    component,
    logGroup: logGroupCandidates[0],
    timeRange: `last ${timeRange} minutes`,
    eventCount: events.length,
    events: events.slice(0, limit),
  };
}

async function getLambdaConfig(params: Record<string, unknown>): Promise<unknown> {
  const component = params.component as string;
  if (!component) throw new Error('Missing required param: component');

  const functionName = component.startsWith(FABLE_PREFIX) ? component : `${FABLE_PREFIX}${component}`;
  validateFableResource(functionName);

  const config = await lambdaClient.send(new GetFunctionConfigurationCommand({
    FunctionName: functionName,
  }));

  return {
    functionName: config.FunctionName,
    runtime: config.Runtime,
    handler: config.Handler,
    timeout: config.Timeout,
    memorySize: config.MemorySize,
    lastModified: config.LastModified,
    codeSize: config.CodeSize,
    environment: config.Environment?.Variables
      ? stripSensitiveEnvVars(config.Environment.Variables)
      : {},
    role: config.Role,
    description: config.Description,
  };
}

async function getLambdaCode(params: Record<string, unknown>): Promise<unknown> {
  const component = params.component as string;
  if (!component) throw new Error('Missing required param: component');

  const functionName = component.startsWith(FABLE_PREFIX) ? component : `${FABLE_PREFIX}${component}`;
  validateFableResource(functionName);

  const fn = await lambdaClient.send(new GetFunctionCommand({
    FunctionName: functionName,
  }));

  const codeUrl = fn.Code?.Location;
  if (!codeUrl) throw new Error('No code location found');

  // Download the deployment package
  const response = await fetch(codeUrl);
  if (!response.ok) throw new Error(`Failed to download code: ${response.status}`);

  const buffer = await response.arrayBuffer();

  // Lambda deployment packages are zip files. Try to extract index.js or index.mjs
  // Use JSZip-like approach: look for the main handler file
  // For simplicity, return the code URL and size — the builder can download it
  // Actually, let's try to extract using Node.js built-in zlib
  const { unzipSync } = await import('zlib');
  const AdmZip = await import('adm-zip').catch(() => null);

  if (AdmZip) {
    const zip = new AdmZip.default(Buffer.from(buffer));
    const entries = zip.getEntries();
    const sourceFiles: Record<string, string> = {};

    for (const entry of entries) {
      if (
        !entry.isDirectory &&
        (entry.entryName.endsWith('.js') || entry.entryName.endsWith('.mjs') || entry.entryName.endsWith('.ts')) &&
        entry.getData().length < 500_000 // Skip very large files
      ) {
        sourceFiles[entry.entryName] = entry.getData().toString('utf-8');
      }
    }

    return {
      functionName,
      codeSize: buffer.byteLength,
      files: Object.keys(sourceFiles),
      source: sourceFiles,
    };
  }

  // Fallback: return just metadata
  return {
    functionName,
    codeSize: buffer.byteLength,
    note: 'adm-zip not available, returning metadata only',
    codeUrl: '[presigned URL available for 10 minutes]',
  };
}

async function testInvoke(params: Record<string, unknown>): Promise<unknown> {
  const component = params.component as string;
  const payload = params.payload as Record<string, unknown>;

  if (!component) throw new Error('Missing required param: component');
  if (!payload) throw new Error('Missing required param: payload');

  const functionName = component.startsWith(FABLE_PREFIX) ? component : `${FABLE_PREFIX}${component}`;
  validateFableResource(functionName);

  const result = await lambdaClient.send(new InvokeCommand({
    FunctionName: functionName,
    Payload: Buffer.from(JSON.stringify(payload)),
  }));

  const responseStr = Buffer.from(result.Payload!).toString();
  let responseBody: unknown;
  try {
    responseBody = JSON.parse(responseStr);
  } catch {
    responseBody = responseStr;
  }

  return {
    functionName,
    statusCode: result.StatusCode,
    functionError: result.FunctionError || null,
    response: responseBody,
  };
}

async function describeEcsTasks(params: Record<string, unknown>): Promise<unknown> {
  const status = (params.status as string) || 'STOPPED';
  const limit = Math.min((params.limit as number) || 10, 50);

  // List tasks in the build cluster
  const listResult = await ecsClient.send(new ListTasksCommand({
    cluster: BUILD_CLUSTER_ARN,
    desiredStatus: status as 'RUNNING' | 'STOPPED',
    maxResults: limit,
  }));

  if (!listResult.taskArns || listResult.taskArns.length === 0) {
    return { tasks: [], count: 0 };
  }

  const describeResult = await ecsClient.send(new DescribeTasksCommand({
    cluster: BUILD_CLUSTER_ARN,
    tasks: listResult.taskArns,
  }));

  const tasks = (describeResult.tasks || []).map(task => ({
    taskArn: task.taskArn,
    startedBy: task.startedBy,
    lastStatus: task.lastStatus,
    desiredStatus: task.desiredStatus,
    stoppedReason: task.stoppedReason,
    stopCode: task.stopCode,
    createdAt: task.createdAt?.toISOString(),
    stoppedAt: task.stoppedAt?.toISOString(),
    containers: (task.containers || []).map(c => ({
      name: c.name,
      exitCode: c.exitCode,
      reason: c.reason,
      lastStatus: c.lastStatus,
    })),
  }));

  return { tasks, count: tasks.length };
}

// ============================================================
// Modification actions
// ============================================================

async function updateLambdaCode(params: Record<string, unknown>): Promise<unknown> {
  const component = params.component as string;
  const s3Key = params.s3Key as string;
  const reason = params.reason as string;

  if (!component) throw new Error('Missing required param: component');
  if (!s3Key) throw new Error('Missing required param: s3Key');
  if (!reason) throw new Error('Missing required param: reason (explain why this change is needed)');

  const functionName = component.startsWith(FABLE_PREFIX) ? component : `${FABLE_PREFIX}${component}`;
  validateFableResource(functionName);
  validateNotProtected(functionName);

  console.log(`[infra-ops] Updating code for ${functionName} from s3://${ARTIFACTS_BUCKET}/${s3Key}. Reason: ${reason}`);

  const result = await lambdaClient.send(new UpdateFunctionCodeCommand({
    FunctionName: functionName,
    S3Bucket: ARTIFACTS_BUCKET,
    S3Key: s3Key,
  }));

  return {
    functionName: result.FunctionName,
    lastModified: result.LastModified,
    codeSize: result.CodeSize,
    codeSha256: result.CodeSha256,
    reason,
  };
}

async function updateTemplate(params: Record<string, unknown>): Promise<unknown> {
  const templateName = params.templateName as string;
  const content = params.content as string;
  const reason = params.reason as string;

  if (!templateName) throw new Error('Missing required param: templateName');
  if (!content) throw new Error('Missing required param: content');
  if (!reason) throw new Error('Missing required param: reason');

  // Only allow known template names
  const allowedTemplates = ['CLAUDE.md.builder'];
  if (!allowedTemplates.includes(templateName)) {
    throw new Error(`Access denied: Unknown template "${templateName}". Allowed: ${allowedTemplates.join(', ')}`);
  }

  const s3Key = `templates/${templateName}`;
  console.log(`[infra-ops] Updating template ${templateName}. Reason: ${reason}`);

  await s3Client.send(new PutObjectCommand({
    Bucket: ARTIFACTS_BUCKET,
    Key: s3Key,
    Body: content,
    ContentType: 'text/markdown',
  }));

  return {
    templateName,
    s3Key,
    contentLength: content.length,
    reason,
  };
}

// ============================================================
// Audit trail
// ============================================================

async function auditModification(
  action: string,
  params: Record<string, unknown>,
  buildId?: string,
): Promise<void> {
  const target = (params.component as string) || (params.templateName as string) || 'unknown';
  const reason = (params.reason as string) || 'no reason provided';
  const timestamp = new Date().toISOString();

  try {
    await docClient.send(new PutCommand({
      TableName: BUILDS_TABLE,
      Item: {
        PK: 'AUDIT#infra',
        SK: `${timestamp}#${crypto.randomUUID()}`,
        action,
        target,
        buildId: buildId || 'manual',
        reason,
        timestamp,
        params: JSON.stringify(params).slice(0, 1000), // truncate for safety
      },
    }));
    console.log(`[audit] ${action} on ${target} by ${buildId || 'manual'}: ${reason}`);
  } catch (err) {
    console.error('[audit] Failed to write audit record:', err);
    // Don't fail the operation if audit fails
  }
}
