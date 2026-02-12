/**
 * FABLE deployment configuration.
 *
 * Each deployment (dev, prod, customer) has its own fable.config.ts
 * at the repo root (gitignored). See fable.config.example.ts for the template.
 */
export interface FableConfig {
  /** Deployment stage (e.g., 'dev', 'prod', 'staging') */
  stage: string;

  /** AWS region */
  region: string;

  /** Secrets Manager secret name for GitHub App credentials */
  githubSecretName: string;

  /** GitHub repo for tool deployment (e.g., 'YourOrg/FABLE-TOOLS') */
  toolsRepo: string;

  /** ECS Fargate memory in MiB (default: 16384 = 16 GB) */
  ecsMemoryMiB?: number;

  /** ECS Fargate CPU units (default: 4096 = 4 vCPU) */
  ecsCpuUnits?: number;

  /** Max QA feedback loop iterations before marking build as failed (default: 3) */
  maxBuildIterations?: number;
}

/** Apply defaults to a partial config */
export function resolveConfig(config: FableConfig): Required<FableConfig> {
  return {
    stage: config.stage,
    region: config.region,
    githubSecretName: config.githubSecretName,
    toolsRepo: config.toolsRepo,
    ecsMemoryMiB: config.ecsMemoryMiB ?? 16384,
    ecsCpuUnits: config.ecsCpuUnits ?? 4096,
    maxBuildIterations: config.maxBuildIterations ?? 3,
  };
}
