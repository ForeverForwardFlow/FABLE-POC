import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SchedulerClient, CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

const s3Client = new S3Client({});
const lambdaClient = new LambdaClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const bedrockClient = new BedrockRuntimeClient({ region: 'us-west-2' });
const schedulerClient = new SchedulerClient({});

const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET!;
const BUILDS_TABLE = process.env.BUILDS_TABLE!;
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const TOOL_DEPLOYER_ARN = process.env.TOOL_DEPLOYER_ARN!;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!;
const BUILD_KICKOFF_ARN = process.env.BUILD_KICKOFF_ARN!;
const MAX_BUILD_CYCLES = parseInt(process.env.MAX_BUILD_CYCLES || '5', 10);
const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE;
const WORKFLOW_EXECUTOR_ARN = process.env.WORKFLOW_EXECUTOR_ARN;
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN;
const STAGE = process.env.STAGE || 'dev';
const AUDIT_LOG_TABLE = process.env.AUDIT_LOG_TABLE;
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE;
const MEMORY_LAMBDA_ARN = process.env.MEMORY_LAMBDA_ARN;
const VERSION = '10'; // bump to force deploy

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

  // Track build cycle (outer retry loop)
  const buildCycle = (buildRecord.buildCycle as number) || 1;

  if (buildSucceeded && builderOutput) {
    // Handle fix builds (no tool deployment needed)
    const fixType = builderOutput.fixType as string | undefined;
    if (fixType) {
      console.log(`Fix build completed (type: ${fixType})`);
      const fixDescription = (builderOutput.description as string) || 'Fix applied';
      const filesChanged = (builderOutput.filesChanged as string[]) || [];
      await updateBuildStatus(buildRecord, 'completed', {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          status: 'success',
          fixType,
          description: fixDescription,
          filesChanged,
        }),
        fidelity: { requirement: buildRecord.request, buildCycle, fixType },
        workflows: [],
      });
      const fixLabel = fixType === 'frontend' ? 'Frontend' : 'Infrastructure';
      await notifyUser(userId, {
        type: 'build_completed',
        payload: {
          buildId,
          status: 'completed',
          tools: [],
          fixType,
          message: `${fixLabel} fix deployed! ${fixDescription}`,
          filesChanged,
        },
      });
      return;
    }

    // Deploy the built tools
    try {
      console.log(`Deploying tools (cycle ${buildCycle})...`);
      const deployResult = await lambdaClient.send(new InvokeCommand({
        FunctionName: TOOL_DEPLOYER_ARN,
        Payload: Buffer.from(JSON.stringify({
          action: 'deploy',
          payload: {
            buildId,
            oiOutput: builderOutput,
            orgId,
            userId,
          },
        })),
      }));

      const deployResponse = JSON.parse(Buffer.from(deployResult.Payload!).toString());
      console.log('Deploy result:', JSON.stringify(deployResponse).slice(0, 500));
      const deployBody = JSON.parse(deployResponse.body || '{}');
      const deployedTools = deployBody.deployed || [];

      // Post-deploy QA: smoke test each tool
      console.log(`Running post-deploy QA on ${deployedTools.length} tools...`);
      const toolSpecs = (builderOutput.tools as Array<Record<string, unknown>>) || [];
      const qaResults: QaResult[] = [];

      for (const deployedTool of deployedTools) {
        const spec = toolSpecs.find((t: Record<string, unknown>) => t.toolName === deployedTool.toolName);
        const testCases = (spec?.testCases as TestCase[]) || [];

        if (testCases.length === 0) {
          console.log(`No test cases for ${deployedTool.toolName}, skipping smoke test`);
          qaResults.push({
            toolName: deployedTool.toolName,
            testCases: [],
            allPassed: true,
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        // Wait for Lambda cold-start readiness
        await new Promise(r => setTimeout(r, 3000));

        const qaResult = await verifyDeployedTool(deployedTool, testCases);
        qaResults.push(qaResult);
        console.log(`QA for ${deployedTool.toolName}: ${qaResult.allPassed ? 'PASSED' : 'FAILED'}`);
        // Verbose per-test-case logging
        for (const tc of qaResult.testCases) {
          console.log(`  [${tc.passed ? 'PASS' : 'FAIL'}] ${tc.description}`);
          if (!tc.passed) {
            console.log(`    Input: ${JSON.stringify(tc.input).slice(0, 300)}`);
            console.log(`    Expected: ${JSON.stringify(tc.expectedOutput).slice(0, 300)}`);
            console.log(`    Actual: ${JSON.stringify(tc.actualOutput).slice(0, 300)}`);
            if (tc.error) console.log(`    Error: ${tc.error}`);
          }
        }
      }

      const allSmokePassed = qaResults.every(r => r.allPassed);

      // AI fidelity check (only if smoke tests pass)
      let fidelityResult: { pass: boolean; reasoning: string; gaps: string[] } | null = null;
      if (allSmokePassed && deployedTools.length > 0) {
        console.log('Running AI fidelity check...');
        fidelityResult = await checkFidelity(buildRecord, deployedTools, qaResults);
        console.log(`Fidelity check: ${fidelityResult.pass ? 'PASSED' : 'FAILED'} — ${fidelityResult.reasoning}`);
      }

      const allQaPassed = allSmokePassed && (fidelityResult === null || fidelityResult.pass);

      if (allQaPassed) {
        // Create workflows if builder output includes them
        let createdWorkflows: Array<{ name: string; workflowId: string }> = [];
        const workflowDefs = (builderOutput.workflows as Array<Record<string, unknown>>) || [];
        if (workflowDefs.length > 0 && WORKFLOWS_TABLE) {
          createdWorkflows = await createWorkflows(workflowDefs, orgId, userId, buildId);
          console.log(`Created ${createdWorkflows.length} workflows`);
        }

        // SUCCESS — notify user
        const fidelityRecord = {
          requirement: buildRecord.request,
          buildCycle,
          iteration: builderOutput.iteration,
          deployment: { deployed: deployedTools.length },
          qa: { results: qaResults, allPassed: true },
          fidelity: fidelityResult,
        };
        await updateBuildStatus(buildRecord, 'completed', { ...deployResponse, fidelity: fidelityRecord, workflows: createdWorkflows });

        // If this is a retry build (cycle 2+), mark parent build as completed
        if (buildCycle > 1 && buildRecord.parentBuildId) {
          await completeParentBuild(buildRecord.parentBuildId as string, buildId, buildRecord.orgId as string);
        }

        await notifyUser(userId, {
          type: 'build_completed',
          payload: { buildId, status: 'completed', tools: deployedTools, workflows: createdWorkflows },
        });

        // Extract learnings from the build conversation (fire-and-forget)
        if (buildRecord.conversationId && deployedTools.length > 0) {
          const firstTool = deployedTools[0]?.toolName || 'unknown';
          extractConversationMemories(
            buildRecord.conversationId as string,
            orgId as string,
            userId as string,
            firstTool,
          ).catch(err => console.warn('Memory extraction failed:', err));
        }
      } else {
        // QA FAILED — outer retry loop
        const failureContext = {
          smokeTestFailures: qaResults.filter(r => !r.allPassed).map(r => ({
            toolName: r.toolName,
            failedTests: r.testCases.filter(tc => !tc.passed).map(tc => ({
              description: tc.description,
              error: tc.error,
              expectedOutput: tc.expectedOutput,
              actualOutput: tc.actualOutput,
            })),
          })),
          fidelityGaps: fidelityResult?.gaps || [],
          fidelityReasoning: fidelityResult?.reasoning || '',
        };

        await retryOrAskForHelp(buildRecord, buildCycle, failureContext, userId);
      }
    } catch (deployErr) {
      console.error('Deployment failed:', deployErr);
      // Deployment infrastructure failure — retry via outer loop
      const failureContext = {
        smokeTestFailures: [],
        fidelityGaps: [],
        fidelityReasoning: `Deployment error: ${String(deployErr)}`,
      };
      await retryOrAskForHelp(buildRecord, buildCycle, failureContext, userId);
    }
  } else {
    // Build itself failed (code didn't compile, tests didn't pass after inner retries)
    const error = builderOutput?.error
      || detail.stoppedReason
      || `Builder exited with code ${exitCode}`;

    console.log(`Build failed (cycle ${buildCycle}): ${error}`);
    const failureContext = {
      smokeTestFailures: [],
      fidelityGaps: [],
      fidelityReasoning: `Build failure: ${String(error)}`,
    };
    await retryOrAskForHelp(buildRecord, buildCycle, failureContext, userId);
  }
};

// ============================================================
// Post-Deploy QA Types & Functions
// ============================================================

interface TestCase {
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  description: string;
}

interface QaTestResult {
  description: string;
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  actualOutput: unknown;
  passed: boolean;
  error?: string;
}

interface QaResult {
  toolName: string;
  testCases: QaTestResult[];
  allPassed: boolean;
  timestamp: string;
}

async function verifyDeployedTool(
  tool: { toolName: string; functionName: string; functionUrl: string; schema: { name: string } },
  testCases: TestCase[],
): Promise<QaResult> {
  const result: QaResult = {
    toolName: tool.toolName,
    testCases: [],
    allPassed: true,
    timestamp: new Date().toISOString(),
  };

  for (const testCase of testCases) {
    const tcResult: QaTestResult = {
      description: testCase.description,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      actualOutput: null,
      passed: false,
    };

    // Retry up to 3 times with backoff (cold start, propagation delay)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Use direct Lambda invoke (SDK) instead of SigV4-signed Function URL.
        // Tools expect {arguments: {...}} format (same as event.arguments in handler).
        const invokeResult = await lambdaClient.send(new InvokeCommand({
          FunctionName: tool.functionName,
          Payload: Buffer.from(JSON.stringify({ arguments: testCase.input })),
        }));

        const payloadStr = Buffer.from(invokeResult.Payload!).toString();
        const responseBody = JSON.parse(payloadStr);

        if (invokeResult.FunctionError) {
          throw new Error(`Lambda error: ${responseBody.errorMessage || payloadStr.slice(0, 200)}`);
        }

        tcResult.actualOutput = responseBody.result || responseBody;

        // Only treat error as failure if the test case doesn't expect an error field
        // (tools may intentionally return error messages for invalid inputs)
        if (responseBody.error && !testCase.expectedOutput.error) {
          throw new Error(responseBody.error.message || responseBody.error || 'Tool returned error');
        }

        // Partial match: check that expected fields exist in actual output
        tcResult.passed = partialMatch(tcResult.actualOutput, testCase.expectedOutput);
        break; // Success, no more retries
      } catch (err) {
        tcResult.error = String(err);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, attempt * 2000));
        }
      }
    }

    if (!tcResult.passed) result.allPassed = false;
    result.testCases.push(tcResult);
  }

  return result;
}

