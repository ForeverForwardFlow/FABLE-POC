import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

const ARTIFACTS_BUCKET = process.env.ARTIFACTS_BUCKET!;

interface EnrichInput {
  buildId: string;
  buildSpec: string;
  qaReport: {
    status: string;
    checks: Record<string, unknown>;
    issues: Array<{
      type: string;
      severity: string;
      message: string;
      suggestion?: string;
    }>;
    feedback: string;
  };
  iteration: number;
  previousAttempts?: Array<{
    iteration: number;
    qaReport: Record<string, unknown>;
  }>;
}

export const handler = async (event: EnrichInput): Promise<{
  statusCode: number;
  enrichedSpecKey: string;
  iteration: number;
}> => {
  const { buildId, buildSpec, qaReport, iteration, previousAttempts = [] } = event;
  console.log(`Enriching build spec: build=${buildId}, iteration=${iteration}`);

  // Parse the original build spec — may be JSON string, S3 key, or object
  let originalSpec: Record<string, unknown>;
  if (typeof buildSpec === 'string' && buildSpec.startsWith('s3://')) {
    // On iteration 2+, buildSpec is an S3 key to the previous enriched spec
    const s3Match = buildSpec.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (s3Match) {
      console.log(`Downloading previous enriched spec from ${buildSpec}`);
      const resp = await s3.send(new GetObjectCommand({
        Bucket: s3Match[1],
        Key: s3Match[2],
      }));
      originalSpec = JSON.parse(await resp.Body!.transformToString());
    } else {
      originalSpec = { request: buildSpec };
    }
  } else {
    try {
      originalSpec = typeof buildSpec === 'string' ? JSON.parse(buildSpec) : buildSpec;
    } catch {
      originalSpec = { request: buildSpec };
    }
  }

  // Extract must-fix items from QA issues (critical and high severity)
  const mustFix = qaReport.issues
    .filter(i => i.severity === 'critical' || i.severity === 'high')
    .map(i => i.suggestion || i.message);

  // Extract prioritized fixes (medium severity)
  const prioritizedFixes = qaReport.issues
    .filter(i => i.severity === 'medium')
    .map(i => i.suggestion || i.message);

  // Build enriched spec
  const enrichedSpec = {
    ...originalSpec,
    iteration: iteration + 1,
    previousAttempts: [
      ...previousAttempts,
      {
        iteration,
        qaReport: {
          status: qaReport.status,
          issues: qaReport.issues,
          feedback: qaReport.feedback,
        },
      },
    ],
    qaFeedback: {
      mustFix,
      prioritizedFixes,
      summary: qaReport.feedback,
      failedChecks: Object.entries(qaReport.checks || {})
        .filter(([, v]) => (v as { passed?: boolean })?.passed === false)
        .map(([k]) => k),
    },
  };

  // Write enriched spec to S3 (avoids 8KB env var limit)
  const enrichedSpecKey = `builds/${buildId}/enriched-spec-iter${iteration + 1}.json`;
  await s3.send(new PutObjectCommand({
    Bucket: ARTIFACTS_BUCKET,
    Key: enrichedSpecKey,
    Body: JSON.stringify(enrichedSpec),
    ContentType: 'application/json',
  }));

  console.log(`Enriched spec written to s3://${ARTIFACTS_BUCKET}/${enrichedSpecKey}`);

  return {
    statusCode: 200,
    enrichedSpecKey: `s3://${ARTIFACTS_BUCKET}/${enrichedSpecKey}`,
    iteration: iteration + 1,
  };
};
