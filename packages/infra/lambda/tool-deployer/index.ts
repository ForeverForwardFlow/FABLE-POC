import {
  LambdaClient,
  CreateFunctionCommand,
  CreateFunctionUrlConfigCommand,
  GetFunctionUrlConfigCommand,
  AddPermissionCommand,
  GetFunctionCommand,
  UpdateFunctionCodeCommand,
  DeleteFunctionCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import JSZip from 'jszip';
import * as crypto from 'crypto';
import * as https from 'https';

const lambdaClient = new LambdaClient({});
const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const secretsClient = new SecretsManagerClient({});

const TOOLS_TABLE = process.env.TOOLS_TABLE!;
const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET!;
const TOOL_ROLE_ARN = process.env.TOOL_ROLE_ARN!;
const STAGE = process.env.STAGE || 'dev';
const GITHUB_SECRET_ARN = process.env.GITHUB_SECRET_ARN;

interface DeployToolInput {
  toolName: string;
  s3Key?: string;
  s3Bucket?: string;
  description?: string;
  schema: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  uiDefinition?: Record<string, unknown>;
  memorySize?: number;
  timeout?: number;
  environment?: Record<string, string>;
  orgId?: string;
  userId?: string;
  // Git metadata (when deployed via GitHub Actions)
  gitRepo?: string;
  gitPath?: string;
  gitCommit?: string;
}

interface UndeployToolInput {
  toolName: string;
  orgId?: string;
}

interface ToolDeployerEvent {
  action: 'deploy' | 'undeploy' | 'list';
  payload: DeployToolInput | UndeployToolInput | BatchDeployPayload;
}

// Payload format from Step Functions batch deploy
interface BatchDeployPayload {
  buildId: string;
  oiOutput: {
    tools?: Array<{
      toolName: string;
      description: string;
      s3Key?: string;  // Optional when using GitHub deployment
      handler?: string;
      schema: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      };
      uiDefinition?: Record<string, unknown>;
      // Git metadata (GitHub deployment method)
      gitPath?: string;
    }>;
    // Deployment metadata
    deployment?: {
      method: 'github' | 's3';
      repo?: string;
      commit?: string;
      branch?: string;
    };
    status?: string;
    workers_completed?: number;
    files_created?: number;
    tests_passed?: number;
  };
  orgId?: string;
  userId?: string;
}

function isBatchDeployPayload(payload: unknown): payload is BatchDeployPayload {
  return typeof payload === 'object' && payload !== null && 'oiOutput' in payload;
}