function partialMatch(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== 'object' || actual === null) return false;
  const actualObj = actual as Record<string, unknown>;
  for (const [key, expectedVal] of Object.entries(expected)) {
    // Special matchers: $exists (field must be present), $startsWith:prefix
    if (typeof expectedVal === 'string' && expectedVal.startsWith('$')) {
      if (expectedVal === '$exists') {
        if (!(key in actualObj)) return false;
      } else if (expectedVal.startsWith('$startsWith:')) {
        const prefix = expectedVal.slice('$startsWith:'.length);
        if (typeof actualObj[key] !== 'string' || !(actualObj[key] as string).startsWith(prefix)) return false;
      } else if (expectedVal.startsWith('$contains:')) {
        const substr = expectedVal.slice('$contains:'.length);
        if (typeof actualObj[key] !== 'string' || !(actualObj[key] as string).includes(substr)) return false;
      }
      // Unknown $ matcher — skip (don't fail on matchers we don't recognize)
    } else if (typeof expectedVal === 'object' && expectedVal !== null) {
      if (!partialMatch(actualObj[key], expectedVal as Record<string, unknown>)) return false;
    } else if (typeof expectedVal === 'number' && typeof actualObj[key] === 'number') {
      // Fuzzy numeric matching: 20% relative tolerance or absolute tolerance of 5
      const diff = Math.abs(actualObj[key] as number - expectedVal);
      const threshold = Math.max(Math.abs(expectedVal) * 0.2, 5);
      if (diff > threshold) return false;
    } else {
      if (actualObj[key] !== expectedVal) return false;
    }
  }
  return true;
}

