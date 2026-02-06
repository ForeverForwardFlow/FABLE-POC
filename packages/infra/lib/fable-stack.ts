import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as path from 'path';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

export interface FableStackProps extends cdk.StackProps {
  stage: string;
}

export class FableStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly auroraCluster: rds.DatabaseCluster;
  public readonly connectionsTable: dynamodb.Table;
  public readonly conversationsTable: dynamodb.Table;
  public readonly buildsTable: dynamodb.Table;
  public readonly toolsTable: dynamodb.Table;
  public readonly artifactsBucket: s3.Bucket;
  public readonly webSocketApi: apigatewayv2.WebSocketApi;
  public readonly buildRepository: ecr.Repository;
  public readonly buildCluster: ecs.Cluster;
  public readonly buildStateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: FableStackProps) {
    super(scope, id, props);

    const { stage } = props;

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
      this, 'GitHubAppSecret', `fable/${stage}/github-app`
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
    // Lambda Functions
    // ============================================================

    // Shared Lambda environment variables
    const lambdaEnvironment = {
      STAGE: stage,
      CONNECTIONS_TABLE: this.connectionsTable.tableName,
      CONVERSATIONS_TABLE: this.conversationsTable.tableName,
      BUILDS_TABLE: this.buildsTable.tableName,
      TOOLS_TABLE: this.toolsTable.tableName,
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
      bundling: bundlingOptions,
    });

    // Grant permissions
    this.connectionsTable.grantReadWriteData(connectionManagerFn);
    this.connectionsTable.grantReadWriteData(routerFn);
    this.connectionsTable.grantReadWriteData(chatFn);
    this.conversationsTable.grantReadWriteData(routerFn);
    this.conversationsTable.grantReadWriteData(chatFn);
    this.toolsTable.grantReadData(chatFn); // Chat needs to discover tools
    dbCredentials.grantRead(chatFn);
    this.artifactsBucket.grantReadWrite(chatFn);

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

    // Grant Chat Lambda permission to invoke Memory Lambda
    memoryFn.grantInvoke(chatFn);
    chatFn.addEnvironment('MEMORY_LAMBDA_ARN', memoryFn.functionArn);

    // Memory Lambda Function URL (for MCP access from ECS containers)
    const memoryFnUrl = memoryFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // Security via VPC isolation
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
      },
    });

    new cdk.CfnOutput(this, 'MemoryLambdaUrl', {
      value: memoryFnUrl.url,
      description: 'Memory Lambda Function URL for MCP',
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

    // Grant Tool Deployer access to tools table and artifacts bucket
    this.toolsTable.grantReadWriteData(toolDeployerFn);
    this.artifactsBucket.grantRead(toolDeployerFn);

    // Grant FABLE Lambdas permission to invoke deployed tools via Function URL
    const invokeToolsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunctionUrl'],
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
        STAGE: stage,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    // MCP Gateway needs to read tools from DynamoDB
    this.toolsTable.grantReadData(mcpGatewayFn);

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
            'token.actions.githubusercontent.com:sub': 'repo:ForeverForwardFlow/FABLE-TOOLS:*',
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

    // MCP Gateway needs to invoke tool Lambdas directly
    mcpGatewayFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:fable-${stage}-tool-*`],
    }));

    // Function URL for MCP Gateway (AWS_IAM auth for security)
    const mcpGatewayUrl = mcpGatewayFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['content-type', 'authorization'],
      },
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

    // CloudWatch Logs permissions
    buildTaskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: ['*'],
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
      cpu: 2048,  // 2 vCPU
      memoryLimitMiB: 8192,  // 8 GB - Claude Code OI needs significant memory
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
        MEMORY_LAMBDA_URL: memoryFnUrl.url,
      },
    });

    // Grant build task access to GitHub credentials
    githubSecret.grantRead(buildTaskRole);

    // Build Kickoff Lambda (starts Step Functions execution)
    const buildKickoffFn = new lambdaNodejs.NodejsFunction(this, 'BuildKickoffFn', {
      functionName: `fable-${stage}-build-kickoff`,
      entry: path.join(__dirname, '../lambda/build-kickoff/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        STAGE: stage,
        BUILDS_TABLE: this.buildsTable.tableName,
        // STATE_MACHINE_ARN will be added after state machine is created
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    this.buildsTable.grantReadWriteData(buildKickoffFn);

    // Lambda to retrieve task output from S3
    const getTaskOutputFn = new lambdaNodejs.NodejsFunction(this, 'GetTaskOutputFn', {
      functionName: `fable-${stage}-get-task-output`,
      entry: path.join(__dirname, '../lambda/get-task-output/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        ARTIFACTS_BUCKET: this.artifactsBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    this.artifactsBucket.grantRead(getTaskOutputFn);

    // Step Functions State Machine for Build Orchestration
    // CORE phase: One-shot decomposition
    const coreTask = new tasks.EcsRunTask(this, 'CoreTask', {
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      cluster: this.buildCluster,
      taskDefinition: buildTaskDefinition,
      launchTarget: new tasks.EcsFargateLaunchTarget({
        platformVersion: ecs.FargatePlatformVersion.LATEST,
      }),
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      containerOverrides: [{
        containerDefinition: buildContainer,
        environment: [
          { name: 'FABLE_PHASE', value: 'core' },
          { name: 'FABLE_BUILD_SPEC', value: sfn.JsonPath.stringAt('$.buildSpec') },
          { name: 'FABLE_BUILD_ID', value: sfn.JsonPath.stringAt('$.buildId') },
        ],
      }],
      resultPath: '$.coreTaskResult',
    });

    // Retrieve CORE output from S3 - pass entire output to OI
    const getCoreOutputTask = new tasks.LambdaInvoke(this, 'GetCoreOutputTask', {
      lambdaFunction: getTaskOutputFn,
      payload: sfn.TaskInput.fromObject({
        buildId: sfn.JsonPath.stringAt('$.buildId'),
        phase: 'core',
      }),
      resultSelector: {
        'output.$': '$.Payload',
      },
      resultPath: '$.coreOutput',
    });

    // OI phase: Orchestration + Workers (single container)
    // Pass the full CORE output as a JSON string
    const oiTask = new tasks.EcsRunTask(this, 'OiTask', {
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      cluster: this.buildCluster,
      taskDefinition: buildTaskDefinition,
      launchTarget: new tasks.EcsFargateLaunchTarget({
        platformVersion: ecs.FargatePlatformVersion.LATEST,
      }),
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      containerOverrides: [{
        containerDefinition: buildContainer,
        environment: [
          { name: 'FABLE_PHASE', value: 'oi' },
          { name: 'FABLE_BUILD_SPEC', value: sfn.JsonPath.jsonToString(sfn.JsonPath.objectAt('$.coreOutput.output')) },
          { name: 'FABLE_BUILD_ID', value: sfn.JsonPath.stringAt('$.buildId') },
        ],
      }],
      resultPath: '$.oiTaskResult',
    });

    // Retrieve OI output from S3 - pass entire output
    const getOiOutputTask = new tasks.LambdaInvoke(this, 'GetOiOutputTask', {
      lambdaFunction: getTaskOutputFn,
      payload: sfn.TaskInput.fromObject({
        buildId: sfn.JsonPath.stringAt('$.buildId'),
        phase: 'oi',
      }),
      resultSelector: {
        'output.$': '$.Payload',
      },
      resultPath: '$.oiOutput',
    });

    // Deploy phase: Invoke Tool Deployer Lambda
    // For PoC: uses tool_specification from OI output
    const deployTask = new tasks.LambdaInvoke(this, 'DeployTask', {
      lambdaFunction: toolDeployerFn,
      payload: sfn.TaskInput.fromObject({
        action: 'deploy',
        payload: {
          buildId: sfn.JsonPath.stringAt('$.buildId'),
          oiOutput: sfn.JsonPath.objectAt('$.oiOutput.output'),
          orgId: sfn.JsonPath.stringAt('$.orgId'),
          userId: sfn.JsonPath.stringAt('$.userId'),
        },
      }),
      resultPath: '$.deployResult',
    });

    // Update build status Lambda
    const updateBuildStatusFn = new lambdaNodejs.NodejsFunction(this, 'UpdateBuildStatusFn', {
      functionName: `fable-${stage}-update-build-status`,
      entry: path.join(__dirname, '../lambda/update-build-status/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        BUILDS_TABLE: this.buildsTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });
    this.buildsTable.grantReadWriteData(updateBuildStatusFn);

    // Success handler - include deploy result
    const markSuccessTask = new tasks.LambdaInvoke(this, 'MarkSuccessTask', {
      lambdaFunction: updateBuildStatusFn,
      payload: sfn.TaskInput.fromObject({
        buildId: sfn.JsonPath.stringAt('$.buildId'),
        status: 'completed',
        result: sfn.JsonPath.objectAt('$.deployResult.Payload'),
      }),
    });

    // Failure handler
    const markFailureTask = new tasks.LambdaInvoke(this, 'MarkFailureTask', {
      lambdaFunction: updateBuildStatusFn,
      payload: sfn.TaskInput.fromObject({
        buildId: sfn.JsonPath.stringAt('$.buildId'),
        status: 'failed',
        error: sfn.JsonPath.stringAt('$.error'),
      }),
    });

    // Build the state machine definition
    // Flow: CoreTask -> GetCoreOutput -> OiTask -> GetOiOutput -> Deploy -> MarkSuccess
    const definition = coreTask
      .addCatch(markFailureTask, { resultPath: '$.error' })
      .next(getCoreOutputTask.addCatch(markFailureTask, { resultPath: '$.error' }))
      .next(oiTask.addCatch(markFailureTask, { resultPath: '$.error' }))
      .next(getOiOutputTask.addCatch(markFailureTask, { resultPath: '$.error' }))
      .next(deployTask.addCatch(markFailureTask, { resultPath: '$.error' }))
      .next(markSuccessTask);

    this.buildStateMachine = new sfn.StateMachine(this, 'BuildStateMachine', {
      stateMachineName: `fable-${stage}-build-pipeline`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.hours(2),
      logs: {
        destination: new logs.LogGroup(this, 'BuildStateMachineLogGroup', {
          logGroupName: `/aws/stepfunctions/fable-${stage}-build-pipeline`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ALL,
      },
    });

    // Grant Build Kickoff permission to start executions
    this.buildStateMachine.grantStartExecution(buildKickoffFn);
    buildKickoffFn.addEnvironment('STATE_MACHINE_ARN', this.buildStateMachine.stateMachineArn);

    // ============================================================
    // WebSocket API Gateway
    // ============================================================
    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'FableWebSocketApi', {
      apiName: `fable-${stage}-websocket`,
      description: 'FABLE WebSocket API for real-time communication',
      connectRouteOptions: {
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

    // Add WebSocket API endpoint to Lambda environment
    const wsEndpoint = `${this.webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com/${stage}`;

    connectionManagerFn.addEnvironment('WEBSOCKET_ENDPOINT', wsEndpoint);
    routerFn.addEnvironment('WEBSOCKET_ENDPOINT', wsEndpoint);
    chatFn.addEnvironment('WEBSOCKET_ENDPOINT', wsEndpoint);

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

    new cdk.CfnOutput(this, 'BuildStateMachineArn', {
      value: this.buildStateMachine.stateMachineArn,
      description: 'Step Functions state machine for build orchestration',
      exportName: `fable-${stage}-build-state-machine-arn`,
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
  }
}
