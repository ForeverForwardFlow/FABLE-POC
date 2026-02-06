# FABLE AWS Infrastructure

> **Last Updated:** 2026-02-04
> **Environment:** dev
> **Region:** us-west-2
> **Account:** 767398133785
> **CDK Stack:** Fable-dev

This document records all AWS resources deployed for FABLE's proof of concept.

---

## Table of Contents

1. [Overview](#overview)
2. [Networking](#networking)
3. [Compute - ECS Fargate](#compute---ecs-fargate)
4. [Lambda Functions](#lambda-functions)
5. [Step Functions](#step-functions)
6. [Databases](#databases)
7. [Storage](#storage)
8. [API Gateway](#api-gateway)
9. [Secrets & IAM](#secrets--iam)
10. [Endpoints & URLs](#endpoints--urls)
11. [Build Container](#build-container)

---

## Overview

FABLE's AWS infrastructure supports the autonomous build pipeline where:
1. User requests a tool via chat
2. Build kickoff Lambda starts Step Functions execution
3. Step Functions orchestrates ECS tasks (CORE → OI phases)
4. ECS tasks run Claude Code CLI in Docker containers
5. Results stored in S3, status updated in DynamoDB

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FABLE AWS ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Client                                                                 │
│     │                                                                    │
│     ├──WebSocket──▶ API Gateway ──▶ Lambda (Router/Chat/Connection)     │
│     │                                                                    │
│     └──HTTP──────▶ MCP Gateway (Function URL) ──▶ Tool Lambdas          │
│                                                                          │
│   Build Pipeline                                                         │
│     │                                                                    │
│     └──▶ Step Functions ──▶ ECS Fargate (CORE/OI tasks)                 │
│              │                    │                                      │
│              │                    └──▶ S3 (artifacts/outputs)           │
│              │                                                           │
│              └──▶ Lambda (get-task-output, update-status)               │
│                                                                          │
│   Data Stores                                                            │
│     ├── Aurora Postgres (memories, users, orgs)                         │
│     ├── DynamoDB (builds, connections, conversations)                   │
│     └── S3 (artifacts, build outputs)                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Networking

### VPC

| Resource | ID | Notes |
|----------|-----|-------|
| VPC | `vpc-0273395bb46c8f714` | CIDR: 10.0.0.0/16 |
| Internet Gateway | `igw-0ae33acef2fb7e4d5` | For public subnets |
| NAT Gateway | `nat-0eb8a34adf2f20740` | For private subnet egress |
| Elastic IP | `35.89.221.192` | NAT Gateway EIP |

### Subnets

| Type | Subnet ID | AZ | Purpose |
|------|-----------|-----|---------|
| Public | `subnet-02bdee7be68376194` | us-west-2a | NAT Gateway, public resources |
| Public | `subnet-0e18bdab8af5b5f73` | us-west-2b | Redundancy |
| Private | `subnet-0b383fff4f3e86bba` | us-west-2a | ECS tasks, Lambda |
| Private | `subnet-0292629ffa8d68966` | us-west-2b | Redundancy |
| Isolated | `subnet-0aa54bac7c7169b19` | us-west-2a | Aurora (no internet) |
| Isolated | `subnet-05a348f0b2aef50fe` | us-west-2b | Aurora redundancy |

### Security Groups

| Name | ID | Purpose |
|------|-----|---------|
| Aurora SG | `sg-05526dbb7585d22bc` | Database access |
| Lambda SG | `sg-0a0d607d151bbaafc` | Lambda VPC access |
| ECS Task SG | `sg-0a5d4c7fab0143398` | Build container network |

---

## Compute - ECS Fargate

### ECS Cluster

| Resource | Value |
|----------|-------|
| Cluster Name | `fable-dev-builds` |
| Cluster ARN | `arn:aws:ecs:us-west-2:767398133785:cluster/fable-dev-builds` |
| Capacity Provider | FARGATE |

### Task Definition

| Resource | Value |
|----------|-------|
| Task Definition | `fable-dev-build:2` |
| CPU | 1024 (1 vCPU) |
| Memory | 2048 MB |
| Container Name | `fable-build` |
| Image | `767398133785.dkr.ecr.us-west-2.amazonaws.com/fable-dev-build:latest` |

### Container Configuration

```json
{
  "environment": [
    { "name": "CLAUDE_CODE_USE_BEDROCK", "value": "1" },
    { "name": "AWS_REGION", "value": "us-west-2" },
    { "name": "CLAUDE_CODE_SKIP_OOBE", "value": "1" },
    { "name": "DISABLE_AUTOUPDATER", "value": "1" }
  ],
  "overrides_from_step_functions": [
    "FABLE_PHASE",      // "core" or "oi"
    "FABLE_BUILD_SPEC", // JSON build specification
    "FABLE_BUILD_ID",   // Unique build identifier
    "ARTIFACTS_BUCKET"  // S3 bucket for outputs
  ]
}
```

### ECR Repository

| Resource | Value |
|----------|-------|
| Repository Name | `fable-dev-build` |
| Repository URI | `767398133785.dkr.ecr.us-west-2.amazonaws.com/fable-dev-build` |
| Current Tag | `latest` |

---

## Lambda Functions

### Core Lambdas

| Function | ARN | Purpose |
|----------|-----|---------|
| `fable-dev-build-kickoff` | `arn:aws:lambda:us-west-2:767398133785:function:fable-dev-build-kickoff` | Start build pipelines |
| `fable-dev-chat` | `arn:aws:lambda:us-west-2:767398133785:function:fable-dev-chat` | Conversational AI |
| `fable-dev-connection-manager` | `arn:aws:lambda:us-west-2:767398133785:function:fable-dev-connection-manager` | WebSocket lifecycle |
| `fable-dev-mcp-gateway` | `arn:aws:lambda:us-west-2:767398133785:function:fable-dev-mcp-gateway` | MCP protocol gateway |

### Support Lambdas

| Function | ARN | Purpose |
|----------|-----|---------|
| `fable-dev-get-task-output` | `arn:aws:lambda:us-west-2:767398133785:function:fable-dev-get-task-output` | Retrieve ECS output from S3 |
| `fable-dev-db-init` | `arn:aws:lambda:us-west-2:767398133785:function:fable-dev-db-init` | Aurora schema initialization |

### Lambda Configuration

All Lambdas use:
- Runtime: Node.js 20.x
- Architecture: arm64
- Log Retention: 1 week
- VPC: Lambda SG for DB access

---

## Step Functions

### State Machine

| Resource | Value |
|----------|-------|
| Name | `fable-dev-build-pipeline` |
| ARN | `arn:aws:states:us-west-2:767398133785:stateMachine:fable-dev-build-pipeline` |
| Type | Standard |
| Timeout | 1 hour |
| Log Group | `/aws/stepfunctions/fable-dev-build-pipeline` |

### State Machine Flow

```
┌─────────────┐
│  CoreTask   │  ECS Fargate task (CORE phase)
│  (runTask)  │  - Creates specifications
└──────┬──────┘  - Produces templates, knowledge graph
       │
       ▼
┌──────────────────┐
│ GetCoreOutputTask│  Lambda: get-task-output
│   (invoke)       │  - Reads output.json from S3
└──────┬───────────┘
       │
       ▼
┌─────────────┐
│   OiTask    │  ECS Fargate task (OI phase)
│  (runTask)  │  - Spawns workers
└──────┬──────┘  - Implements code, runs tests
       │
       ▼
┌──────────────────┐
│ GetOiOutputTask  │  Lambda: get-task-output
│   (invoke)       │  - Reads output.json from S3
└──────┬───────────┘
       │
       ▼
┌────────────────┐
│MarkSuccessTask │  Lambda: update-build-status
│   (invoke)     │  - Updates DynamoDB status
└────────────────┘
       │
    (catch)
       ▼
┌────────────────┐
│MarkFailureTask │  Lambda: update-build-status
│   (invoke)     │  - Records failure
└────────────────┘
```

### ECS-to-Step Functions Communication

ECS tasks communicate results via S3:
1. Container runs Claude Code CLI
2. Output written to `./output.json`
3. Entrypoint uploads to `s3://{bucket}/builds/{buildId}/{phase}-output.json`
4. GetTaskOutput Lambda retrieves and returns to Step Functions

---

## Databases

### Aurora Postgres Serverless v2

| Resource | Value |
|----------|-------|
| Cluster Identifier | `fable-dev-auroracluster23d869c0-nnntnq1kxlyj` |
| Endpoint | `fable-dev-auroracluster23d869c0-nnntnq1kxlyj.cluster-czywkg2aepqq.us-west-2.rds.amazonaws.com` |
| Port | 5432 |
| Database | `fable` |
| Engine | PostgreSQL 15.x with pgvector |
| Instance | `fable-dev-auroraclusterwriter499c523e-jct5hbs1xpvb` |
| Min ACU | 0.5 |
| Max ACU | 2 |

#### Schema (planned)

```sql
-- Memories table with pgvector embeddings
CREATE TABLE memories (
  id UUID PRIMARY KEY,
  type memory_type NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  user_id UUID,
  org_id UUID,
  scope memory_scope NOT NULL,
  importance DECIMAL(3,2),
  created_at TIMESTAMPTZ
);

-- Memory relations
CREATE TABLE memory_relations (
  from_memory_id UUID REFERENCES memories(id),
  to_memory_id UUID REFERENCES memories(id),
  relation_type VARCHAR(50)
);
```

### DynamoDB Tables

| Table | Partition Key | Sort Key | Purpose |
|-------|--------------|----------|---------|
| `fable-dev-builds` | `PK` (ORG#orgId) | `SK` (BUILD#buildId) | Build records |
| `fable-dev-connections` | `connectionId` | - | WebSocket connections |
| `fable-dev-conversations` | `PK` (USER#userId) | `SK` (CONV#convId) | Chat history |

#### Builds Table Schema

```typescript
interface Build {
  PK: string;              // ORG#<orgId>
  SK: string;              // BUILD#<buildId>
  buildId: string;
  request: string;
  spec: object;
  status: 'pending' | 'running' | 'completed' | 'failed';
  userId: string;
  orgId: string;
  conversationId?: string;
  result?: object;
  createdAt: string;
  updatedAt: string;
}
```

---

## Storage

### S3 Bucket

| Resource | Value |
|----------|-------|
| Bucket Name | `fable-artifacts-dev-767398133785` |
| Region | us-west-2 |
| Versioning | Disabled |
| Lifecycle | Auto-delete on stack removal (dev only) |

#### Bucket Structure

```
fable-artifacts-dev-767398133785/
├── builds/
│   └── {buildId}/
│       ├── core-output.json    # CORE phase output
│       ├── oi-output.json      # OI phase output
│       └── artifacts/          # Built code (future)
└── deployments/                # Deployed tools (future)
```

---

## API Gateway

### WebSocket API

| Resource | Value |
|----------|-------|
| API ID | `f9qynczzkj` |
| Stage | `dev` |
| Endpoint | `wss://f9qynczzkj.execute-api.us-west-2.amazonaws.com/dev` |

#### Routes

| Route | Integration | Lambda |
|-------|-------------|--------|
| `$connect` | Lambda | `fable-dev-connection-manager` |
| `$disconnect` | Lambda | `fable-dev-connection-manager` |
| `$default` | Lambda | `fable-dev-chat` |

### Lambda Function URL (MCP Gateway)

| Resource | Value |
|----------|-------|
| Function | `fable-dev-mcp-gateway` |
| URL | `https://zwbqvnkmw74c7h4ultiqx3ql6a0ccjci.lambda-url.us-west-2.on.aws/` |
| Auth | None (public) |
| CORS | Enabled |

---

## Secrets & IAM

### Secrets Manager

| Secret | ARN |
|--------|-----|
| Aurora Credentials | `arn:aws:secretsmanager:us-west-2:767398133785:secret:fable/dev/aurora-credentials-dRiMlA` |

### Key IAM Roles

| Role | Purpose |
|------|---------|
| `fable-dev-build-execution-role` | ECS task execution (pull images, write logs) |
| `fable-dev-build-task-role` | ECS task role (Bedrock, S3, DynamoDB) |
| `Fable-dev-BuildStateMachineRoleE3CEA89B-*` | Step Functions execution |
| Lambda service roles | Per-function roles with least privilege |

### ECS Task Role Permissions

The build task role has access to:
- **Bedrock**: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`
- **S3**: Read/write to artifacts bucket
- **DynamoDB**: Read/write to builds table
- **CloudWatch Logs**: Write logs

---

## Endpoints & URLs

### Production Endpoints

| Service | URL |
|---------|-----|
| WebSocket API | `wss://f9qynczzkj.execute-api.us-west-2.amazonaws.com/dev` |
| MCP Gateway | `https://zwbqvnkmw74c7h4ultiqx3ql6a0ccjci.lambda-url.us-west-2.on.aws/` |
| Aurora | `fable-dev-auroracluster23d869c0-nnntnq1kxlyj.cluster-czywkg2aepqq.us-west-2.rds.amazonaws.com:5432` |

### Internal ARNs

| Resource | ARN |
|----------|-----|
| Build State Machine | `arn:aws:states:us-west-2:767398133785:stateMachine:fable-dev-build-pipeline` |
| Build Kickoff Lambda | `arn:aws:lambda:us-west-2:767398133785:function:fable-dev-build-kickoff` |
| ECS Cluster | `arn:aws:ecs:us-west-2:767398133785:cluster/fable-dev-builds` |

---

## Build Container

### Dockerfile Location

`packages/infra/build/Dockerfile`

### Key Features

```dockerfile
# Base image
FROM node:20-slim

# AWS CLI v2 for S3 uploads
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip && ./aws/install

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Non-root user (required for --dangerously-skip-permissions)
RUN groupadd -r fable && useradd -r -g fable -d /fable -s /bin/bash fable

# Environment
ENV CLAUDE_CODE_USE_BEDROCK=1
ENV AWS_REGION=us-west-2
```

### Entrypoint Script

`packages/infra/build/entrypoint.sh`

1. Receives `FABLE_PHASE`, `FABLE_BUILD_SPEC`, `FABLE_BUILD_ID`
2. Writes build spec to work directory
3. Runs Claude Code CLI with appropriate prompt
4. Uploads `output.json` to S3

### Building and Pushing

```bash
# From FABLE repo root
cd packages/infra

# Build for linux/amd64 (Fargate)
docker build --platform linux/amd64 -f build/Dockerfile -t fable-build ..

# Tag and push to ECR
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 767398133785.dkr.ecr.us-west-2.amazonaws.com
docker tag fable-build:latest 767398133785.dkr.ecr.us-west-2.amazonaws.com/fable-dev-build:latest
docker push 767398133785.dkr.ecr.us-west-2.amazonaws.com/fable-dev-build:latest
```

---

## Monitoring

### CloudWatch Log Groups

| Log Group | Source |
|-----------|--------|
| `/aws/lambda/fable-dev-build-kickoff` | Build kickoff Lambda |
| `/aws/lambda/fable-dev-chat` | Chat Lambda |
| `/aws/lambda/fable-dev-connection-manager` | WebSocket Lambda |
| `/aws/lambda/fable-dev-get-task-output` | Task output Lambda |
| `/aws/lambda/fable-dev-mcp-gateway` | MCP Gateway Lambda |
| `/aws/stepfunctions/fable-dev-build-pipeline` | Step Functions execution |
| `Fable-dev-BuildTaskDefinitionBuildContainerLogGroupC854FE74-*` | ECS task logs |

### Useful Commands

```bash
# Check latest build execution
aws stepfunctions list-executions \
  --state-machine-arn "arn:aws:states:us-west-2:767398133785:stateMachine:fable-dev-build-pipeline" \
  --max-results 5

# Get execution history
aws stepfunctions get-execution-history \
  --execution-arn "arn:aws:states:us-west-2:767398133785:execution:fable-dev-build-pipeline:{execution-name}"

# Check ECS tasks
aws ecs list-tasks --cluster fable-dev-builds

# Tail Step Functions logs
aws logs tail "/aws/stepfunctions/fable-dev-build-pipeline" --follow

# Trigger a test build
aws lambda invoke \
  --function-name fable-dev-build-kickoff \
  --cli-binary-format raw-in-base64-out \
  --payload '{"action": "start", "payload": {"request": "Build an MCP tool", "userId": "test", "orgId": "test"}}' \
  /tmp/output.json
```

---

## Cost Estimate (Dev Environment)

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| Aurora Serverless v2 | 0.5-2 ACU | ~$50-90 |
| ECS Fargate | ~10 builds/day, 20min avg | ~$30 |
| Lambda | ~10K invocations | ~$5 |
| NAT Gateway | Data transfer | ~$30 |
| DynamoDB | On-demand | ~$5 |
| S3 | <1GB | ~$1 |
| **Total** | | **~$120-160/month** |

---

## Deployment

### CDK Commands

```bash
cd packages/infra

# Deploy
npx cdk deploy

# Deploy with approval bypass
npx cdk deploy --require-approval never

# Diff changes
npx cdk diff

# Destroy (careful!)
npx cdk destroy
```

### Stack Outputs

After deployment, CDK outputs:
- `ArtifactsBucketName`
- `AuroraEndpoint`
- `AuroraSecretArn`
- `BuildClusterArn`
- `BuildKickoffArn`
- `BuildRepositoryUri`
- `BuildStateMachineArn`
- `McpGatewayUrl`
- `WebSocketUrl`

---

## Version History

| Date | Change |
|------|--------|
| 2026-02-04 | Added GetTaskOutput Lambda for ECS-to-Step Functions communication |
| 2026-02-04 | Fixed MarkSuccessTask to use OI output instead of deploy result |
| 2026-02-03 | Initial Step Functions build pipeline |
| 2026-02-02 | MCP Gateway with Function URL |
| 2026-02-01 | Aurora, DynamoDB, base infrastructure |