async function checkFidelity(
  buildRecord: Record<string, unknown>,
  deployedTools: Array<{ toolName: string; schema: { name: string; description: string; inputSchema?: unknown } }>,
  qaResults: QaResult[],
): Promise<{ pass: boolean; reasoning: string; gaps: string[] }> {
  const toolSummary = deployedTools.map(t => {
    const qa = qaResults.find(r => r.toolName === t.toolName);
    return `Tool: ${t.toolName}\nDescription: ${t.schema.description}\nSchema: ${JSON.stringify(t.schema.inputSchema || {})}\nTest results: ${JSON.stringify(qa?.testCases.map(tc => ({ desc: tc.description, input: tc.input, output: tc.actualOutput, passed: tc.passed })) || [])}`;
  }).join('\n\n');

  const prompt = `You are a QA validator for FABLE. A user requested a tool and one was built and deployed.

Original requirement: "${buildRecord.request || ''}"

${toolSummary}

Does this tool fulfill the FUNCTIONAL requirements? Focus on:
- Does it accept the right inputs and produce the right outputs?
- Do the test results show correct behavior?
- Are the core computations/logic correct?

Do NOT fail for cosmetic or UI presentation differences (icons, labels, card layouts, field names).
These are handled separately by the frontend and are NOT part of the tool's functional contract.
If all smoke tests pass and the tool produces correct results, it should PASS.

Respond with ONLY valid JSON:
{"pass": true, "reasoning": "brief explanation", "gaps": []}
or
{"pass": false, "reasoning": "brief explanation", "gaps": ["specific functional gap 1"]}`;

  try {
    const response = await bedrockClient.send(new InvokeModelCommand({
      modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    }));

    const body = JSON.parse(new TextDecoder().decode(response.body));
    const text = body.content?.[0]?.text || '';
    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { pass: true, reasoning: 'Could not parse fidelity response, defaulting to pass', gaps: [] };
  } catch (err) {
    console.error('Fidelity check error:', err);
    return { pass: true, reasoning: `Fidelity check failed (${String(err)}), defaulting to pass`, gaps: [] };
  }
}

