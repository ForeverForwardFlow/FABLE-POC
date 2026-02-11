import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from '@aws-sdk/client-ssm';
import {
  EC2Client,
  DescribeInstanceStatusCommand,
  StartInstancesCommand,
} from '@aws-sdk/client-ec2';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const ssm = new SSMClient({});
const ec2 = new EC2Client({});
const s3 = new S3Client({});

const QA_INSTANCE_ID = process.env.QA_INSTANCE_ID!;
const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET!;
const GITHUB_SECRET_ARN = process.env.GITHUB_SECRET_ARN!;
const STAGE = process.env.STAGE || 'dev';

interface QAInput {
  buildId: string;
  buildSpec: string;
  oiOutput: Record<string, unknown>;
  iteration?: number;
  userId?: string;
  orgId?: string;
}

export const handler = async (event: QAInput): Promise<{
  statusCode: number;
  body: string;
}> => {
  const { buildId, buildSpec, oiOutput, iteration = 1, userId, orgId } = event;
  console.log(`QA Orchestrator: build=${buildId}, iteration=${iteration}`);

  try {
    // 1. Ensure EC2 is running
    await ensureInstanceRunning();

    // 2. Upload QA context to S3
    const qaInputKey = `builds/${buildId}/qa-input.json`;
    await s3.send(new PutObjectCommand({
      Bucket: ARTIFACTS_BUCKET,
      Key: qaInputKey,
      Body: JSON.stringify({
        buildId,
        buildSpec: typeof buildSpec === 'string' ? JSON.parse(buildSpec) : buildSpec,
        oiOutput,
        iteration,
        userId,
        orgId,
        stage: STAGE,
        artifactsBucket: ARTIFACTS_BUCKET,
        githubSecretArn: GITHUB_SECRET_ARN,
      }),
      ContentType: 'application/json',
    }));

    console.log(`Uploaded QA input to s3://${ARTIFACTS_BUCKET}/${qaInputKey}`);

    // 3. Send SSM RunCommand to EC2
    const commandResult = await ssm.send(new SendCommandCommand({
      InstanceIds: [QA_INSTANCE_ID],
      DocumentName: 'AWS-RunShellScript',
      Parameters: {
        commands: [
          `sudo -u fable-qa /opt/fable/qa-entrypoint.sh ${ARTIFACTS_BUCKET} ${buildId}`,
        ],
        executionTimeout: ['600'], // 10 minutes
      },
      TimeoutSeconds: 660,
      Comment: `FABLE QA: build=${buildId}, iteration=${iteration}`,
    }));

    const commandId = commandResult.Command?.CommandId;
    if (!commandId) {
      throw new Error('Failed to get SSM command ID');
    }

    console.log(`SSM command sent: ${commandId}`);

    // 4. Poll for completion
    const result = await pollCommandCompletion(commandId, QA_INSTANCE_ID);

    console.log(`QA command completed with status: ${result.status}`);

    return {
      statusCode: result.status === 'Success' ? 200 : 500,
      body: JSON.stringify({
        commandId,
        status: result.status,
        output: result.output,
        buildId,
      }),
    };
  } catch (error) {
    console.error('QA Orchestrator error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: String(error),
        buildId,
      }),
    };
  }
};

async function ensureInstanceRunning(): Promise<void> {
  const status = await ec2.send(new DescribeInstanceStatusCommand({
    InstanceIds: [QA_INSTANCE_ID],
    IncludeAllInstances: true,
  }));

  const instanceState = status.InstanceStatuses?.[0]?.InstanceState?.Name;
  console.log(`EC2 instance ${QA_INSTANCE_ID} state: ${instanceState}`);

  if (instanceState === 'running') {
    // Verify SSM agent is ready
    await waitForSSMReady();
    return;
  }

  if (instanceState === 'stopped') {
    console.log('Starting EC2 instance...');
    await ec2.send(new StartInstancesCommand({
      InstanceIds: [QA_INSTANCE_ID],
    }));
    await waitForSSMReady();
    return;
  }

  // Instance might be starting, stopping, or in another transitional state
  if (instanceState === 'pending') {
    await waitForSSMReady();
    return;
  }

  throw new Error(`EC2 instance in unexpected state: ${instanceState}`);
}

async function waitForSSMReady(maxWaitSeconds = 120): Promise<void> {
  const startTime = Date.now();
  console.log('Waiting for SSM agent readiness...');

  while (Date.now() - startTime < maxWaitSeconds * 1000) {
    try {
      // Try a simple SSM ping to verify agent is connected
      const status = await ec2.send(new DescribeInstanceStatusCommand({
        InstanceIds: [QA_INSTANCE_ID],
        IncludeAllInstances: true,
      }));

      const instanceStatus = status.InstanceStatuses?.[0];
      if (
        instanceStatus?.InstanceState?.Name === 'running' &&
        instanceStatus?.InstanceStatus?.Status === 'ok' &&
        instanceStatus?.SystemStatus?.Status === 'ok'
      ) {
        console.log('EC2 instance is running and healthy');
        return;
      }
    } catch {
      // Ignore errors while waiting
    }

    await sleep(10000);
  }

  // Even if status checks haven't passed, SSM agent may already be ready
  // Proceed and let the SendCommand fail if it's truly not ready
  console.log('Proceeding despite status checks not fully passing (SSM may still work)');
}

async function pollCommandCompletion(
  commandId: string,
  instanceId: string,
  maxWaitSeconds = 600
): Promise<{ status: string; output: string }> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitSeconds * 1000) {
    await sleep(10000);

    try {
      const invocation = await ssm.send(new GetCommandInvocationCommand({
        CommandId: commandId,
        InstanceId: instanceId,
      }));

      const status = invocation.Status;
      console.log(`Command ${commandId} status: ${status}`);

      if (status === 'Success') {
        return {
          status: 'Success',
          output: invocation.StandardOutputContent || '',
        };
      }

      if (status === 'Failed' || status === 'Cancelled' || status === 'TimedOut') {
        const stderr = invocation.StandardErrorContent || '';
        const stdout = invocation.StandardOutputContent || '';
        console.error(`Command failed: ${stderr}`);
        return {
          status: status || 'Unknown',
          output: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
        };
      }

      // InProgress, Pending, Delayed - keep polling
    } catch (error: unknown) {
      // InvocationDoesNotExist is expected early on
      if ((error as { name?: string }).name === 'InvocationDoesNotExist') {
        continue;
      }
      throw error;
    }
  }

  return { status: 'TimedOut', output: 'Lambda polling timeout exceeded' };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
