import type { FableConfig } from './lib/fable-config';

const config: FableConfig = {
  stage: 'dev',
  region: 'us-west-2',

  // GitHub App credentials (stored in Secrets Manager, referenced by name)
  githubSecretName: 'fable/dev/github-app',

  // GitHub repo for tool deployment (org/repo format)
  toolsRepo: 'YourOrg/FABLE-TOOLS',

  // Optional overrides (defaults shown)
  // ecsMemoryMiB: 16384,
  // ecsCpuUnits: 4096,
  // maxBuildIterations: 3,
};

export default config;