export const handler = async (event: ToolDeployerEvent): Promise<{ statusCode: number; body: string }> => {
  console.log('Tool Deployer invoked:', event.action);

  try {
    switch (event.action) {
      case 'deploy':
        // Check if this is a batch deploy from Step Functions
        if (isBatchDeployPayload(event.payload)) {
          return await deployBatch(event.payload);
        }
        return await deployTool(event.payload as DeployToolInput);
      case 'undeploy':
        return await undeployTool(event.payload as UndeployToolInput);
      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${event.action}` }) };
    }
  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: String(error) }) };
  }
};

async function deployBatch(payload: BatchDeployPayload): Promise<{ statusCode: number; body: string }> {
  const { buildId, oiOutput, orgId, userId } = payload;
  const tools = oiOutput?.tools || [];

  console.log(`Batch deploy for build ${buildId}: ${tools.length} tools`);

  // Check if this is a UI modification on a feature branch that needs merging
  const deployment = oiOutput?.deployment;
  if (tools.length === 0 && deployment?.method === 'github' && deployment.branch && deployment.branch !== 'main') {
    console.log(`UI modification detected on branch ${deployment.branch}, merging to main...`);
    try {
      await mergeFeatureBranch(deployment.repo!, deployment.branch);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          deployed: [],
          message: `Merged ${deployment.branch} to main — deploy-ui.yml will handle frontend deployment`,
          mergedBranch: deployment.branch,
        }),
      };
    } catch (mergeError) {
      console.error('Failed to merge feature branch:', mergeError);
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: `Failed to merge ${deployment.branch} to main: ${String(mergeError)}`,
        }),
      };
    }
  }

  if (tools.length === 0) {
    console.log('No tools to deploy');
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        deployed: [],
        message: 'No tools to deploy',
      }),
    };
  }

  const results = [];
  const errors = [];

  // deployment was already extracted above for branch-merge check
  const isGitHubDeploy = deployment?.method === 'github';

  for (const tool of tools) {
    try {
      console.log(`Deploying tool: ${tool.toolName}`);
      const result = await deployTool({
        toolName: tool.toolName,
        s3Key: tool.s3Key,
        description: tool.description,
        schema: tool.schema,
        uiDefinition: tool.uiDefinition,
        orgId: orgId || '00000000-0000-0000-0000-000000000001',
        userId: userId || '00000000-0000-0000-0000-000000000001',
        // Git metadata from deployment info
        gitRepo: isGitHubDeploy ? deployment.repo : undefined,
        gitPath: tool.gitPath || (isGitHubDeploy ? `tools/${tool.toolName}` : undefined),
        gitCommit: isGitHubDeploy ? deployment.commit : undefined,
      });

      const body = JSON.parse(result.body);
      if (result.statusCode === 200) {
        results.push(body.tool);
      } else {
        errors.push({ toolName: tool.toolName, error: body.error });
      }
    } catch (error) {
      console.error(`Failed to deploy ${tool.toolName}:`, error);
      errors.push({ toolName: tool.toolName, error: String(error) });
    }
  }

  const success = errors.length === 0;
  const status = success ? 'success' : (results.length > 0 ? 'partial' : 'failed');

  return {
    statusCode: success ? 200 : (results.length > 0 ? 207 : 500),
    body: JSON.stringify({
      success,
      status,
      deployed: results,
      errors: errors.length > 0 ? errors : undefined,
      summary: {
        total: tools.length,
        deployed: results.length,
        failed: errors.length,
      },
    }),
  };
}

// Download built code from GitHub, zip it, upload to S3 for Lambda deployment
async function prepareGitHubArtifact(input: {
  gitRepo: string;
  gitPath: string;
  gitCommit: string;
  toolName: string;
}): Promise<{ s3Bucket: string; s3Key: string }> {
  const { token } = await getGitHubToken();
  const [repoOwner, repoName] = input.gitRepo.split('/');

  console.log(`Downloading dist/index.js from ${input.gitRepo}/${input.gitPath}@${input.gitCommit}`);

  // Download dist/index.js from GitHub Contents API
  const contents = await githubApiRequest(
    'GET',
    `/repos/${repoOwner}/${repoName}/contents/${input.gitPath}/dist/index.js?ref=${input.gitCommit}`,
    token,
  );

  if (!contents.content) {
    throw new Error(`No content returned for ${input.gitPath}/dist/index.js — file may be too large or missing`);
  }

  // Decode base64 content from GitHub
  const fileContent = Buffer.from(contents.content as string, 'base64');
  console.log(`Downloaded ${fileContent.length} bytes`);

  // Create zip with index.js at root (Lambda handler expects this)
  const zip = new JSZip();
  zip.file('index.js', fileContent);
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

  // Upload to S3
  const s3Key = `tools/${input.toolName}/lambda.zip`;
  await s3Client.send(new PutObjectCommand({
    Bucket: ARTIFACTS_BUCKET,
    Key: s3Key,
    Body: zipBuffer,
    ContentType: 'application/zip',
  }));

  console.log(`Uploaded Lambda zip to s3://${ARTIFACTS_BUCKET}/${s3Key} (${zipBuffer.length} bytes)`);

  return { s3Bucket: ARTIFACTS_BUCKET, s3Key };
}

async function deployTool(input: DeployToolInput): Promise<{ statusCode: number; body: string }> {
  const {
    toolName,
    s3Key: inputS3Key,
    s3Bucket: inputS3Bucket = ARTIFACTS_BUCKET,
    description = `FABLE-built tool: ${toolName}`,
    schema,
    uiDefinition,
    memorySize = 256,
    timeout = 30,
    environment = {},
    orgId = '00000000-0000-0000-0000-000000000001',
    userId = '00000000-0000-0000-0000-000000000001',
    // Git metadata
    gitRepo,
    gitPath,
    gitCommit,
  } = input;

  // Resolve deployment artifact: S3 key directly, or download from GitHub
  let s3Key = inputS3Key;
  let s3Bucket = inputS3Bucket;

  if (!s3Key && gitRepo && gitPath && gitCommit) {
    console.log(`No s3Key provided, downloading from GitHub: ${gitRepo}/${gitPath}@${gitCommit}`);
    const artifact = await prepareGitHubArtifact({ gitRepo, gitPath, gitCommit, toolName });
    s3Key = artifact.s3Key;
    s3Bucket = artifact.s3Bucket;
  }

  if (!s3Key) {
    throw new Error(`No deployment artifact for ${toolName}: need either s3Key or gitRepo+gitPath+gitCommit`);
  }

  // Determine deployment method
  const deployedBy = gitCommit ? 'github-actions' : 'direct';

  // Sanitize tool name for Lambda function name
  const functionName = `fable-${STAGE}-tool-${toolName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

  console.log(`Deploying tool: ${toolName} as ${functionName} from s3://${s3Bucket}/${s3Key}`);

  let functionArn: string;
  let functionUrl: string;
  let isUpdate = false;

  // Check if function already exists
  try {
    const existing = await lambdaClient.send(new GetFunctionCommand({
      FunctionName: functionName,
    }));
    functionArn = existing.Configuration!.FunctionArn!;
    isUpdate = true;
    console.log(`Function exists, updating code...`);

    // Update existing function code
    await lambdaClient.send(new UpdateFunctionCodeCommand({
      FunctionName: functionName,
      S3Bucket: s3Bucket,
      S3Key: s3Key,
    }));

    // Get existing Function URL
    const urlConfig = await lambdaClient.send(new GetFunctionUrlConfigCommand({
      FunctionName: functionName,
    }));
    functionUrl = urlConfig.FunctionUrl!;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      // Create new function
      console.log(`Creating new function...`);

      const createResult = await lambdaClient.send(new CreateFunctionCommand({
        FunctionName: functionName,
        Runtime: 'nodejs20.x',
        Role: TOOL_ROLE_ARN,
        Handler: 'index.handler',
        Code: {
          S3Bucket: s3Bucket,
          S3Key: s3Key,
        },
        Description: description,
        Timeout: timeout,
        MemorySize: memorySize,
        Environment: {
          Variables: {
            TOOL_NAME: toolName,
            STAGE,
            ...environment,
          },
        },
        Tags: {
          'fable:tool': toolName,
          'fable:stage': STAGE,
          'fable:org': orgId,
        },
      }));

      functionArn = createResult.FunctionArn!;

      // Wait for function to be active
      await waitForFunctionActive(functionName);

      // Create Function URL with IAM auth (more secure, internal AWS calls only)
      console.log(`Creating Function URL...`);
      const urlResult = await lambdaClient.send(new CreateFunctionUrlConfigCommand({
        FunctionName: functionName,
        AuthType: 'AWS_IAM',
        Cors: {
          AllowOrigins: ['*'],
          AllowMethods: ['POST'],
          AllowHeaders: ['Content-Type', 'Authorization'],
        },
      }));
      functionUrl = urlResult.FunctionUrl!;
    } else {
      throw error;
    }
  }

  // Register in DynamoDB
  const now = new Date().toISOString();
  await docClient.send(new PutCommand({
    TableName: TOOLS_TABLE,
    Item: {
      PK: `ORG#${orgId}`,
      SK: `TOOL#${toolName}`,
      toolName,
      functionName,
      functionArn,
      functionUrl,
      s3Bucket,
      s3Key,
      schema,
      description,
      memorySize,
      timeout,
      orgId,
      userId,
      createdAt: isUpdate ? undefined : now,
      updatedAt: now,
      version: isUpdate ? { $add: 1 } : 1,
      GSI1PK: `TOOL#${toolName}`,
      GSI1SK: `ORG#${orgId}`,
      // UI definition for dynamic frontend rendering
      ...(uiDefinition && { uiDefinition }),
      // Git metadata (for GitHub-deployed tools)
      ...(gitRepo && { gitRepo }),
      ...(gitPath && { gitPath }),
      ...(gitCommit && { gitCommit }),
      deployedBy,
    },
  }));

  console.log(`Tool deployed successfully: ${functionUrl}`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      tool: {
        toolName,
        functionName,
        functionUrl,
        schema,
        isUpdate,
      },
    }),
  };
}

