import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

interface GetTaskOutputEvent {
  buildId: string;
  phase: 'core' | 'oi' | 'worker';
}

interface TaskOutput {
  success: boolean;
  spec?: unknown;
  toolName?: string;
  s3Key?: string;
  schema?: unknown;
  error?: string;
  [key: string]: unknown;
}

export async function handler(event: GetTaskOutputEvent): Promise<TaskOutput> {
  const { buildId, phase } = event;
  const bucket = process.env.ARTIFACTS_BUCKET;

  if (!bucket) {
    throw new Error('ARTIFACTS_BUCKET environment variable not set');
  }

  const key = `builds/${buildId}/${phase}-output.json`;

  console.log(`Retrieving task output from s3://${bucket}/${key}`);

  try {
    const response = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));

    const bodyString = await response.Body?.transformToString();
    if (!bodyString) {
      throw new Error('Empty response from S3');
    }

    const output: TaskOutput = JSON.parse(bodyString);
    console.log('Retrieved output:', JSON.stringify(output, null, 2));

    return output;
  } catch (error) {
    console.error('Failed to retrieve task output:', error);

    // If the object doesn't exist yet, it might be a timing issue
    if ((error as { name?: string }).name === 'NoSuchKey') {
      throw new Error(`Task output not found at s3://${bucket}/${key}. The ECS task may not have completed successfully.`);
    }

    throw error;
  }
}