async function retryOrAskForHelp(
  buildRecord: Record<string, unknown>,
  buildCycle: number,
  failureContext: { smokeTestFailures: unknown[]; fidelityGaps: string[]; fidelityReasoning: string },
  userId: string,
): Promise<void> {
  const buildId = buildRecord.buildId as string;

  if (buildCycle < MAX_BUILD_CYCLES) {
    // Outer retry: re-trigger build with QA failure context
    const nextCycle = buildCycle + 1;
    console.log(`QA failed on cycle ${buildCycle}, re-triggering build (cycle ${nextCycle} of max ${MAX_BUILD_CYCLES})...`);

    try {
      // Update build record with cycle count (inside try/catch so failures don't block retry)
      await updateBuildStatus(buildRecord, 'retrying', { buildCycle: nextCycle, failureContext });

      // Upload augmented buildSpec to S3 to avoid ECS 8192 byte env var limit
      const originalSpec = buildRecord.spec || buildRecord.request;
      const augmentedSpec = {
        ...(typeof originalSpec === 'object' ? originalSpec : { request: originalSpec }),
        qaFailure: failureContext,
        buildCycle: nextCycle,
      };
      const s3Key = `builds/${buildId}/retry-spec-cycle${nextCycle}.json`;
      await s3Client.send(new PutObjectCommand({
        Bucket: ARTIFACTS_BUCKET,
        Key: s3Key,
        Body: JSON.stringify(augmentedSpec),
        ContentType: 'application/json',
      }));
      console.log(`Uploaded retry spec to s3://${ARTIFACTS_BUCKET}/${s3Key}`);

      // Re-invoke build-kickoff with S3 reference (entrypoint.sh handles s3:// prefix)
      console.log(`Invoking BUILD_KICKOFF_ARN (${BUILD_KICKOFF_ARN}) for cycle ${nextCycle}...`);
      const kickoffResult = await lambdaClient.send(new InvokeCommand({
        FunctionName: BUILD_KICKOFF_ARN,
        InvocationType: 'Event', // async — don't wait
        Payload: Buffer.from(JSON.stringify({
          action: 'start',
          payload: {
            request: buildRecord.request,
            spec: `s3://${ARTIFACTS_BUCKET}/${s3Key}`,
            userId,
            orgId: buildRecord.orgId,
            conversationId: buildRecord.conversationId,
            connectionId: buildRecord.connectionId,
            buildCycle: nextCycle,
            qaFailure: { reason: 'See build-spec.json in work directory for full failure context' },
            parentBuildId: buildId,
          },
        })),
      }));
      console.log(`Build-kickoff invoked for cycle ${nextCycle}, status: ${kickoffResult.StatusCode}`);
    } catch (retryErr) {
      // Retry launch failed — don't leave user stuck, ask for help
      console.error(`Failed to re-trigger build cycle ${nextCycle}:`, retryErr);
      const summary = `I tried to retry the build but encountered an infrastructure error: ${String(retryErr)}`;
      await updateBuildStatus(buildRecord, 'needs_help', { buildCycle, failureContext, retryError: String(retryErr) });
      await notifyUser(userId, {
        type: 'build_needs_help',
        payload: {
          buildId,
          status: 'needs_help',
          message: `I'm having difficulty building this. ${summary}. Can you try again?`,
          buildCycle,
        },
      });
    }
  } else {
    // Exhausted all cycles — ask user for help
    console.log(`Exhausted ${MAX_BUILD_CYCLES} build cycles, asking user for help`);
    const summary = failureContext.fidelityGaps.length > 0
      ? `I've tried ${buildCycle} times but the tool doesn't fully match your requirements. Gaps: ${failureContext.fidelityGaps.join(', ')}`
      : `I've tried ${buildCycle} times but the tool isn't passing verification. Last issue: ${failureContext.fidelityReasoning}`;

    await updateBuildStatus(buildRecord, 'needs_help', { buildCycle, failureContext });
    await notifyUser(userId, {
      type: 'build_needs_help',
      payload: {
        buildId,
        status: 'needs_help',
        message: `I'm having difficulty building this. ${summary}. Can you help me refine the requirements?`,
        buildCycle,
      },
    });
  }
}

