#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { FableStack } from '../lib/fable-stack';

const app = new cdk.App();

// Environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
};

// Stage from context or default to 'dev'
const stage = app.node.tryGetContext('stage') || 'dev';

new FableStack(app, `Fable-${stage}`, {
  env,
  stage,
  description: `FABLE infrastructure - ${stage} environment`,
  tags: {
    Project: 'FABLE',
    Stage: stage,
    ManagedBy: 'CDK',
  },
});