async function undeployTool(input: UndeployToolInput): Promise<{ statusCode: number; body: string }> {
  const {
    toolName,
    orgId = '00000000-0000-0000-0000-000000000001',
  } = input;

  const functionName = `fable-${STAGE}-tool-${toolName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

  console.log(`Undeploying tool: ${toolName}`);

  try {
    // Delete the Lambda function
    await lambdaClient.send(new DeleteFunctionCommand({
      FunctionName: functionName,
    }));
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
    // Function doesn't exist, that's fine
  }

  // Remove from registry
  await docClient.send(new DeleteCommand({
    TableName: TOOLS_TABLE,
    Key: {
      PK: `ORG#${orgId}`,
      SK: `TOOL#${toolName}`,
    },
  }));

  console.log(`Tool undeployed: ${toolName}`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      toolName,
    }),
  };
}

async function waitForFunctionActive(functionName: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await lambdaClient.send(new GetFunctionCommand({
      FunctionName: functionName,
    }));

    if (result.Configuration?.State === 'Active') {
      return;
    }

    console.log(`Waiting for function to be active... (${result.Configuration?.State})`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error(`Function ${functionName} did not become active in time`);
}

// ============================================================
// GitHub API helpers for merging feature branches
// ============================================================

async function getGitHubToken(): Promise<{ token: string; owner: string; repo: string }> {
  if (!GITHUB_SECRET_ARN) throw new Error('GITHUB_SECRET_ARN not configured');

  const secret = await secretsClient.send(new GetSecretValueCommand({
    SecretId: GITHUB_SECRET_ARN,
  }));
  const creds = JSON.parse(secret.SecretString!);

  // Generate JWT for GitHub App
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + (10 * 60),
    iss: creds.appId,
  })).toString('base64url');

  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), creds.privateKey).toString('base64url');

  const jwt = `${header}.${payload}.${signature}`;

  // Exchange JWT for installation access token
  const installationToken = await githubApiRequest(
    'POST',
    `/app/installations/${creds.installationId}/access_tokens`,
    jwt,
  );

  return {
    token: installationToken.token as string,
    owner: creds.repoOwner,
    repo: creds.repoName,
  };
}

async function mergeFeatureBranch(repoFullName: string, branch: string): Promise<void> {
  const { token, owner, repo } = await getGitHubToken();
  const targetRepo = repoFullName || `${owner}/${repo}`;
  const [repoOwner, repoName] = targetRepo.split('/');

  console.log(`Merging ${branch} into main for ${targetRepo}`);

  const result = await githubApiRequest(
    'POST',
    `/repos/${repoOwner}/${repoName}/merges`,
    token,
    {
      base: 'main',
      head: branch,
      commit_message: `Merge ${branch} into main (FABLE deploy)`,
    },
  );

  console.log(`Merge successful: ${result.sha}`);
}

function githubApiRequest(method: string, path: string, token: string, body?: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'FABLE-Deploy',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }),
      },
    }, (res) => {
      let responseData = '';
      res.on('data', (chunk: Buffer) => { responseData += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseData || '{}'));
        } else {
          reject(new Error(`GitHub API ${method} ${path}: ${res.statusCode} ${responseData}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