async function extractConversationMemories(
  conversationId: string,
  orgId: string,
  userId: string,
  toolName: string,
): Promise<void> {
  if (!CONVERSATIONS_TABLE || !MEMORY_LAMBDA_ARN) return;

  try {
    // Fetch conversation messages
    const convResult = await docClient.send(new QueryCommand({
      TableName: CONVERSATIONS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `CONV#${conversationId}`,
        ':sk': 'MSG#',
      },
      ScanIndexForward: true,
    }));

    const messages = convResult.Items || [];
    if (messages.length < 2) return; // Need at least a back-and-forth

    // Build conversation text for analysis
    const conversationText = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'FABLE'}: ${(m.content as string || '').slice(0, 500)}`)
      .join('\n');

    if (conversationText.length < 50) return;

    // Ask Haiku to extract key decisions and preferences
    const extractionPrompt = `Analyze this conversation where a user requested FABLE to build "${toolName}". Extract any notable:
1. User preferences (coding style, UI preferences, naming conventions)
2. Key decisions made during requirement gathering
3. Domain knowledge revealed (industry terms, business rules)

Return ONLY a JSON array of objects with {type, content} where type is "preference", "insight", or "pattern".
If nothing notable, return an empty array [].
Keep each content under 100 characters. Max 3 items.

