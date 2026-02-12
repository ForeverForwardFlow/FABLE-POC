#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { FableStack } from '../lib/fable-stack';
import config from '../fable.config';
import { resolveConfig } from '../lib/fable-config';

const resolvedConfig = resolveConfig(config);

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: resolvedConfig.region,
};

new FableStack(app, `Fable-${resolvedConfig.stage}`, {
  env,
  stage: resolvedConfig.stage,
  config: resolvedConfig,
  description: `FABLE infrastructure - ${resolvedConfig.stage} environment`,
  tags: {
    Project: 'FABLE',
    Stage: resolvedConfig.stage,
    ManagedBy: 'CDK',
  },
});
