# FABLE Infrastructure

AWS CDK infrastructure for FABLE - defines all cloud resources as code.

## Prerequisites

- AWS CLI configured with credentials
- Node.js 20+
- CDK CLI: `npm install -g aws-cdk`

## Structure

```
packages/infra/
├── bin/infra.ts              # CDK app entry point
├── lib/fable-stack.ts        # All AWS resources
├── build/
│   ├── Dockerfile            # FABLE build container (Claude Code + Bedrock)
│   └── entrypoint.sh         # Container entrypoint script
├── lambda/
│   ├── chat/                 # Chat handler (Bedrock Sonnet + memory)
│   ├── router/               # Intent classification (Bedrock Haiku)
│   ├── connection-manager/   # WebSocket connect/disconnect
│   ├── memory/               # Memory CRUD (Aurora + Titan embeddings)
│   ├── db-init/              # Aurora schema initialization
│   ├── tool-deployer/        # Deploys FABLE-built tools as Lambdas
│   ├── build-kickoff/        # Starts build pipeline (Step Functions)
│   └── update-build-status/  # Updates build status in DynamoDB
├── cdk.json
└── package.json
```

## Resources Created

| Resource | Purpose |
|----------|---------|
| VPC | Network isolation for Aurora and ECS |
| Aurora Serverless v2 | PostgreSQL + pgvector for memories |
| DynamoDB Tables | Connections, conversations, builds, tools |
| S3 Bucket | Build artifacts storage |
| WebSocket API Gateway | Real-time client communication |
| Lambda Functions | Chat, router, memory, tool deployer, build management |
| ECR Repository | Docker images for FABLE build container |
| ECS Cluster (Fargate) | Runs autonomous builds with Claude Code |
| Step Functions | Orchestrates build pipeline (CORE → OI → Deploy) |
| IAM Roles | Execution roles for Lambdas, ECS tasks, deployed tools |

## Commands

```bash
# Install dependencies
npm install

# See what would be deployed/changed
npx cdk diff

# Deploy all infrastructure
npx cdk deploy

# Deploy without approval prompts
npx cdk deploy --require-approval never

# Destroy all infrastructure (CAREFUL!)
npx cdk destroy
```

## First-Time Setup

After initial deployment, initialize the Aurora database schema:

```bash
aws lambda invoke --function-name fable-dev-db-init /tmp/db-init.json
cat /tmp/db-init.json
```

## Environment

- **Region:** us-west-2
- **Stage:** dev (configurable via context)
- **Account:** Retrieved from AWS CLI credentials

## Outputs

After deployment, CDK outputs:

| Output | Description |
|--------|-------------|
| WebSocketUrl | `wss://xxx.execute-api.us-west-2.amazonaws.com/dev` |
| AuroraEndpoint | Database hostname |
| ArtifactsBucketName | S3 bucket for artifacts |
| ToolDeployerArn | Lambda ARN for deploying tools |
| ToolExecutionRoleArn | IAM role used by deployed tools |
| BuildRepositoryUri | ECR repository for build container |
| BuildClusterArn | ECS cluster for builds |
| BuildStateMachineArn | Step Functions state machine |
| BuildKickoffArn | Lambda to trigger builds |

## Deployed Tools

Tools built by FABLE are deployed dynamically via the Tool Deployer Lambda:

```bash
# Deploy a tool
aws lambda invoke --function-name fable-dev-tool-deployer \
  --cli-binary-format raw-in-base64-out \
  --payload '{
    "action": "deploy",
    "payload": {
      "toolName": "my-tool",
      "s3Key": "tools/my-tool.zip",
      "schema": {"name": "my-tool", "description": "..."}
    }
  }' /tmp/deploy.json

# Undeploy a tool
aws lambda invoke --function-name fable-dev-tool-deployer \
  --cli-binary-format raw-in-base64-out \
  --payload '{
    "action": "undeploy",
    "payload": {"toolName": "my-tool"}
  }' /tmp/undeploy.json
```