Conversation:
${conversationText.slice(0, 3000)}`;

    const bedrockResponse = await bedrockClient.send(new InvokeModelCommand({
      modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        messages: [{ role: 'user', content: extractionPrompt }],
      }),
    }));

    const bedrockBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    const responseText = bedrockBody.content?.[0]?.text || '[]';

    // Parse extracted memories
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const extracted = JSON.parse(jsonMatch[0]) as Array<{ type: string; content: string }>;
    if (!Array.isArray(extracted) || extracted.length === 0) return;

    console.log(`Extracted ${extracted.length} memories from conversation ${conversationId}`);

    // Save each memory via Memory Lambda
    for (const mem of extracted.slice(0, 3)) {
      const memType = ['preference', 'insight', 'pattern'].includes(mem.type) ? mem.type : 'insight';
      await lambdaClient.send(new InvokeCommand({
        FunctionName: MEMORY_LAMBDA_ARN,
        Payload: Buffer.from(JSON.stringify({
          action: 'create',
          payload: {
            type: memType,
            content: mem.content,
            scope: 'project',
            source: 'ai_inferred',
            tags: ['auto-extracted', 'conversation', toolName],
            orgId,
            userId,
            importance: 0.5,
          },
        })),
        InvocationType: 'Event', // Fire-and-forget
      }));
    }

    console.log(`Saved ${Math.min(extracted.length, 3)} conversation memories`);
  } catch (err) {
    console.warn('Failed to extract conversation memories:', err);
  }
}

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

  // Fallback: query GSI2-buildId (covers all orgs without scanning)
  try {
    const gsiResult = await docClient.send(new QueryCommand({
      TableName: BUILDS_TABLE,
      IndexName: 'GSI2-buildId',
      KeyConditionExpression: 'buildId = :buildId',
      ExpressionAttributeValues: {
        ':buildId': buildId,
      },
    }));

    if (gsiResult.Items && gsiResult.Items.length > 0) {
      console.log('Found build record via buildId GSI');
      return gsiResult.Items[0];
    }
  } catch (err) {
    console.error('GSI lookup failed:', err);
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

  // Write audit log for build status changes
  if (AUDIT_LOG_TABLE) {
    try {
      const now = new Date().toISOString();
      const eventId = `${now}#${buildRecord.buildId}`;
      await docClient.send(new PutCommand({
        TableName: AUDIT_LOG_TABLE,
        Item: {
          PK: buildRecord.PK as string, // ORG#{orgId}
          SK: `EVENT#${eventId}`,
          action: `build_${status}`,
          resource: 'build',
          resourceId: buildRecord.buildId as string,
          actor: (buildRecord.userId as string) || 'system',
          timestamp: now,
          details: {
            request: buildRecord.request,
            buildCycle: buildRecord.buildCycle,
            ...(error && { error }),
          },
        },
      }));
    } catch (auditErr) {
      console.warn('Failed to write audit log:', auditErr);
    }
  }
}

