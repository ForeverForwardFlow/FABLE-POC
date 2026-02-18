import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2_authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { FableConfig } from './fable-config';

export interface FableStackProps extends cdk.StackProps {
  stage: string;
  config: Required<FableConfig>;
}

export class FableStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly auroraCluster: rds.DatabaseCluster;
  public readonly connectionsTable: dynamodb.Table;
  public readonly conversationsTable: dynamodb.Table;
  public readonly buildsTable: dynamodb.Table;
  public readonly toolsTable: dynamodb.Table;
  public readonly workflowsTable: dynamodb.Table;
  public readonly artifactsBucket: s3.Bucket;
  public readonly webSocketApi: apigatewayv2.WebSocketApi;
  public readonly buildRepository: ecr.Repository;
  public readonly buildCluster: ecs.Cluster;


  constructor(scope: Construct, id: string, props: FableStackProps) {
    super(scope, id, props);

    const { stage, config } = props;

    // ============================================================
    // VPC for Aurora
    // ============================================================
    this.vpc = new ec2.Vpc(this, 'FableVpc', {
      maxAzs: 2,
      natGateways: stage === 'prod' ? 2 : 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // ============================================================
    // Aurora Serverless v2 (PostgreSQL with pgvector)
    // ============================================================
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'AuroraSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Aurora Serverless',
      allowAllOutbound: true,
    });

    // Allow Lambda access (from private subnets)
    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from VPC'
    );

    const dbCredentials = new secretsmanager.Secret(this, 'AuroraCredentials', {
      secretName: `fable/${stage}/aurora-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'fable_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // GitHub App credentials for FABLE build system (source control)
    const githubSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'GitHubAppSecret', config.githubSecretName
    );

    this.auroraCluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      credentials: rds.Credentials.fromSecret(dbCredentials),
      defaultDatabaseName: 'fable',
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: stage === 'prod' ? 16 : 4,
      writer: rds.ClusterInstance.serverlessV2('writer', {
        publiclyAccessible: false,
      }),
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      storageEncrypted: true,
      deletionProtection: stage === 'prod',
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ============================================================
    // DynamoDB Tables
    // ============================================================

    // Connections table (WebSocket connections)
    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: `fable-${stage}-connections`,
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI for finding connections by userId
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });

    // Conversations table
    this.conversationsTable = new dynamodb.Table(this, 'ConversationsTable', {
      tableName: `fable-${stage}-conversations`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Builds table
    this.buildsTable = new dynamodb.Table(this, 'BuildsTable', {
      tableName: `fable-${stage}-builds`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI for builds by user
    this.buildsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // GSI for builds by buildId (used by build-completion to find records without knowing orgId)
    this.buildsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2-buildId',
      partitionKey: { name: 'buildId', type: dynamodb.AttributeType.STRING },
    });

    // Tools table
    this.toolsTable = new dynamodb.Table(this, 'ToolsTable', {
      tableName: `fable-${stage}-tools`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI for tools by org
    this.toolsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // Workflows table (workflow definitions + execution records)
    this.workflowsTable = new dynamodb.Table(this, 'WorkflowsTable', {
      tableName: `fable-${stage}-workflows`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI for querying workflows/executions by user or org
    this.workflowsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // ============================================================
    // S3 Bucket for artifacts
    // ============================================================
    this.artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      bucketName: `fable-artifacts-${stage}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          id: 'cleanup-old-versions',
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
        {
          id: 'cleanup-incomplete-uploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: stage !== 'prod',
    });

    // ============================================================
    // Frontend Hosting (S3 + CloudFront)
    // ============================================================

    // S3 bucket for frontend static assets
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `fable-ui-${stage}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: stage !== 'prod',
    });

    // CloudFront Origin Access Identity
    const frontendOai = new cloudfront.OriginAccessIdentity(this, 'FrontendOAI', {
      comment: `OAI for FABLE UI ${stage}`,
    });

    frontendBucket.grantRead(frontendOai);

    // CloudFront distribution for frontend
    const frontendDistribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket, {
          originAccessIdentity: frontendOai,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',  // SPA routing
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',  // SPA routing
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: `FABLE UI ${stage}`,
    });

    // ============================================================
    // Cognito User Pool (Authentication)
    // ============================================================

    const userPool = new cognito.UserPool(this, 'FableUserPool', {
      userPoolName: `fable-${stage}-users`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      customAttributes: {
        orgId: new cognito.StringAttribute({ mutable: true }),
        orgRole: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Cognito Domain (for hosted login UI)
    userPool.addDomain('FableCognitoDomain', {
      cognitoDomain: {
        domainPrefix: config.cognitoDomainPrefix,
      },
    });

    // User Pool Client (SPA — no secret)
    const userPoolClient = userPool.addClient('FableWebClient', {
      userPoolClientName: `fable-${stage}-web`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        adminUserPassword: true, // For CLI/testing (disable in prod)
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [
          `https://${frontendDistribution.distributionDomainName}/auth/callback`,
          ...(stage !== 'prod' ? ['http://localhost:5173/auth/callback'] : []),
        ],
        logoutUrls: [
          `https://${frontendDistribution.distributionDomainName}`,
          ...(stage !== 'prod' ? ['http://localhost:5173'] : []),
        ],
      },
    });

    // ============================================================
    // Lambda Functions
    // ============================================================

    // Shared Lambda environment variables
    const lambdaEnvironment = {
      STAGE: stage,
      CONNECTIONS_TABLE: this.connectionsTable.tableName,
      CONVERSATIONS_TABLE: this.conversationsTable.tableName,
      BUILDS_TABLE: this.buildsTable.tableName,
      TOOLS_TABLE: this.toolsTable.tableName,
      WORKFLOWS_TABLE: this.workflowsTable.tableName,
      ARTIFACTS_BUCKET: this.artifactsBucket.bucketName,
      AURORA_SECRET_ARN: dbCredentials.secretArn,
      AURORA_CLUSTER_ARN: this.auroraCluster.clusterArn,
      AURORA_ENDPOINT: this.auroraCluster.clusterEndpoint.hostname,
      AURORA_DATABASE: 'fable',
    };

    // Lambda security group (for Aurora access)
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    // Bundling options for esbuild
    const bundlingOptions: lambdaNodejs.BundlingOptions = {
      minify: true,
      sourceMap: true,
      target: 'node20',
      format: lambdaNodejs.OutputFormat.ESM,
      mainFields: ['module', 'main'],
      esbuildArgs: {
        '--tree-shaking': 'true',
      },
    };

    // Connection Manager Lambda
    const connectionManagerFn = new lambdaNodejs.NodejsFunction(this, 'ConnectionManagerFn', {
      functionName: `fable-${stage}-connection-manager`,
      entry: path.join(__dirname, '../lambda/connection-manager/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    // Router Lambda
    const routerFn = new lambdaNodejs.NodejsFunction(this, 'RouterFn', {
      functionName: `fable-${stage}-router`,
      entry: path.join(__dirname, '../lambda/router/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    // Chat Lambda (needs VPC for Aurora, Bedrock access)
    // Uses CJS format for better AWS SDK v3 compatibility with @smithy packages
    const chatFn = new lambdaNodejs.NodejsFunction(this, 'ChatFn', {
      functionName: `fable-${stage}-chat`,
      entry: path.join(__dirname, '../lambda/chat/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.CJS,
        // Force bundle these packages - they're not in Lambda runtime
        nodeModules: ['@smithy/signature-v4', '@aws-crypto/sha256-js'],
      },
    });

    // Workflow Executor Lambda (headless Bedrock tool-use loop for scheduled/manual workflows)
    const workflowExecutorFn = new lambdaNodejs.NodejsFunction(this, 'WorkflowExecutorFn', {
      functionName: `fable-${stage}-workflow-executor`,
      entry: path.join(__dirname, '../lambda/workflow-executor/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: lambdaEnvironment,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.CJS,
        nodeModules: ['@smithy/signature-v4', '@aws-crypto/sha256-js'],
      },
    });

    // IAM Role for EventBridge Scheduler to invoke workflow-executor
    const schedulerRole = new iam.Role(this, 'WorkflowSchedulerRole', {
      roleName: `fable-${stage}-workflow-scheduler-role`,
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Role for EventBridge Scheduler to invoke workflow-executor Lambda',
    });
    workflowExecutorFn.grantInvoke(schedulerRole);

    // Grant permissions
    this.connectionsTable.grantReadWriteData(connectionManagerFn);
    this.connectionsTable.grantReadWriteData(routerFn);
    this.connectionsTable.grantReadWriteData(chatFn);
    this.conversationsTable.grantReadWriteData(routerFn);
    this.conversationsTable.grantReadWriteData(chatFn);
    this.toolsTable.grantReadData(chatFn); // Chat needs to discover tools
    this.workflowsTable.grantReadWriteData(chatFn); // Chat manages workflows
    dbCredentials.grantRead(chatFn);
    this.artifactsBucket.grantReadWrite(chatFn);

    // Workflow executor permissions
    this.workflowsTable.grantReadWriteData(workflowExecutorFn);
    this.toolsTable.grantReadData(workflowExecutorFn); // Discover tools
    this.connectionsTable.grantReadData(workflowExecutorFn); // WebSocket notifications
    dbCredentials.grantRead(workflowExecutorFn);

    // Bedrock permissions for Workflow Executor
    workflowExecutorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: ['*'],
    }));

    // Workflow executor needs to invoke deployed tools via Function URL
    workflowExecutorFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunctionUrl'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:fable-${stage}-tool-*`],
    }));

    // Chat Lambda can invoke workflow-executor (for manual runs)
    workflowExecutorFn.grantInvoke(chatFn);
    chatFn.addEnvironment('WORKFLOW_EXECUTOR_ARN', workflowExecutorFn.functionArn);

    // Chat Lambda manages EventBridge schedules for cron workflows
    chatFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:UpdateSchedule',
        'scheduler:DeleteSchedule',
        'scheduler:GetSchedule',
      ],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/default/fable-${stage}-wf-*`],
    }));

    // Chat Lambda passes scheduler role when creating schedules
    chatFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [schedulerRole.roleArn],
    }));
    chatFn.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);

    // Router needs to invoke Chat Lambda
    chatFn.grantInvoke(routerFn);

    // Bedrock permissions for Router Lambda (intent classification)
    routerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    // Bedrock permissions for Chat Lambda
    chatFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: ['*'], // Bedrock doesn't support resource-level permissions
    }));

    // DB Init Lambda (for schema initialization)
    const dbInitFn = new lambdaNodejs.NodejsFunction(this, 'DbInitFn', {
      functionName: `fable-${stage}-db-init`,
      entry: path.join(__dirname, '../lambda/db-init/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        AURORA_SECRET_ARN: dbCredentials.secretArn,
        AURORA_ENDPOINT: this.auroraCluster.clusterEndpoint.hostname,
        AURORA_DATABASE: 'fable',
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.CJS, // Use CommonJS for pg compatibility
        externalModules: ['pg-native'],
      },
    });

    dbCredentials.grantRead(dbInitFn);

    // Memory Lambda (CRUD operations with embeddings)
    const memoryFn = new lambdaNodejs.NodejsFunction(this, 'MemoryFn', {
      functionName: `fable-${stage}-memory`,
      entry: path.join(__dirname, '../lambda/memory/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        AURORA_SECRET_ARN: dbCredentials.secretArn,
        AURORA_ENDPOINT: this.auroraCluster.clusterEndpoint.hostname,
        AURORA_DATABASE: 'fable',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.CJS,
        externalModules: ['pg-native'],
      },
    });

    dbCredentials.grantRead(memoryFn);

    // Bedrock permissions for Memory Lambda (embeddings)
    memoryFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    // Grant Chat Lambda and Router Lambda permission to invoke Memory Lambda
    memoryFn.grantInvoke(chatFn);
    chatFn.addEnvironment('MEMORY_LAMBDA_ARN', memoryFn.functionArn);
    memoryFn.grantInvoke(routerFn);
    routerFn.addEnvironment('MEMORY_LAMBDA_ARN', memoryFn.functionArn);

    // Memory Lambda Function URL (for MCP access from ECS containers)
    const memoryFnUrl = memoryFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    new cdk.CfnOutput(this, 'MemoryLambdaUrl', {
      value: memoryFnUrl.url,
      description: 'Memory Lambda Function URL for MCP',
    });

    // Weekly memory decay schedule
    new events.Rule(this, 'MemoryDecayRule', {
      ruleName: `fable-${stage}-memory-decay`,
      description: 'Run memory decay weekly to reduce importance of stale memories',
      schedule: events.Schedule.rate(cdk.Duration.days(7)),
      targets: [
        new eventsTargets.LambdaFunction(memoryFn, {
          event: events.RuleTargetInput.fromObject({
            action: 'decay',
            payload: {},
          }),
        }),
      ],
    });

    // ============================================================
    // Tool Deployment Infrastructure
    // ============================================================

    // Shared IAM role for FABLE-deployed tool Lambdas
    const toolExecutionRole = new iam.Role(this, 'ToolExecutionRole', {
      roleName: `fable-${stage}-tool-execution-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Shared execution role for FABLE-deployed tool Lambdas',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Tools can read from artifacts bucket (for resources they might need)
    this.artifactsBucket.grantRead(toolExecutionRole);

    // Tools can invoke Memory Lambda (for context)
    memoryFn.grantInvoke(toolExecutionRole);

    // Tool Deployer Lambda (uses CJS for AWS SDK compatibility)
    const toolDeployerFn = new lambdaNodejs.NodejsFunction(this, 'ToolDeployerFn', {
      functionName: `fable-${stage}-tool-deployer`,
      entry: path.join(__dirname, '../lambda/tool-deployer/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        STAGE: stage,
        TOOLS_TABLE: this.toolsTable.tableName,
        ARTIFACTS_BUCKET: this.artifactsBucket.bucketName,
        TOOL_ROLE_ARN: toolExecutionRole.roleArn,
        GITHUB_SECRET_ARN: githubSecret.secretArn,
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.CJS,
      },
    });

    // Grant Tool Deployer permissions to manage Lambdas
    toolDeployerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:CreateFunction',
        'lambda:UpdateFunctionCode',
        'lambda:UpdateFunctionConfiguration',
        'lambda:DeleteFunction',
        'lambda:GetFunction',
        'lambda:CreateFunctionUrlConfig',
        'lambda:DeleteFunctionUrlConfig',
        'lambda:GetFunctionUrlConfig',
        'lambda:AddPermission',
        'lambda:RemovePermission',
        'lambda:TagResource',
      ],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:fable-${stage}-tool-*`],
    }));

    // Grant Tool Deployer permission to pass the tool execution role
    toolDeployerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [toolExecutionRole.roleArn],
    }));

    // Grant Tool Deployer access to tools table, artifacts bucket, and GitHub secret
    this.toolsTable.grantReadWriteData(toolDeployerFn);
    this.artifactsBucket.grantRead(toolDeployerFn);
    githubSecret.grantRead(toolDeployerFn);

    // Grant FABLE Lambdas permission to invoke deployed tools (direct SDK + Function URL)
    const invokeToolsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction', 'lambda:InvokeFunctionUrl'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:fable-${stage}-tool-*`],
    });
    chatFn.addToRolePolicy(invokeToolsPolicy);
    routerFn.addToRolePolicy(invokeToolsPolicy);

    // ============================================================
    // MCP Gateway Lambda (for Claude Code to access FABLE tools)
    // ============================================================
    // This gateway enables build processes (FABLE-OI) to dynamically
    // discover and use tools without restarting. It proxies MCP
    // requests to the appropriate tool Function URLs.

    const mcpGatewayFn = new lambdaNodejs.NodejsFunction(this, 'McpGatewayFn', {
      functionName: `fable-${stage}-mcp-gateway`,
      entry: path.join(__dirname, '../lambda/mcp-gateway/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        TOOLS_TABLE: this.toolsTable.tableName,
        WORKFLOWS_TABLE: this.workflowsTable.tableName,
        WORKFLOW_EXECUTOR_ARN: workflowExecutorFn.functionArn,
        STAGE: stage,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    // MCP Gateway needs to read and delete tools from DynamoDB
    this.toolsTable.grantReadWriteData(mcpGatewayFn);

    // MCP Gateway needs to read workflows and invoke workflow executor
    this.workflowsTable.grantReadWriteData(mcpGatewayFn);
    workflowExecutorFn.grantInvoke(mcpGatewayFn);

    // ============================================================
    // GitHub OIDC Provider and Deploy Role (for GitHub Actions CI/CD)
    // ============================================================
    const githubOidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const githubDeployRole = new iam.Role(this, 'GitHubDeployRole', {
      roleName: `fable-${stage}-github-deploy`,
      assumedBy: new iam.WebIdentityPrincipal(
        githubOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${config.toolsRepo}:*`,
          },
        }
      ),
    });

    // Grant GitHub Actions permissions to deploy tools
    this.artifactsBucket.grantReadWrite(githubDeployRole);
    toolDeployerFn.grantInvoke(githubDeployRole);

    // Grant GitHub Actions permissions to deploy frontend
    frontendBucket.grantReadWrite(githubDeployRole);
    githubDeployRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cloudfront:CreateInvalidation'],
      resources: [`arn:aws:cloudfront::${this.account}:distribution/${frontendDistribution.distributionId}`],
    }));

    // MCP Gateway needs to invoke and delete tool Lambdas
    mcpGatewayFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction', 'lambda:DeleteFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:fable-${stage}-tool-*`],
    }));

    // Function URL for MCP Gateway (AWS_IAM auth — used by ECS build tasks)
    const mcpGatewayUrl = mcpGatewayFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // ============================================================
    // Infra-Ops Lambda (FABLE self-introspection & self-modification)
    // ============================================================
    // Enables FABLE builders to read their own logs, inspect Lambda configs,
    // test-invoke functions, and update Lambda code — all sandboxed by
    // Permission Boundary to prevent modifying non-FABLE resources.

    // Permission Boundary: absolute ceiling for infra-ops role.
    // ALLOW defines maximum possible permissions. DENY narrows further.
    // The actual role policies (below) request a subset of what's allowed here.
    const infraOpsBoundary = new iam.ManagedPolicy(this, 'InfraOpsBoundary', {
      managedPolicyName: `fable-${stage}-infra-ops-boundary`,
      statements: [
        // ALLOW: The maximum set of actions infra-ops can ever have
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            // CloudWatch Logs (read)
            'logs:FilterLogEvents', 'logs:DescribeLogGroups', 'logs:DescribeLogStreams', 'logs:GetLogEvents',
            'logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents',
            // Lambda (read + invoke + update)
            'lambda:GetFunction', 'lambda:GetFunctionConfiguration',
            'lambda:InvokeFunction',
            'lambda:UpdateFunctionCode', 'lambda:UpdateFunctionConfiguration',
            // ECS (read)
            'ecs:ListTasks', 'ecs:DescribeTasks',
            // S3 (read/write artifacts bucket)
            's3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:GetBucketLocation',
            // DynamoDB (read/write for audit)
            'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:Scan',
            // XRay (Lambda runtime needs this)
            'xray:PutTraceSegments', 'xray:PutTelemetryRecords',
          ],
          resources: ['*'],
        }),
        // DENY: Modify protected functions (infra-ops itself, ws-authorizer, db-init)
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: ['lambda:UpdateFunctionCode', 'lambda:UpdateFunctionConfiguration', 'lambda:DeleteFunction'],
          resources: [
            `arn:aws:lambda:${this.region}:${this.account}:function:fable-${stage}-infra-ops`,
            `arn:aws:lambda:${this.region}:${this.account}:function:fable-${stage}-ws-authorizer`,
            `arn:aws:lambda:${this.region}:${this.account}:function:fable-${stage}-db-init`,
          ],
        }),
      ],
    });

    const infraOpsFn = new lambdaNodejs.NodejsFunction(this, 'InfraOpsFn', {
      functionName: `fable-${stage}-infra-ops`,
      entry: path.join(__dirname, '../lambda/infra-ops/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        STAGE: stage,
        ARTIFACTS_BUCKET: this.artifactsBucket.bucketName,
        BUILDS_TABLE: this.buildsTable.tableName,
        BUILD_CLUSTER_ARN: `arn:aws:ecs:${this.region}:${this.account}:cluster/fable-${stage}-builds`,
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.CJS,
        nodeModules: ['adm-zip'],
      },
    });

    // Apply Permission Boundary
    iam.PermissionsBoundary.of(infraOpsFn).apply(infraOpsBoundary);

    // CloudWatch Logs read (scoped to fable log groups)
    infraOpsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['logs:FilterLogEvents', 'logs:DescribeLogGroups', 'logs:DescribeLogStreams', 'logs:GetLogEvents'],
      resources: [
        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/fable-${stage}-*:*`,
        `arn:aws:logs:${this.region}:${this.account}:log-group:/ecs/fable-${stage}-*:*`,
      ],
    }));

    // Lambda read + invoke + update (scoped to fable functions)
    infraOpsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'lambda:GetFunction', 'lambda:GetFunctionConfiguration',
        'lambda:InvokeFunction',
        'lambda:UpdateFunctionCode', 'lambda:UpdateFunctionConfiguration',
      ],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:fable-${stage}-*`],
    }));

    // ECS describe (scoped to build cluster)
    infraOpsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:ListTasks', 'ecs:DescribeTasks'],
      resources: ['*'],
      conditions: {
        ArnEquals: {
          'ecs:cluster': `arn:aws:ecs:${this.region}:${this.account}:cluster/fable-${stage}-builds`,
        },
      },
    }));

    // S3 read/write (artifacts bucket)
    this.artifactsBucket.grantReadWrite(infraOpsFn);

    // DynamoDB: builds table read/write (for audit), tools table read
    this.buildsTable.grantReadWriteData(infraOpsFn);
    this.toolsTable.grantReadData(infraOpsFn);

    // Function URL with AWS_IAM auth (same pattern as Memory Lambda)
    const infraOpsUrl = infraOpsFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // ============================================================
    // WebSocket Authorizer Lambda
    // ============================================================

    const wsAuthorizerFn = new lambdaNodejs.NodejsFunction(this, 'WsAuthorizerFn', {
      functionName: `fable-${stage}-ws-authorizer`,
      entry: path.join(__dirname, '../lambda/ws-authorizer/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        CLIENT_ID: userPoolClient.userPoolClientId,
        ALLOW_ANONYMOUS: 'true', // Migration: allow unauthenticated connections
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    // ============================================================
    // HTTP API Gateway for MCP Gateway (browser access with JWT auth)
    // ============================================================

    const cognitoIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

    const mcpHttpApi = new apigatewayv2.HttpApi(this, 'McpHttpApi', {
      apiName: `fable-${stage}-mcp-api`,
      description: 'FABLE MCP Gateway API with Cognito JWT auth',
      corsPreflight: {
        allowOrigins: [
          `https://${frontendDistribution.distributionDomainName}`,
          ...(stage !== 'prod' ? ['http://localhost:5173'] : []),
        ],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['content-type', 'authorization'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // JWT authorizer validates Cognito ID tokens
    const mcpJwtAuthorizer = new apigatewayv2_authorizers.HttpJwtAuthorizer(
      'McpJwtAuthorizer',
      cognitoIssuer,
      {
        jwtAudience: [userPoolClient.userPoolClientId],
        identitySource: ['$request.header.Authorization'],
      },
    );

    // Route all requests to MCP Gateway Lambda
    const mcpIntegration = new apigatewayv2_integrations.HttpLambdaIntegration(
      'McpLambdaIntegration',
      mcpGatewayFn,
    );

    mcpHttpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      integration: mcpIntegration,
      authorizer: mcpJwtAuthorizer,
    });

    // Also add root path route
    mcpHttpApi.addRoutes({
      path: '/',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      integration: mcpIntegration,
      authorizer: mcpJwtAuthorizer,
    });

    // Public tools endpoints (no auth — tools listing + invocation)
    mcpHttpApi.addRoutes({
      path: '/tools',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: mcpIntegration,
    });
    mcpHttpApi.addRoutes({
      path: '/tools/call',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: mcpIntegration,
    });
    // Authenticated tool/workflow mutation endpoints (require JWT)
    mcpHttpApi.addRoutes({
      path: '/tools/delete',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: mcpIntegration,
      authorizer: mcpJwtAuthorizer,
    });

    // Public workflow listing (scoped to ORG#default in Lambda)
    mcpHttpApi.addRoutes({
      path: '/workflows',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: mcpIntegration,
    });
    // Authenticated workflow mutation endpoints (require JWT)
    mcpHttpApi.addRoutes({
      path: '/workflows/run',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: mcpIntegration,
      authorizer: mcpJwtAuthorizer,
    });
    mcpHttpApi.addRoutes({
      path: '/workflows/pause',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: mcpIntegration,
      authorizer: mcpJwtAuthorizer,
    });
    mcpHttpApi.addRoutes({
      path: '/workflows/delete',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: mcpIntegration,
      authorizer: mcpJwtAuthorizer,
    });

    // ============================================================
    // Build Pipeline Infrastructure (ECS + Step Functions)
    // ============================================================

    // ECR Repository for FABLE build container
    this.buildRepository = new ecr.Repository(this, 'BuildRepository', {
      repositoryName: `fable-${stage}-build`,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: stage !== 'prod',
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
        },
      ],
    });

    // ECS Cluster for running builds
    this.buildCluster = new ecs.Cluster(this, 'BuildCluster', {
      clusterName: `fable-${stage}-builds`,
      vpc: this.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // IAM Role for ECS Task (Claude Code + Bedrock)
    const buildTaskRole = new iam.Role(this, 'BuildTaskRole', {
      roleName: `fable-${stage}-build-task-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Role for FABLE build tasks running Claude Code',
    });

    // Bedrock permissions for Claude Code
    buildTaskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:ListInferenceProfiles',
      ],
      resources: ['*'],
    }));

    // S3 permissions (read/write build artifacts)
    this.artifactsBucket.grantReadWrite(buildTaskRole);

    // DynamoDB permissions (update build status)
    this.buildsTable.grantReadWriteData(buildTaskRole);
    this.toolsTable.grantReadData(buildTaskRole);

    // Permission to invoke Tool Deployer
    toolDeployerFn.grantInvoke(buildTaskRole);

    // Permission to invoke MCP Gateway (for dynamic tool access)
    mcpGatewayFn.grantInvokeUrl(buildTaskRole);

    // Permission to invoke Memory Lambda (direct SDK invoke for MCP sidecar)
    memoryFn.grantInvoke(buildTaskRole);

    // Permission to invoke Infra-Ops Lambda (direct SDK invoke for MCP sidecar)
    infraOpsFn.grantInvoke(buildTaskRole);

    // Frontend deployment permissions (S3 + CloudFront)
    frontendBucket.grantReadWrite(buildTaskRole);
    buildTaskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cloudfront:CreateInvalidation'],
      resources: [`arn:aws:cloudfront::${this.account}:distribution/${frontendDistribution.distributionId}`],
    }));

    // CloudWatch Logs permissions (scoped to fable build log groups)
    buildTaskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/ecs/fable-${stage}-*:*`],
    }));

    // ECS Task Execution Role (for pulling images, etc.)
    const buildTaskExecutionRole = new iam.Role(this, 'BuildTaskExecutionRole', {
      roleName: `fable-${stage}-build-execution-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Allow pulling from our ECR repository
    this.buildRepository.grantPull(buildTaskExecutionRole);

    // Build Task Definition (Fargate)
    const buildTaskDefinition = new ecs.FargateTaskDefinition(this, 'BuildTaskDefinition', {
      family: `fable-${stage}-build`,
      cpu: config.ecsCpuUnits,
      memoryLimitMiB: config.ecsMemoryMiB,
      taskRole: buildTaskRole,
      executionRole: buildTaskExecutionRole,
    });

    // Build Container
    const buildContainer = buildTaskDefinition.addContainer('BuildContainer', {
      containerName: 'fable-build',
      image: ecs.ContainerImage.fromEcrRepository(this.buildRepository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'fable-build',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        CLAUDE_CODE_USE_BEDROCK: '1',
        AWS_REGION: this.region,
        CLAUDE_CODE_SKIP_OOBE: '1',
        DISABLE_AUTOUPDATER: '1',
        STAGE: stage,
        ARTIFACTS_BUCKET: this.artifactsBucket.bucketName,
        BUILDS_TABLE: this.buildsTable.tableName,
        TOOL_DEPLOYER_ARN: toolDeployerFn.functionArn,
        MCP_GATEWAY_URL: mcpGatewayUrl.url,
        GITHUB_SECRET_ARN: githubSecret.secretArn,
        MEMORY_LAMBDA_NAME: memoryFn.functionName,
        INFRA_OPS_LAMBDA_NAME: infraOpsFn.functionName,
        FRONTEND_BUCKET: frontendBucket.bucketName,
        CLOUDFRONT_DISTRIBUTION_ID: frontendDistribution.distributionId,
        MAX_BUILDER_ITERATIONS: '3',
      },
    });

    // Grant build task access to GitHub credentials
    githubSecret.grantRead(buildTaskRole);

    // Security group for ECS build tasks (outbound-only, private subnet)
    const buildSecurityGroup = new ec2.SecurityGroup(this, 'BuildSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for FABLE ECS build tasks',
      allowAllOutbound: true,
    });

    // Build Kickoff Lambda (starts ECS builder task directly)
    const buildKickoffFn = new lambdaNodejs.NodejsFunction(this, 'BuildKickoffFn', {
      functionName: `fable-${stage}-build-kickoff`,
      entry: path.join(__dirname, '../lambda/build-kickoff/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        STAGE: stage,
        BUILDS_TABLE: this.buildsTable.tableName,
        BUILD_CLUSTER_ARN: this.buildCluster.clusterArn,
        BUILD_TASK_DEF: buildTaskDefinition.taskDefinitionArn,
        BUILD_SUBNETS: this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds.join(','),
        BUILD_SECURITY_GROUP: buildSecurityGroup.securityGroupId,
        MAX_CONCURRENT_BUILDS: '3',
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    this.buildsTable.grantReadWriteData(buildKickoffFn);
    buildKickoffFn.grantInvoke(routerFn); // Router triggers builds
    buildKickoffFn.grantInvoke(chatFn); // Chat triggers builds after requirement gathering
    chatFn.addEnvironment('BUILD_KICKOFF_ARN', buildKickoffFn.functionArn);

    // ECS RunTask permission for build-kickoff
    buildKickoffFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:RunTask'],
      resources: [buildTaskDefinition.taskDefinitionArn],
    }));
    // PassRole for task role + execution role (required by ECS RunTask)
    buildKickoffFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [buildTaskRole.roleArn, buildTaskExecutionRole.roleArn],
    }));

    // Build Completion Lambda (triggered by EventBridge when ECS task stops)
    const buildCompletionFn = new lambdaNodejs.NodejsFunction(this, 'BuildCompletionFn', {
      functionName: `fable-${stage}-build-completion`,
      entry: path.join(__dirname, '../lambda/build-completion/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        ARTIFACTS_BUCKET: this.artifactsBucket.bucketName,
        BUILDS_TABLE: this.buildsTable.tableName,
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
        TOOL_DEPLOYER_ARN: toolDeployerFn.functionArn,
        // WEBSOCKET_ENDPOINT added after WebSocket API is created below
        STAGE: stage,
      },
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.CJS,
        nodeModules: ['@smithy/signature-v4', '@aws-crypto/sha256-js'],
      },
    });

    // Completion Lambda permissions
    this.artifactsBucket.grantReadWrite(buildCompletionFn);
    this.buildsTable.grantReadWriteData(buildCompletionFn);
    this.connectionsTable.grantReadData(buildCompletionFn);
    this.workflowsTable.grantReadWriteData(buildCompletionFn); // workflow creation
    toolDeployerFn.grantInvoke(buildCompletionFn);
    buildKickoffFn.grantInvoke(buildCompletionFn); // outer retry loop
    buildCompletionFn.addToRolePolicy(invokeToolsPolicy); // post-deploy QA (Function URL)
    buildCompletionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:fable-${stage}-tool-*`],
    })); // post-deploy QA (direct SDK invoke)
    buildCompletionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    // EventBridge rule: ECS task stopped → completion Lambda
    new events.Rule(this, 'BuildTaskCompletionRule', {
      ruleName: `fable-${stage}-build-completion`,
      description: 'Triggers build completion when ECS builder task stops',
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: {
          clusterArn: [this.buildCluster.clusterArn],
          lastStatus: ['STOPPED'],
          startedBy: [{ prefix: 'fable-build:' }],
        },
      },
      targets: [new eventsTargets.LambdaFunction(buildCompletionFn)],
    });

    // ============================================================
    // CloudWatch Alarms & SNS Notifications
    // ============================================================
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `fable-${stage}-alarms`,
      displayName: `FABLE ${stage} Alarms`,
    });

    // Chat Lambda error alarm (>5 errors in 5 minutes)
    new cloudwatch.Alarm(this, 'ChatLambdaErrorAlarm', {
      alarmName: `fable-${stage}-chat-errors`,
      alarmDescription: 'Chat Lambda is producing errors',
      metric: chatFn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    // Router Lambda error alarm (>10 errors in 5 minutes)
    new cloudwatch.Alarm(this, 'RouterLambdaErrorAlarm', {
      alarmName: `fable-${stage}-router-errors`,
      alarmDescription: 'Router Lambda is producing errors',
      metric: routerFn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 10,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    // Build Completion Lambda error alarm (>3 errors in 15 minutes)
    new cloudwatch.Alarm(this, 'BuildCompletionErrorAlarm', {
      alarmName: `fable-${stage}-build-completion-errors`,
      alarmDescription: 'Build Completion Lambda is producing errors',
      metric: buildCompletionFn.metricErrors({ period: cdk.Duration.minutes(15) }),
      threshold: 3,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS topic ARN for CloudWatch alarms — subscribe your email to receive notifications',
    });

    // ============================================================
    // WebSocket API Gateway
    // ============================================================
    // WebSocket Lambda authorizer (validates JWT on $connect, anonymous fallback)
    const wsAuthorizer = new apigatewayv2_authorizers.WebSocketLambdaAuthorizer(
      'WsAuthorizer',
      wsAuthorizerFn,
      {
        // Empty identity source: authorizer is always called (supports anonymous fallback)
        // When auth is required, change to: ['route.request.querystring.token']
        identitySource: [],
      },
    );

    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'FableWebSocketApi', {
      apiName: `fable-${stage}-websocket`,
      description: 'FABLE WebSocket API for real-time communication',
      connectRouteOptions: {
        authorizer: wsAuthorizer,
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          connectionManagerFn
        ),
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
          'DisconnectIntegration',
          connectionManagerFn
        ),
      },
      defaultRouteOptions: {
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
          'DefaultIntegration',
          routerFn
        ),
      },
    });

    const webSocketStage = new apigatewayv2.WebSocketStage(this, 'FableWebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: stage,
      autoDeploy: true,
    });

    // Grant API Gateway permission to invoke Lambdas
    connectionManagerFn.addPermission('WebSocketConnect', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: this.webSocketApi.arnForExecuteApi('*', '/$connect', stage),
    });

    connectionManagerFn.addPermission('WebSocketDisconnect', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: this.webSocketApi.arnForExecuteApi('*', '/$disconnect', stage),
    });

    routerFn.addPermission('WebSocketDefault', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: this.webSocketApi.arnForExecuteApi('*', '/$default', stage),
    });

    // Grant Lambdas permission to post to WebSocket connections
    const webSocketManagePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/${stage}/POST/@connections/*`,
      ],
    });

    connectionManagerFn.addToRolePolicy(webSocketManagePolicy);
    routerFn.addToRolePolicy(webSocketManagePolicy);
    chatFn.addToRolePolicy(webSocketManagePolicy);
    workflowExecutorFn.addToRolePolicy(webSocketManagePolicy);
    buildCompletionFn.addToRolePolicy(webSocketManagePolicy);

    // Add WebSocket API endpoint to Lambda environment
    const wsEndpoint = `${this.webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com/${stage}`;

    connectionManagerFn.addEnvironment('WEBSOCKET_ENDPOINT', wsEndpoint);
    routerFn.addEnvironment('WEBSOCKET_ENDPOINT', wsEndpoint);
    chatFn.addEnvironment('WEBSOCKET_ENDPOINT', wsEndpoint);
    workflowExecutorFn.addEnvironment('WEBSOCKET_ENDPOINT', wsEndpoint);
    buildCompletionFn.addEnvironment('WEBSOCKET_ENDPOINT', wsEndpoint);
    buildCompletionFn.addEnvironment('BUILD_KICKOFF_ARN', buildKickoffFn.functionArn);
    buildCompletionFn.addEnvironment('MAX_BUILD_CYCLES', '5');
    buildCompletionFn.addEnvironment('WORKFLOWS_TABLE', this.workflowsTable.tableName);
    buildCompletionFn.addEnvironment('WORKFLOW_EXECUTOR_ARN', workflowExecutorFn.functionArn);
    buildCompletionFn.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);

    // Build-completion can create EventBridge schedules for cron workflows
    buildCompletionFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['scheduler:CreateSchedule'],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/default/fable-${stage}-wf-*`],
    }));
    buildCompletionFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [schedulerRole.roleArn],
    }));

    // ============================================================
    // Outputs
    // ============================================================
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: webSocketStage.url,
      description: 'WebSocket API URL',
      exportName: `fable-${stage}-websocket-url`,
    });

    new cdk.CfnOutput(this, 'AuroraEndpoint', {
      value: this.auroraCluster.clusterEndpoint.hostname,
      description: 'Aurora cluster endpoint',
      exportName: `fable-${stage}-aurora-endpoint`,
    });

    new cdk.CfnOutput(this, 'ArtifactsBucketName', {
      value: this.artifactsBucket.bucketName,
      description: 'S3 bucket for build artifacts',
      exportName: `fable-${stage}-artifacts-bucket`,
    });

    new cdk.CfnOutput(this, 'AuroraSecretArn', {
      value: dbCredentials.secretArn,
      description: 'Aurora credentials secret ARN',
      exportName: `fable-${stage}-aurora-secret-arn`,
    });

    new cdk.CfnOutput(this, 'ToolDeployerArn', {
      value: toolDeployerFn.functionArn,
      description: 'Tool Deployer Lambda ARN',
      exportName: `fable-${stage}-tool-deployer-arn`,
    });

    new cdk.CfnOutput(this, 'ToolExecutionRoleArn', {
      value: toolExecutionRole.roleArn,
      description: 'Shared IAM role for deployed tools',
      exportName: `fable-${stage}-tool-execution-role-arn`,
    });

    new cdk.CfnOutput(this, 'BuildRepositoryUri', {
      value: this.buildRepository.repositoryUri,
      description: 'ECR repository for FABLE build container',
      exportName: `fable-${stage}-build-repository-uri`,
    });

    new cdk.CfnOutput(this, 'BuildClusterArn', {
      value: this.buildCluster.clusterArn,
      description: 'ECS cluster for FABLE builds',
      exportName: `fable-${stage}-build-cluster-arn`,
    });

    new cdk.CfnOutput(this, 'BuildKickoffArn', {
      value: buildKickoffFn.functionArn,
      description: 'Lambda to trigger builds',
      exportName: `fable-${stage}-build-kickoff-arn`,
    });

    new cdk.CfnOutput(this, 'McpGatewayUrl', {
      value: mcpGatewayUrl.url,
      description: 'MCP Gateway URL for dynamic tool access',
      exportName: `fable-${stage}-mcp-gateway-url`,
    });

    new cdk.CfnOutput(this, 'GitHubDeployRoleArn', {
      value: githubDeployRole.roleArn,
      description: 'IAM role ARN for GitHub Actions to assume via OIDC',
      exportName: `fable-${stage}-github-deploy-role-arn`,
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'S3 bucket for FABLE UI static assets',
      exportName: `fable-${stage}-frontend-bucket`,
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: `https://${frontendDistribution.distributionDomainName}`,
      description: 'CloudFront URL for FABLE UI',
      exportName: `fable-${stage}-frontend-url`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: frontendDistribution.distributionId,
      description: 'CloudFront distribution ID for cache invalidation',
      exportName: `fable-${stage}-cloudfront-distribution-id`,
    });

    new cdk.CfnOutput(this, 'WorkflowExecutorArn', {
      value: workflowExecutorFn.functionArn,
      description: 'Workflow Executor Lambda ARN',
      exportName: `fable-${stage}-workflow-executor-arn`,
    });

    new cdk.CfnOutput(this, 'WorkflowsTableName', {
      value: this.workflowsTable.tableName,
      description: 'Workflows DynamoDB table name',
      exportName: `fable-${stage}-workflows-table`,
    });

    new cdk.CfnOutput(this, 'WorkflowSchedulerRoleArn', {
      value: schedulerRole.roleArn,
      description: 'IAM role for EventBridge Scheduler to invoke workflow-executor',
      exportName: `fable-${stage}-workflow-scheduler-role-arn`,
    });

    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `fable-${stage}-user-pool-id`,
    });

    new cdk.CfnOutput(this, 'CognitoClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `fable-${stage}-client-id`,
    });

    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `https://${config.cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`,
      description: 'Cognito hosted UI domain',
      exportName: `fable-${stage}-cognito-domain`,
    });

    new cdk.CfnOutput(this, 'McpApiUrl', {
      value: mcpHttpApi.apiEndpoint,
      description: 'MCP Gateway HTTP API URL (JWT-protected)',
      exportName: `fable-${stage}-mcp-api-url`,
    });
  }
}