Deployed tools use IAM auth for Function URLs (more secure than public access).

## Build Pipeline

FABLE builds tools autonomously using Claude Code in ECS containers orchestrated by Step Functions.

### Architecture

```
User Request → Build Kickoff Lambda → Step Functions
                                           │
                                           ├─► CORE Task (ECS)
                                           │   └─► Decomposes request into specs
                                           │
                                           ├─► OI Task (ECS)
                                           │   └─► Orchestrates workers, builds code
                                           │
                                           └─► Deploy Task (Lambda)
                                               └─► Deploys tool via Tool Deployer
```

### Building the Container

Build from the FABLE repo root:

```bash
# Build the container
cd /path/to/FABLE
docker build -f packages/infra/build/Dockerfile -t fable-build .

# Tag and push to ECR (after CDK deploy)
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-west-2.amazonaws.com
docker tag fable-build:latest <ECR_URI>:latest
docker push <ECR_URI>:latest
```

### Starting a Build

```bash
# Trigger a build
aws lambda invoke --function-name fable-dev-build-kickoff \
  --cli-binary-format raw-in-base64-out \
  --payload '{
    "action": "start",
    "payload": {
      "request": "Build a calculator tool that can add and multiply numbers"
    }
  }' /tmp/build-kickoff.json

cat /tmp/build-kickoff.json
# Returns: {"success": true, "buildId": "xxx-xxx-xxx", "status": "pending"}
```

### Build Phases

| Phase | Container | Purpose |
|-------|-----------|---------|
| CORE | ECS (Claude Code) | Decomposes request into implementation specs |
| OI | ECS (Claude Code) | Manages workers, integrates results |
| Workers | Same container | Implement specific tasks (run by OI) |
| Deploy | Lambda | Deploys resulting tool |

### Environment Variables

The build container uses:

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_USE_BEDROCK` | `1` | Use Amazon Bedrock for Claude |
| `AWS_REGION` | `us-west-2` | AWS region |
| `CLAUDE_CODE_SKIP_OOBE` | `1` | Skip first-run setup |
| `FABLE_PHASE` | `core`/`oi`/`worker` | Current build phase |
| `FABLE_BUILD_SPEC` | JSON | Build specification |

## Cost Estimates (~$90/month base + build costs)

| Resource | Est. Monthly Cost |
|----------|------------------|
| NAT Gateway | ~$45 |
| Aurora Serverless v2 (0.5 ACU min) | ~$45 |
| Lambda | Pay per use (minimal) |
| DynamoDB | Pay per use (minimal) |
| S3 | Pay per use (minimal) |
| ECR | Pay per storage (minimal) |
| ECS Fargate | ~$0.04/vCPU-hour + ~$0.004/GB-hour |
| Step Functions | ~$0.025/1000 state transitions |
| Bedrock (Claude) | Per-token pricing (varies by usage) |

**Build Cost Example:** A typical build using 1 vCPU + 2GB for 10 minutes costs ~$0.02 in compute (plus Bedrock tokens).

## Bundling Notes

- Lambdas using `pg` or AWS SDK v3 need **CommonJS** format (`OutputFormat.CJS`)
- ESM format causes "Dynamic require not supported" errors
- Chat/Router use ESM (no pg dependency)
- Memory/DbInit/ToolDeployer use CJS

## Troubleshooting

**CDK says "no changes" but code changed:**
- CDK caches based on asset hash
- Touch or modify the file to force rebuild
- Or delete `cdk.out/` directory

**Lambda Function URL returns 403:**
- Check if org policy requires IAM auth
- Use `awscurl` to test with IAM-signed requests
- Verify resource-based policy exists on Lambda

**Aurora connection fails:**
- Lambda must be in VPC with NAT Gateway
- Check security group allows port 5432
- Verify credentials in Secrets Manager