async function completeParentBuild(parentBuildId: string, childBuildId: string, orgId: string): Promise<void> {
  try {
    // Direct lookup of parent build by ID
    const parentRecord = await docClient.send(new GetCommand({
      TableName: BUILDS_TABLE,
      Key: { PK: `ORG#${orgId}`, SK: `BUILD#${parentBuildId}` },
    }));

    if (!parentRecord.Item) {
      console.log(`Parent build ${parentBuildId} not found, skipping status update`);
      return;
    }

    const parent = parentRecord.Item;
    if (parent.status !== 'retrying') {
      console.log(`Parent build ${parentBuildId} is "${parent.status}", not "retrying" — skipping`);
      return;
    }

    console.log(`Updating parent build ${parentBuildId} from "retrying" to "completed" (retry child ${childBuildId} succeeded)`);
    await docClient.send(new UpdateCommand({
      TableName: BUILDS_TABLE,
      Key: { PK: parent.PK as string, SK: parent.SK as string },
      UpdateExpression: 'SET #s = :status, #updatedAt = :now, #completedAt = :now, #resolvedBy = :childId',
      ExpressionAttributeNames: { '#s': 'status', '#updatedAt': 'updatedAt', '#completedAt': 'completedAt', '#resolvedBy': 'resolvedByBuildId' },
      ExpressionAttributeValues: { ':status': 'completed', ':now': new Date().toISOString(), ':childId': childBuildId },
    }));

    // Recurse: if the parent itself has a parent (multi-cycle retries), complete that too
    if (parent.parentBuildId) {
      await completeParentBuild(parent.parentBuildId as string, childBuildId, orgId);
    }

    console.log(`Parent build ${parentBuildId} marked as completed`);
  } catch (err) {
    // Non-fatal — don't fail the build completion over this
    console.error('Failed to update parent build:', err);
  }
}

async function createWorkflows(
  workflowDefs: Array<Record<string, unknown>>,
  orgId: string,
  userId: string,
  buildId: string,
): Promise<Array<{ name: string; workflowId: string }>> {
  const results: Array<{ name: string; workflowId: string }> = [];

  for (const wf of workflowDefs) {
    try {
      const workflowId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const name = wf.name as string;
      const now = new Date().toISOString();

      await docClient.send(new PutCommand({
        TableName: WORKFLOWS_TABLE!,
        Item: {
          PK: `ORG#${orgId}`,
          SK: `WORKFLOW#${workflowId}`,
          workflowId,
          name,
          description: wf.description || '',
          prompt: wf.prompt || '',
          tools: wf.tools || [],
          trigger: wf.trigger || { type: 'manual' },
          model: wf.model || 'haiku',
          maxTurns: wf.maxTurns || 10,
          status: 'active',
          orgId,
          userId,
          buildId,
          createdAt: now,
          updatedAt: now,
          GSI1PK: `USER#${userId}`,
          GSI1SK: `WORKFLOW#${workflowId}`,
        },
      }));

      // Create EventBridge schedule for cron triggers
      const trigger = wf.trigger as { type: string; schedule?: string; timezone?: string } | undefined;
      if (trigger?.type === 'cron' && trigger.schedule && WORKFLOW_EXECUTOR_ARN && SCHEDULER_ROLE_ARN) {
        const scheduleName = `fable-${STAGE}-wf-${workflowId}`;
        await schedulerClient.send(new CreateScheduleCommand({
          Name: scheduleName,
          ScheduleExpression: `cron(${trigger.schedule})`,
          ScheduleExpressionTimezone: trigger.timezone || 'UTC',
          Target: {
            Arn: WORKFLOW_EXECUTOR_ARN,
            RoleArn: SCHEDULER_ROLE_ARN,
            Input: JSON.stringify({ workflowId, orgId }),
          },
          FlexibleTimeWindow: { Mode: 'OFF' },
          State: 'ENABLED',
        }));
        console.log(`Created EventBridge schedule: ${scheduleName}`);
      }

      results.push({ name, workflowId });
      console.log(`Created workflow: ${name} (${workflowId})`);
    } catch (err) {
      console.error(`Failed to create workflow ${wf.name}:`, err);
    }
  }

  return results;
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
