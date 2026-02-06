# FABLE Architecture Document

**Version:** 3.0 (Phase 4b - MCP Sidecar Complete)
**Last Updated:** 2026-02-06

FABLE (Forwardflow Autonomous Build Loop Engine) is a self-extending AI system where AI builds tools that AI can use.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Lambda Functions](#3-lambda-functions)
4. [Build Pipeline](#4-build-pipeline)
5. [Memory System](#5-memory-system)
6. [Tool System](#6-tool-system)
7. [Data Stores](#7-data-stores)
8. [Security Architecture](#8-security-architecture)
9. [Deployment](#9-deployment)
10. [Environment Configuration](#10-environment-configuration)

---

## 1. System Overview

### The Self-Extending Loop

```
User Request → FABLE Builds Tool → Tool Deployed → AI Can Use Tool → FABLE More Capable
```

This autonomous self-development loop is FABLE's unique value proposition. Users describe what they need in natural language, and FABLE:

1. **Decomposes** the request (CORE phase)
2. **Orchestrates** implementation (OI phase)
3. **Implements** via workers (Worker phase)
4. **Deploys** as Lambda functions
5. **Makes tools immediately available** via MCP Gateway

### Core Principles

| Principle | Implementation |
|-----------|----------------|
| **CLAUDE.md as Infrastructure** | Templates guide AI behavior, not programmatic control |
| **Trust the Machine Spirit** | Minimal guardrails, let Claude reason |
| **Template Inheritance** | CORE → OI → Worker templates cascade |
| **Observe Don't Rescue** | Let FABLE processes fail to learn |

---

## 2. High-Level Architecture

### System Architecture Diagram

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        Web["Web UI<br/>(Quasar/Vue)"]
        CLI["Claude Code CLI"]
        MCP["MCP Clients"]
    end

    subgraph API["API Layer"]
        WS["WebSocket API<br/>API Gateway"]
        MCPGW["MCP Gateway<br/>Lambda Function URL"]
        ToolURLs["Tool Function URLs"]
    end

    subgraph Routing["Routing Layer"]
        ConnMgr["Connection Manager"]
        Router["Router Lambda"]
    end

    subgraph Compute["Compute Layer"]
        Chat["Chat Lambda"]
        Memory["Memory Lambda"]
        BuildKickoff["Build Kickoff"]
        ToolDeployer["Tool Deployer"]
        GetOutput["Get Task Output"]
        UpdateStatus["Update Build Status"]
    end

    subgraph Build["Build Pipeline"]
        SF["Step Functions<br/>State Machine"]
        subgraph ECS["ECS Fargate"]
            Core["CORE Phase<br/>Container"]
            OI["OI Phase<br/>Container"]
        end
        subgraph Container["Build Container"]
            ClaudeCode["Claude Code CLI"]
            Sidecar["MCP Sidecar<br/>(stdio)"]
        end
    end

    subgraph Storage["Storage Layer"]
        subgraph DDB["DynamoDB"]
            Connections["connections"]
            Conversations["conversations"]
            Builds["builds"]
            Tools["tools"]
        end
        S3["S3<br/>Artifacts Bucket"]
        subgraph Aurora["Aurora PostgreSQL"]
            Memories["memories"]
            Relations["memory_relations"]
            PGVector["pgvector<br/>embeddings"]
        end
    end

    subgraph AI["AI Services"]
        Bedrock["Amazon Bedrock<br/>Claude + Titan"]
    end

    %% Client connections
    Web --> WS
    CLI --> MCPGW
    MCP --> MCPGW

    %% API routing
    WS --> ConnMgr
    WS --> Router
    Router --> Chat
    Router --> BuildKickoff

    %% Chat flow
    Chat --> Bedrock
    Chat --> Memory
    Chat --> Tools
    Chat --> ToolURLs

    %% Build flow
    BuildKickoff --> SF
    SF --> Core
    SF --> OI
    SF --> GetOutput
    SF --> ToolDeployer
    SF --> UpdateStatus
    Core --> ClaudeCode
    OI --> ClaudeCode
    ClaudeCode --> Sidecar
    Sidecar --> Memory

    %% Storage
    ConnMgr --> Connections
    Router --> Conversations
    Chat --> Conversations
    BuildKickoff --> Builds
    UpdateStatus --> Builds
    ToolDeployer --> Tools
    ToolDeployer --> S3
    Memory --> Aurora
    GetOutput --> S3
    Core --> S3
    OI --> S3

    %% MCP Gateway
    MCPGW --> Tools
    MCPGW --> ToolURLs
```

### Component Summary

| Layer | Components | Purpose |
|-------|------------|---------|
| **Client** | Web UI, Claude Code CLI, MCP Clients | User interaction |
| **API** | WebSocket API, MCP Gateway, Tool URLs | Request routing |
| **Compute** | 10 Lambda functions | Business logic |
| **Build** | Step Functions + ECS Fargate | Build orchestration |
| **Storage** | DynamoDB, S3, Aurora | State and artifacts |
| **AI** | Amazon Bedrock | Claude and embeddings |

---

## 3. Lambda Functions

### Function Overview

```mermaid
flowchart LR
    subgraph Communication["Communication"]
        CM["connection-manager<br/>256MB / 30s"]
        Router["router<br/>512MB / 30s"]
        Chat["chat<br/>1024MB / 60s"]
    end

    subgraph Build["Build Pipeline"]
        BK["build-kickoff<br/>256MB / 30s"]
        GTO["get-task-output<br/>256MB / 30s"]
        UBS["update-build-status<br/>256MB / 10s"]
    end

    subgraph Tools["Tool Management"]
        TD["tool-deployer<br/>256MB / 60s"]
        MG["mcp-gateway<br/>256MB / 30s"]
    end

    subgraph Data["Data Layer"]
        Mem["memory<br/>512MB / 30s"]
        DBI["db-init<br/>256MB / 60s"]
    end
```

### Detailed Function Reference

| Function | File | Purpose | VPC | Triggers |
|----------|------|---------|-----|----------|
| **connection-manager** | `lambda/connection-manager/` | WebSocket connect/disconnect | No | API GW $connect/$disconnect |
| **router** | `lambda/router/` | Intent classification, request routing | No | API GW $default |
| **chat** | `lambda/chat/` | Conversational AI with tool use | Yes | Lambda invoke |
| **build-kickoff** | `lambda/build-kickoff/` | Start build pipeline | No | Lambda invoke |
| **get-task-output** | `lambda/get-task-output/` | Retrieve phase outputs from S3 | No | Step Functions |
| **update-build-status** | `lambda/update-build-status/` | Update build completion | No | Step Functions |
| **tool-deployer** | `lambda/tool-deployer/` | Deploy tools as Lambdas | No | Step Functions |
| **mcp-gateway** | `lambda/mcp-gateway/` | MCP protocol endpoint | No | Function URL |
| **memory** | `lambda/memory/` | Memory CRUD + semantic search | Yes | Lambda invoke / Function URL |
| **db-init** | `lambda/db-init/` | Initialize Aurora schema | Yes | Manual / CDK |

### Intent Classification Flow

```mermaid
sequenceDiagram
    participant Client
    participant Router
    participant Bedrock
    participant Chat
    participant Build
    participant Memory

    Client->>Router: WebSocket message
    Router->>Router: Load conversation context
    Router->>Bedrock: Classify intent (Haiku)
    Bedrock-->>Router: {intent, confidence}

    alt CHAT intent
        Router->>Chat: Forward message
        Chat-->>Client: Streaming response
    else BUILD intent
        Router->>Build: Start pipeline
        Build-->>Client: build_started event
    else MEMORY intent
        Router->>Memory: Memory operation
        Memory-->>Client: Memory result
    else USE_TOOL intent
        Router->>Chat: Tool invocation
        Chat-->>Client: Tool result
    end
```

---

## 4. Build Pipeline

### Step Functions State Machine

```mermaid
stateDiagram-v2
    [*] --> CoreTask: Start Build

    CoreTask --> GetCoreOutput: CORE Complete
    CoreTask --> MarkFailure: CORE Failed

    GetCoreOutput --> OiTask: Output Retrieved
    GetCoreOutput --> MarkFailure: Retrieval Failed

    OiTask --> GetOiOutput: OI Complete
    OiTask --> MarkFailure: OI Failed

    GetOiOutput --> DeployTask: Output Retrieved
    GetOiOutput --> MarkFailure: Retrieval Failed

    DeployTask --> MarkSuccess: Tools Deployed
    DeployTask --> MarkFailure: Deploy Failed

    MarkSuccess --> [*]: Build Complete
    MarkFailure --> [*]: Build Failed

    note right of CoreTask
        ECS Fargate Task
        Phase: core
        Creates specs, templates
    end note

    note right of OiTask
        ECS Fargate Task
        Phase: oi
        Orchestrates workers
    end note

    note right of DeployTask
        Lambda: tool-deployer
        Creates Lambda functions
        Registers in DynamoDB
    end note
```

### Build Container Architecture

```mermaid
flowchart TB
    subgraph Container["ECS Fargate Task"]
        subgraph Entrypoint["entrypoint.sh"]
            GitAuth["GitHub App Auth"]
            MCPConfig["MCP Config Setup"]
            PhaseSelect["Phase Selection"]
        end

        subgraph ClaudeCode["Claude Code CLI"]
            Bedrock["Bedrock API"]
            Tools["Built-in Tools"]
        end

        subgraph Sidecar["MCP Sidecar (Node.js)"]
            StdIO["stdio Transport"]
            HTTP["HTTP Client"]
        end

        subgraph Templates["Templates"]
            CoreT["CLAUDE.md.core-base"]
            OIT["CLAUDE.md.oi-base"]
            WorkerT["CLAUDE.md.worker-base"]
        end
    end

    subgraph External["External Services"]
        MemLambda["Memory Lambda"]
        GitHub["GitHub API"]
        S3["S3 Artifacts"]
    end

    Entrypoint --> ClaudeCode
    ClaudeCode -->|stdin/stdout| Sidecar
    Sidecar -->|HTTP POST| MemLambda
    Entrypoint --> GitHub
    ClaudeCode --> S3
    Templates --> ClaudeCode
```

### Phase Templates

| Template | Role | Responsibilities |
|----------|------|------------------|
| `CLAUDE.md.core-base` | Architect | Decomposition, spec creation, graph/timeline init |
| `CLAUDE.md.oi-base` | Orchestrator | Worker management, integration, verification |
| `CLAUDE.md.worker-base` | Implementer | Task implementation, testing, status reporting |

### Build Artifacts (S3)

```
builds/{buildId}/
├── core-output.json      # CORE phase result
├── oi-output.json        # OI phase result
├── requirements.md       # Specification document
├── graph.json            # Knowledge graph
├── timeline.jsonl        # Event timeline
└── tools/
    └── {tool-name}/
        ├── src/
        ├── package.json
        └── tool.json
```

---

## 5. Memory System

### Memory Architecture

```mermaid
flowchart TB
    subgraph Clients["Memory Clients"]
        Chat["Chat Lambda"]
        Build["Build Container"]
        MCP["MCP Clients"]
    end

    subgraph Sidecar["MCP Sidecar (in Build Container)"]
        StdIO["StdioServerTransport"]
        Bridge["Lambda Bridge"]
    end

    subgraph Lambda["Memory Lambda"]
        Handler["Handler"]
        Embeddings["Bedrock Titan<br/>Embeddings"]
    end

    subgraph Aurora["Aurora PostgreSQL"]
        Memories["memories table"]
        Relations["memory_relations"]
        Vectors["pgvector (1536-dim)"]
    end

    Chat -->|Lambda invoke| Handler
    Build -->|stdin/stdout| StdIO
    StdIO --> Bridge
    Bridge -->|HTTP POST| Handler
    MCP -->|Function URL| Handler

    Handler --> Embeddings
    Handler --> Memories
    Handler --> Relations
    Handler --> Vectors
```

### MCP Sidecar Configuration

The sidecar bridges Claude Code to the Memory Lambda via stdio transport:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/fable/mcp-sidecar/dist/index.js"],
      "env": {
        "MEMORY_LAMBDA_URL": "https://...",
        "FABLE_BUILD_ID": "...",
        "FABLE_ORG_ID": "..."
      }
    }
  }
}
```

### Memory Types and Behavior

| Type | Decays | Default Scope | Purpose |
|------|--------|---------------|---------|
| `insight` | No | project | Why decisions were made |
| `gotcha` | Yes | project | What went wrong, how to avoid |
| `preference` | No | private | How user likes things done |
| `pattern` | Yes | global | Successful approaches |
| `capability` | No | global | Tools/features built |
| `status` | Yes | project | Current state, where left off |

### Memory Tools

| Tool | Purpose |
|------|---------|
| `memory_create` | Store new memory with type/scope/importance |
| `memory_search` | Semantic + keyword search |
| `memory_session_start` | Load context at session start |
| `memory_boost` | Increase importance score |
| `memory_pin` | Prevent decay |
| `memory_relate` | Create knowledge graph edges |

### Database Schema

```sql
-- memories table
CREATE TABLE memories (
  id UUID PRIMARY KEY,
  type memory_type NOT NULL,           -- insight, gotcha, preference, pattern, capability, status
  content TEXT NOT NULL,
  embedding vector(1536),               -- pgvector
  scope memory_scope NOT NULL,          -- user, org, global
  source memory_source NOT NULL,        -- user_stated, ai_corrected, ai_inferred
  importance DECIMAL(3,2) DEFAULT 0.5,
  pinned BOOLEAN DEFAULT false,
  tags TEXT[],
  context JSONB,
  project VARCHAR(255),
  user_id UUID,
  org_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  accessed_at TIMESTAMPTZ,
  superseded_by UUID
);

-- memory_relations table
CREATE TABLE memory_relations (
  id UUID PRIMARY KEY,
  from_id UUID REFERENCES memories(id),
  to_id UUID REFERENCES memories(id),
  type VARCHAR(50),                     -- supersedes, relates_to, caused_by, fixed_by, implements
  created_at TIMESTAMPTZ
);

-- Semantic search function
CREATE FUNCTION search_memories(
  query_embedding vector(1536),
  user_id UUID,
  org_id UUID,
  scopes memory_scope[],
  limit_count INT
) RETURNS TABLE (...);
```

---

## 6. Tool System

### Tool Lifecycle

```mermaid
flowchart LR
    subgraph Build["Build Phase"]
        OI["OI Phase"]
        Worker["Workers"]
    end

    subgraph Deploy["Deployment"]
        S3["S3 Artifact"]
        Deployer["Tool Deployer<br/>Lambda"]
        ToolLambda["Tool Lambda<br/>(created)"]
        FnURL["Function URL<br/>(assigned)"]
    end

    subgraph Registry["Registry"]
        DDB["DynamoDB<br/>tools table"]
    end

    subgraph Discovery["Discovery"]
        Gateway["MCP Gateway"]
        Chat["Chat Lambda"]
    end

    OI --> Worker
    Worker --> S3
    S3 --> Deployer
    Deployer --> ToolLambda
    ToolLambda --> FnURL
    Deployer --> DDB

    DDB --> Gateway
    DDB --> Chat
    Gateway --> FnURL
    Chat --> FnURL
```

### MCP Gateway

The MCP Gateway provides a single endpoint for all FABLE-deployed tools:

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant Gateway as MCP Gateway
    participant DDB as DynamoDB
    participant Tool as Tool Lambda

    Client->>Gateway: initialize
    Gateway-->>Client: {protocolVersion, capabilities}

    Client->>Gateway: tools/list
    Gateway->>DDB: Scan tools table
    DDB-->>Gateway: [tool definitions]
    Gateway-->>Client: {tools: [...]}

    Client->>Gateway: tools/call {name, arguments}
    Gateway->>DDB: Get tool by name
    DDB-->>Gateway: {functionUrl}
    Gateway->>Tool: HTTP POST
    Tool-->>Gateway: Result
    Gateway-->>Client: {content: [...]}
```

### Tool Registration

Tools are stored in DynamoDB with:

```typescript
interface Tool {
  orgId: string;           // Partition key
  toolName: string;        // Sort key
  description: string;
  functionUrl: string;
  functionArn: string;
  inputSchema: object;
  outputSchema: object;
  buildId: string;
  gitRepo?: string;
  gitCommit?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## 7. Data Stores

### DynamoDB Tables

```mermaid
erDiagram
    CONNECTIONS {
        string connectionId PK
        string userId
        string orgId
        string connectedAt
        number ttl
    }

    CONVERSATIONS {
        string userId PK
        string conversationId SK
        string orgId
        array messages
        string activeBuildId
        string createdAt
    }

    BUILDS {
        string orgId PK
        string buildId SK
        string userId
        string request
        string status
        string phase
        number progress
        string error
        string createdAt
    }

    TOOLS {
        string orgId PK
        string toolName SK
        string description
        string functionUrl
        string functionArn
        object inputSchema
        string buildId
        string createdAt
    }
```

### S3 Bucket Structure

```
fable-artifacts-{stage}-{account}/
├── builds/
│   └── {buildId}/
│       ├── core-output.json
│       ├── oi-output.json
│       ├── requirements.md
│       ├── graph.json
│       ├── timeline.jsonl
│       └── tools/
│           └── {tool-name}/
│               ├── src/index.ts
│               ├── package.json
│               └── tool.json
└── logs/
    └── {buildId}/
        └── {phase}-{timestamp}.log
```

### Aurora PostgreSQL

- **Engine:** PostgreSQL 16.4 with pgvector extension
- **Type:** Aurora Serverless v2
- **Scaling:** 0.5-4 ACU (dev), 0.5-16 ACU (prod)
- **Tables:** memories, memory_relations
- **Vector Index:** IVFFlat with 100 lists

---

## 8. Security Architecture

### Network Isolation

```mermaid
flowchart TB
    subgraph Public["Public Subnet"]
        NAT["NAT Gateway"]
        IGW["Internet Gateway"]
    end

    subgraph Private["Private Subnet (with egress)"]
        ECS["ECS Tasks"]
        VPCLambda["VPC Lambdas<br/>(chat, memory, db-init)"]
    end

    subgraph Isolated["Isolated Subnet"]
        Aurora["Aurora PostgreSQL"]
    end

    Internet --> IGW
    ECS --> NAT
    NAT --> IGW
    VPCLambda --> NAT
    VPCLambda --> Aurora
    ECS -.->|No direct access| Aurora
```

### IAM Roles

| Role | Permissions |
|------|-------------|
| **Chat Lambda** | DynamoDB (connections, conversations, tools), Bedrock invoke, Memory Lambda invoke |
| **Tool Deployer** | Lambda management (fable-*-tool-*), IAM PassRole, DynamoDB tools, S3 artifacts |
| **Build Task** | Bedrock invoke, S3 read-write, DynamoDB read-write, Secrets Manager read |
| **Tool Execution** | S3 read (artifacts), Memory Lambda invoke, CloudWatch Logs |

### Secrets Management

| Secret | Storage | Consumer |
|--------|---------|----------|
| Aurora credentials | Secrets Manager | Memory Lambda, DB Init |
| GitHub App credentials | Secrets Manager | Build entrypoint |
| API keys | Environment variables | Lambda functions |

---

## 9. Deployment

### Infrastructure Deployment

```bash
# Deploy CDK stack
cd packages/infra
npm run build
npx cdk deploy --require-approval never
```

### Build Container Deployment

```bash
# Build and push Docker image
docker buildx build \
  --platform linux/amd64 \
  -t 767398133785.dkr.ecr.us-west-2.amazonaws.com/fable-dev-build:latest \
  -f packages/infra/build/Dockerfile . \
  --push
```

### Tool Deployment via GitHub Actions

Tools can be deployed from FABLE-TOOLS repository:

1. Push to feature branch
2. GitHub Action triggers on push
3. Assumes AWS role via OIDC
4. Calls Tool Deployer Lambda
5. Lambda registered in DynamoDB

---

## 10. Environment Configuration

### Development (fable-dev)

| Setting | Value |
|---------|-------|
| Aurora ACU | 0.5 - 4 |
| NAT Gateways | 1 |
| Deletion Protection | No |
| Log Retention | 14 days |

### Production (fable-prod)

| Setting | Value |
|---------|-------|
| Aurora ACU | 0.5 - 16 |
| NAT Gateways | 2 |
| Deletion Protection | Yes |
| Log Retention | 90 days |

### Key Environment Variables

| Variable | Used By | Purpose |
|----------|---------|---------|
| `STAGE` | All Lambdas | Environment identifier |
| `CONNECTIONS_TABLE` | Router, Chat, ConnMgr | WebSocket connections |
| `CONVERSATIONS_TABLE` | Router, Chat | Message history |
| `BUILDS_TABLE` | Build Kickoff, Update Status | Build tracking |
| `TOOLS_TABLE` | Chat, Tool Deployer, MCP Gateway | Tool registry |
| `ARTIFACTS_BUCKET` | Tool Deployer, Get Output | S3 bucket name |
| `AURORA_SECRET_ARN` | Memory, DB Init | Database credentials |
| `MEMORY_LAMBDA_URL` | Build Container | Memory Lambda endpoint |
| `STATE_MACHINE_ARN` | Build Kickoff | Step Functions ARN |

---

## Appendix: File Structure

```
FABLE/
├── docs/
│   ├── ARCHITECTURE.md              # This document
│   └── diagrams/
│       └── fable-architecture.excalidraw
├── iteration-2/
│   └── templates/                   # Build phase templates
│       ├── CLAUDE.md.core-base
│       ├── CLAUDE.md.oi-base
│       └── CLAUDE.md.worker-base
├── packages/
│   ├── infra/
│   │   ├── lib/
│   │   │   └── fable-stack.ts       # CDK stack (972 lines)
│   │   ├── lambda/
│   │   │   ├── build-kickoff/
│   │   │   ├── chat/
│   │   │   ├── connection-manager/
│   │   │   ├── db-init/
│   │   │   ├── get-task-output/
│   │   │   ├── mcp-gateway/
│   │   │   ├── memory/
│   │   │   ├── router/
│   │   │   ├── tool-deployer/
│   │   │   └── update-build-status/
│   │   ├── build/
│   │   │   ├── Dockerfile
│   │   │   └── entrypoint.sh
│   │   └── mcp-sidecar/
│   │       ├── src/index.ts
│   │       ├── package.json
│   │       └── tsconfig.json
│   ├── mcp-servers/
│   │   └── memory/                  # Standalone MCP server
│   └── shared/
│       └── src/types.ts
├── CLAUDE.md                        # Project instructions
├── CURRENT-WORK.md                  # Active work tracking
└── brainstorm.md                    # Full product vision
```

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-15 | Initial architecture |
| 2.0 | 2026-01-28 | Added Memory Lambda, Aurora, scalable design |
| 3.0 | 2026-02-06 | Phase 4b: MCP stdio sidecar, updated diagrams |
