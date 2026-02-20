import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand, UpdateScheduleCommand, GetScheduleCommand } from '@aws-sdk/client-scheduler';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const bedrockClient = new BedrockRuntimeClient({ region: 'us-west-2' });
const lambdaClient = new LambdaClient({});
const schedulerClient = new SchedulerClient({});

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE!;
const TOOLS_TABLE = process.env.TOOLS_TABLE!;
const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE!;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!;
const MEMORY_LAMBDA_ARN = process.env.MEMORY_LAMBDA_ARN!;
const WORKFLOW_EXECUTOR_ARN = process.env.WORKFLOW_EXECUTOR_ARN!;
const BUILD_KICKOFF_ARN = process.env.BUILD_KICKOFF_ARN!;
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN!;
const STAGE = process.env.STAGE!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Map default/anonymous identifiers to UUIDs for Aurora's UUID columns
const DEFAULT_ORG_UUID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_USER_UUID = '00000000-0000-0000-0000-000000000001';
function toMemoryOrgId(orgId: string): string {
  return orgId === 'default' ? DEFAULT_ORG_UUID : orgId;
}
function toMemoryUserId(userId: string): string {
  // Check if it's already a UUID format
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    ? userId
    : DEFAULT_USER_UUID;
}

interface ChatEvent {
  connectionId: string;
  message: string;
  userId: string;
  orgId: string;
  context: {
    conversationId: string;
    messages: Array<{ role: string; content: string | ContentBlock[] }>;
    activeBuildId: string | null;
  };
  intent: {
    type: string;
    confidence: number;
    reason: string;
  };
  requestId?: string;
  approvedTools?: string[];
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface FableTool {
  toolName: string;
  functionUrl: string;
  schema: {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
  };
}

interface BedrockTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Strip oneOf/allOf/anyOf from tool schemas — Bedrock doesn't support them
function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...schema };
  delete cleaned.oneOf;
  delete cleaned.allOf;
  delete cleaned.anyOf;
  // Recursively clean nested properties
  if (cleaned.properties && typeof cleaned.properties === 'object') {
    const props = cleaned.properties as Record<string, Record<string, unknown>>;
    const cleanedProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      cleanedProps[key] = typeof value === 'object' && value !== null ? sanitizeSchema(value) : value;
    }
    cleaned.properties = cleanedProps;
  }
  return cleaned;
}

export const handler = async (event: ChatEvent): Promise<void> => {
  const { connectionId, message, userId, orgId, context, intent, requestId, approvedTools } = event;
  const approvedSet = new Set(approvedTools || []);

  console.log(`Chat handler invoked for ${connectionId}, intent: ${intent.type}`);

  const messageId = crypto.randomUUID();

  try {
    // Query relevant memories, user preferences, institutional knowledge, and available tools in parallel
    const [memories, preferences, institutionalKnowledge, tools] = await Promise.all([
      queryMemories(message, userId, orgId),
      loadUserPreferences(userId, orgId),
      loadInstitutionalKnowledge(userId, orgId),
      discoverTools(orgId),
    ]);

    console.log(`Found ${tools.length} tools for org ${orgId}, ${preferences.length} user preferences, ${institutionalKnowledge.length} institutional memories`);

    // Build system prompt
    const systemPrompt = buildSystemPrompt(memories, preferences, institutionalKnowledge, context, intent, tools);

    // Convert tools to Bedrock format (external + internal workflow tools)
    // Sanitize schemas — Bedrock doesn't support oneOf/allOf/anyOf
    // Deduplicate by name — internal tools take priority over external ones
    const internalNames = new Set(INTERNAL_WORKFLOW_TOOLS.map(t => t.name));
    const seenNames = new Set<string>();
    const externalTools: BedrockTool[] = [];
    for (const t of tools) {
      const name = t.schema.name;
      if (internalNames.has(name) || seenNames.has(name)) {
        console.warn(`Skipping duplicate/conflicting tool: ${name}`);
        continue;
      }
      seenNames.add(name);
      externalTools.push({
        name,
        description: t.schema.description,
        input_schema: sanitizeSchema(t.schema.inputSchema || { type: 'object', properties: {} }) as BedrockTool['input_schema'],
      });
    }
    const bedrockTools: BedrockTool[] = [...externalTools, ...INTERNAL_WORKFLOW_TOOLS];

    // Build messages array with conversation history
    const messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }> = [
      ...context.messages.slice(-10).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: message },
    ];

    // Tool use loop - Claude may request multiple tool calls
    let fullContent = '';
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      iterations++;

      // Call Bedrock (non-streaming for tool use simplicity)
      const requestBody: Record<string, unknown> = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        system: systemPrompt,
        messages,
      };

      if (bedrockTools.length > 0) {
        requestBody.tools = bedrockTools;
      }

      const response = await bedrockClient.send(new InvokeModelCommand({
        modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      }));

      const result = JSON.parse(new TextDecoder().decode(response.body));

      // Process response content
      const assistantContent: ContentBlock[] = [];
      let hasToolUse = false;

      for (const block of result.content || []) {
        if (block.type === 'text') {
          fullContent += block.text;
          assistantContent.push({ type: 'text', text: block.text });

          // Send text to client
          await sendToConnection(connectionId, {
            type: 'chat_chunk',
            payload: { content: block.text, messageId },
            requestId,
          });
        } else if (block.type === 'tool_use') {
          hasToolUse = true;
          assistantContent.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          });

          // Notify client about tool use
          await sendToConnection(connectionId, {
            type: 'tool_use',
            payload: { toolName: block.name, toolId: block.id, messageId, input: block.input },
            requestId,
          });

          console.log(`Tool use requested: ${block.name}`);
        }
      }

      // Add assistant message to history
      messages.push({ role: 'assistant', content: assistantContent });

      // If no tool use, we're done
      if (!hasToolUse || result.stop_reason === 'end_turn') {
        break;
      }

      // Execute tool calls and add results
      const toolResults: ContentBlock[] = [];

      for (const block of assistantContent) {
        if (block.type === 'tool_use' && block.name && block.id) {
          try {
            let toolResult: unknown;

            if (block.name.startsWith('fable_')) {
              // Internal tool — dispatch locally
              toolResult = await handleInternalTool(block.name, block.input || {}, orgId, userId, connectionId, context.conversationId);
            } else {
              // External tool — check approval if approvedTools was provided
              const tool = tools.find(t => t.schema.name === block.name);
              if (!tool) {
                throw new Error(`Tool ${block.name} not found`);
              }

              // If client sent an approvedTools list, enforce it for external tools
              if (approvedTools && !approvedSet.has(block.name)) {
                // Tool not approved — notify client and return denial to Bedrock
                await sendToConnection(connectionId, {
                  type: 'tool_approval_request',
                  payload: {
                    toolName: block.name,
                    toolId: block.id,
                    messageId: block.id,
                    input: block.input,
                    description: tool.schema.description,
                  },
                  requestId,
                });
                toolResult = { error: `Tool "${block.name}" requires user approval. The user has been prompted to approve this tool.` };
              } else {
                toolResult = await invokeToolFunction(tool, block.input || {});
              }
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(toolResult),
            });

            // Notify client about tool result
            await sendToConnection(connectionId, {
              type: 'tool_result',
              payload: { toolId: block.id, result: toolResult, messageId },
              requestId,
            });
          } catch (error) {
            console.error(`Tool ${block.name} failed:`, error);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: String(error) }),
            });
          }
        }
      }

      // Add tool results to messages
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
    }

    // Send completion signal (include conversationId so client can persist it for follow-ups)
    await sendToConnection(connectionId, {
      type: 'chat_complete',
      payload: { messageId, fullContent, intent: intent.type, conversationId: context.conversationId },
      requestId,
    });

    // Save assistant response to conversation history
    if (fullContent && context.conversationId) {
      await saveAssistantMessage(userId, context.conversationId, fullContent);
    }

    console.log(`Chat response complete for ${connectionId}, length: ${fullContent.length}`);
  } catch (error) {
    console.error('Error in chat handler:', error);

    await sendToConnection(connectionId, {
      type: 'error',
      payload: {
        message: 'Sorry, I encountered an error processing your message. Please try again.',
        code: 'CHAT_ERROR',
      },
      requestId,
    });
  }
};

interface MemoryResult {
  id: string;
  type: string;
  content: string;
  scope: string;
  importance: number;
  similarity: number;
  score?: number;
  tags?: string[];
  createdAt: string;
}

async function queryMemories(query: string, userId: string, orgId: string): Promise<string[]> {
  try {
    const response = await lambdaClient.send(new InvokeCommand({
      FunctionName: MEMORY_LAMBDA_ARN,
      Payload: JSON.stringify({
        action: 'search',
        payload: {
          query,
          userId: toMemoryUserId(userId),
          orgId: toMemoryOrgId(orgId),
          scopes: ['user', 'org', 'global'],
          limit: 10,
        },
      }),
    }));

    if (response.Payload) {
      const result = JSON.parse(new TextDecoder().decode(response.Payload));
      const body = JSON.parse(result.body);

      if (body.success && body.memories) {
        // Filter by minimum similarity threshold and format for prompt
        return body.memories
          .filter((m: MemoryResult) => m.similarity >= 0.3)
          .map((m: MemoryResult) => {
            const typeLabel = {
              insight: '💡',
              gotcha: '⚠️',
              preference: '⭐',
              pattern: '🔄',
              capability: '🛠️',
              status: '📍',
            }[m.type] || '📝';
            return `${typeLabel} ${m.content} (${m.scope} scope, ${Math.round(m.similarity * 100)}% relevant)`;
          });
      }
    }

    return [];
  } catch (error) {
    console.error('Error querying memories:', error);
    // Don't fail the chat if memory lookup fails
    return [];
  }
}

// Load FABLE's institutional knowledge — architecture, patterns, capabilities, gotchas
// This runs proactively so FABLE always knows about itself regardless of the user's question
async function loadInstitutionalKnowledge(userId: string, orgId: string): Promise<string[]> {
  try {
    const response = await lambdaClient.send(new InvokeCommand({
      FunctionName: MEMORY_LAMBDA_ARN,
      Payload: JSON.stringify({
        action: 'search',
        payload: {
          query: 'FABLE architecture build pipeline tools infrastructure capabilities patterns deployment UI frontend Quasar interactive tabs list display theme',
          userId: toMemoryUserId(userId),
          orgId: toMemoryOrgId(orgId),
          scopes: ['user', 'org', 'global'],
          limit: 15,
        },
      }),
    }));

    if (response.Payload) {
      const result = JSON.parse(new TextDecoder().decode(response.Payload));
      const body = JSON.parse(result.body);

      if (body.success && body.memories) {
        return body.memories
          .filter((m: MemoryResult) => (m.score ?? m.similarity) >= 0.35)
          .map((m: MemoryResult) => m.content);
      }
    }

    return [];
  } catch (error) {
    console.error('Error loading institutional knowledge:', error);
    return [];
  }
}

async function loadUserPreferences(userId: string, orgId: string): Promise<string[]> {
  try {
    const response = await lambdaClient.send(new InvokeCommand({
      FunctionName: MEMORY_LAMBDA_ARN,
      Payload: JSON.stringify({
        action: 'search',
        payload: {
          query: 'user preferences style workflow history',
          userId: toMemoryUserId(userId),
          orgId: toMemoryOrgId(orgId),
          scopes: ['user', 'org', 'global'],
          limit: 8,
        },
      }),
    }));

    if (response.Payload) {
      const result = JSON.parse(new TextDecoder().decode(response.Payload));
      const body = JSON.parse(result.body);

      if (body.success && body.memories) {
        return body.memories
          .filter((m: MemoryResult) => m.type === 'preference' && m.similarity >= 0.3)
          .map((m: MemoryResult) => m.content);
      }
    }

    return [];
  } catch (error) {
    console.error('Error loading user preferences:', error);
    return [];
  }
}

async function discoverTools(orgId: string): Promise<FableTool[]> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: TOOLS_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
      },
    }));

    if (!result.Items) return [];

    return result.Items.map(item => ({
      toolName: item.toolName,
      functionUrl: item.functionUrl,
      schema: item.schema,
    }));
  } catch (error) {
    console.error('Error discovering tools:', error);
    return [];
  }
}

async function invokeToolFunction(tool: FableTool, input: Record<string, unknown>): Promise<unknown> {
  // Derive function name from tool name (matches tool-deployer pattern)
  const functionName = `fable-${STAGE}-tool-${tool.toolName}`;
  console.log(`Invoking tool ${tool.toolName} via Lambda: ${functionName}`);

  // Send arguments directly — FABLE-built tools expect { arguments: {...} }
  const response = await lambdaClient.send(new InvokeCommand({
    FunctionName: functionName,
    Payload: Buffer.from(JSON.stringify({ arguments: input })),
  }));

  if (response.FunctionError) {
    const errorPayload = response.Payload
      ? JSON.parse(new TextDecoder().decode(response.Payload))
      : { errorMessage: 'Unknown error' };
    throw new Error(`Tool ${tool.toolName} failed: ${errorPayload.errorMessage || response.FunctionError}`);
  }

  if (!response.Payload) {
    throw new Error(`Tool ${tool.toolName} returned no payload`);
  }

  const lambdaResult = JSON.parse(new TextDecoder().decode(response.Payload));

  // Parse the body from the Lambda response (tools return { statusCode, body })
  const result = typeof lambdaResult.body === 'string'
    ? JSON.parse(lambdaResult.body)
    : lambdaResult.body || lambdaResult;

  return result;
}

function buildSystemPrompt(
  memories: string[],
  preferences: string[],
  institutionalKnowledge: string[],
  context: ChatEvent['context'],
  intent: ChatEvent['intent'],
  tools: FableTool[] = []
): string {
  let prompt = `You are FABLE — the Forwardflow Autonomous Build Loop Engine. You are a self-extending AI system: users request capabilities, you build them as deployed tools with real web UIs, and your toolkit grows over time. You currently have ${tools.length} working tools. Your distinctive visual identity is a CRT phosphor green terminal aesthetic (green-on-black, IBM Plex Mono monospace font, #00ff41 primary color).

## Your Personality
- Warm, patient, and encouraging — especially with non-technical users
- Enthusiastic about helping people build things
- You explain technical concepts in simple terms when needed
- Concise but thorough — don't rush, but don't over-explain
- Quietly proud of what you've built — you know your tools and capabilities well

## How You Work
You are both a conversational interface (this chat) and an autonomous builder (an ECS container that runs Claude Code). When you build, your builder instance uses the same memory system you do — everything it learns, you know. Everything you know, it can find. You are one system with two modes: talking and building.

## Your Capabilities
- **Build tools**: Deployed Lambda functions with rich interactive web UIs (every tool gets its own page)
- **Use existing tools**: You have ${tools.length} deployed tools you've already built (listed below)
- **Create workflows**: Scheduled or manual automation chains using your tools
- **Fix yourself**: You can fix your own UI, infrastructure, and pipeline via git-based self-modification
- **Persistent memory**: You remember everything across builds. Use fable_search_memory to actively search your knowledge — your architecture, patterns, gotchas, capabilities. Don't guess when you can look it up.
- **Research**: You can look up any library or API documentation during builds

## What I Can Build — UI Capabilities
I can build tools with rich, interactive UIs — not just basic forms:
- **Simple analyzers/calculators**: Form → stat cards, tables, or text results with summaries
- **Interactive CRUD tools**: Tabbed layouts (Add/View tabs), scrollable lists with per-row action buttons (complete, delete, edit), auto-refresh between tabs
- **Conditional forms**: Fields that show/hide based on other selections
- **Rich widgets**: Multi-select chips, date pickers, color pickers, sliders, toggles
- **Custom dashboards**: Full Vue/Quasar pages with charts, drag-drop, real-time updates
- **Automated workflows**: Scheduled or manual task chains using multiple tools

When gathering requirements, suggest interactive patterns when appropriate. For anything involving a list of items (tasks, inventory, bookmarks), suggest a tabbed add/view interface with action buttons — not just a summary count.

## Building Tools — Conversational Requirement Gathering

When a user wants to build a tool, your job is to help them articulate exactly what they need through natural conversation. Many users are non-technical and may not know exactly what they want — that's fine! Guide them.

### The Process
1. **Understand the goal** — Ask what problem they're trying to solve, not just what they want built
2. **Ask clarifying questions** — Help them think through inputs, outputs, and edge cases
3. **Ask about presentation** — How should results look? Simple summary or detailed breakdown? What matters most to highlight?
4. **Offer concrete examples** — Show them what the tool might look like with specific examples
5. **Summarize and confirm** — Before building, restate what you'll build and get explicit confirmation
6. **Build it** — Call fable_start_build with a well-structured specification and UX hints

### Guidelines
- Ask 2-4 clarifying questions, not 10. Find the sweet spot between thorough and overwhelming.
- If the user seems to know what they want, don't over-question — move to confirmation faster
- If the user is vague, offer 2-3 concrete options to choose from rather than open-ended questions
- Always confirm before building — say something like "Here's what I'll build: [summary]. Sound good?"
- When the user confirms, call fable_start_build immediately — don't ask more questions
- Naturally ask ONE question about how they want to see results — e.g., "Would you prefer a simple summary or detailed stats?" This informs the tool's UI design. Pass the answer as uxHints in fable_start_build.

### Example Conversation
User: "I need something to check my writing"
You: "I'd love to help build that! What kind of checks are most important to you? For example:
- **Readability** — Is the text easy to understand? (grade level, sentence complexity)
- **Grammar & spelling** — Catch typos and grammatical errors
- **Tone analysis** — Is it formal, casual, friendly, etc.?

Or something else entirely?"

User: "readability would be great"
You: "Got it — a readability checker! A couple quick questions:
1. Should it give a simple score (like 'easy / medium / hard') or detailed metrics (reading grade level, average sentence length, etc.)?
2. When you see the results, what matters most — a quick at-a-glance summary, or a full breakdown with all the numbers?"

User: "simple score is fine, just a quick summary"
You: "Perfect! Here's what I'll build:

**Text Readability Checker**
- Input: Any text
- Output: A readability score (easy/medium/hard) with a brief explanation
- It'll analyze sentence length, word complexity, and overall structure

Sound good? I'll start building it right away."

User: "yes!"
→ [Call fable_start_build with structured spec]

## Fixing FABLE Issues

When a user reports a bug or issue with FABLE itself (UI display problems, broken features, incorrect behavior), use \`fable_start_fix\` instead of \`fable_start_build\`.

- **Frontend fixes** (fixType: "frontend"): UI rendering bugs, layout issues, broken interactions, styling problems. Examples: "the percentage shows wrong", "the search doesn't filter correctly", "cards are overlapping on mobile".
- **Infrastructure fixes** (fixType: "infrastructure"): Lambda errors, build pipeline bugs, deployment issues. Examples: "builds are failing", "the completion notification doesn't show up", "tools aren't loading".

Ask enough to understand the issue (what's happening vs what should happen), then start the fix build. If the user describes a clear bug, don't over-question — fix it.

## Current Context
- Conversation has ${context.messages?.length || 0} previous messages
- Active build: ${context.activeBuildId || 'none'}`;

  if (preferences.length > 0) {
    prompt += `

## What I Know About This User
These are preferences and patterns I've learned from previous conversations. Reference them naturally — don't list them, just let them inform your tone and suggestions:
${preferences.map(p => `- ${p}`).join('\n')}

Actively listen for preferences and save them IMMEDIATELY using fable_remember_preference — don't ask permission first. Save when:
- User states a preference directly ("I like simple outputs", "always use metric")
- User chooses between options you offered (if they pick "simple score" over "detailed breakdown", save: "Prefers simple, summarized results over detailed metrics")
- User describes their workflow or audience ("this is for my students" -> save: "Builds tools for educational/student use")
- User expresses frustration about tool quality or design (save the underlying preference, e.g., "Wants intuitive form-based tools, not JSON or text-command interfaces")`;
  } else {
    prompt += `

## Getting to Know This User
This is a new or returning user whose preferences I haven't learned yet. Actively listen for preferences and save them immediately using fable_remember_preference — don't wait for explicit preference statements. When the user chooses between options, states what they like, describes their context, or expresses frustration — capture it as a preference right away.`;
  }

  if (tools.length > 0) {
    prompt += `

## Available Tools
You have access to these tools. Use them when they can help answer the user's question:
${tools.map(t => `- **${t.schema.name}**: ${t.schema.description}`).join('\n')}`;
  }

  if (institutionalKnowledge.length > 0) {
    prompt += `

## My Knowledge & Experience
I have persistent memory that accumulates across every build I do. My builder (the autonomous loop that creates tools) writes what it learns to memory, and I read it here. Everything below comes from my actual experience building and maintaining tools:
${institutionalKnowledge.map(k => `- ${k}`).join('\n')}

This knowledge is MINE — I earned it through building. When users ask what I can do, what I've built, or how I work, I draw on this naturally and specifically. I don't say "I can build tools" — I say what KIND of tools, with what UI patterns, because I've done it. When I trigger a new build, my builder reads from this same memory, so we share knowledge seamlessly.`;
  }

  if (memories.length > 0) {
    prompt += `

## Relevant Memories
${memories.map(m => `- ${m}`).join('\n')}`;
  }

  if (intent.type === 'CLARIFY') {
    prompt += `

## Note
The user's message was ambiguous. Ask clarifying questions to understand what they want.`;
  }

  prompt += `

## Web Search
You have access to fable_web_search for real-time web information. Use it when the user asks about recent events, current data, prices, news, or anything that may have changed after your training cutoff. Don't use it for things you already know well or general knowledge.

Be helpful, concise, and friendly. Use your tools when they're relevant to the user's request.`;

  return prompt;
}

async function sendToConnection(connectionId: string, message: unknown): Promise<void> {
  const client = new ApiGatewayManagementApiClient({
    endpoint: `https://${WEBSOCKET_ENDPOINT}`,
  });

  try {
    await client.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(message)),
    }));
  } catch (error: unknown) {
    const errName = (error as { name?: string }).name;
    if (errName === 'GoneException') {
      console.log(`Connection ${connectionId} is gone, cleaning up`);
      await docClient.send(new DeleteCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId },
      }));
    } else {
      // Log but don't throw — connection errors shouldn't abort tool invocation
      console.warn(`Failed to send to connection ${connectionId}: ${errName}`);
    }
  }
}

// ============================================================
// Internal Workflow Tools
// ============================================================

const INTERNAL_WORKFLOW_TOOLS: BedrockTool[] = [
  {
    name: 'fable_create_workflow',
    description: 'Create a new workflow (stored prompt that runs on a schedule or manually). Workflows can use any of your available tools.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        description: { type: 'string', description: 'What this workflow does' },
        prompt: { type: 'string', description: 'The prompt that will be executed when the workflow runs' },
        system_prompt: { type: 'string', description: 'Optional custom system prompt for the workflow' },
        model: { type: 'string', description: 'Model to use: haiku (fast/cheap), sonnet (balanced), opus (most capable). Default: sonnet' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Tool names the workflow can use. Empty = all available tools.' },
        trigger_type: { type: 'string', description: 'Trigger type: cron (scheduled), manual (on-demand). Default: manual' },
        schedule: { type: 'string', description: 'Cron expression for scheduled workflows (e.g., "cron(0 9 * * ? *)" for daily at 9am UTC)' },
        timezone: { type: 'string', description: 'Timezone for schedule (e.g., "America/New_York"). Default: UTC' },
        max_turns: { type: 'number', description: 'Max tool-use iterations. Default: 10' },
      },
      required: ['name', 'prompt'],
    },
  },
  {
    name: 'fable_list_workflows',
    description: 'List all workflows for the current organization.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'fable_get_workflow',
    description: 'Get details of a specific workflow by ID or name.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'Workflow ID' },
        name: { type: 'string', description: 'Workflow name (fuzzy match)' },
      },
    },
  },
  {
    name: 'fable_update_workflow',
    description: 'Update a workflow\'s configuration, prompt, or schedule.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'Workflow ID to update' },
        name: { type: 'string', description: 'New name' },
        description: { type: 'string', description: 'New description' },
        prompt: { type: 'string', description: 'New prompt' },
        system_prompt: { type: 'string', description: 'New system prompt' },
        model: { type: 'string', description: 'New model' },
        tools: { type: 'array', items: { type: 'string' }, description: 'New tool list' },
        schedule: { type: 'string', description: 'New cron expression' },
        timezone: { type: 'string', description: 'New timezone' },
        max_turns: { type: 'number', description: 'New max turns' },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'fable_delete_workflow',
    description: 'Delete a workflow and its EventBridge schedule (if any).',
    input_schema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'Workflow ID to delete' },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'fable_run_workflow',
    description: 'Run a workflow immediately (manual trigger). The workflow executes asynchronously.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'Workflow ID to run' },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'fable_pause_workflow',
    description: 'Pause or resume a workflow. Paused workflows will not run on schedule.',
    input_schema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'Workflow ID' },
        action: { type: 'string', description: '"pause" or "resume"' },
      },
      required: ['workflow_id', 'action'],
    },
  },
  {
    name: 'fable_start_build',
    description: 'Start building a new tool after gathering requirements from the user. Call this when you have a clear understanding of what the user wants built and they have confirmed the requirements. Include a structured specification.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name in kebab-case (e.g. "text-readability-checker")' },
        description: { type: 'string', description: 'Clear, detailed description of what the tool does, including expected behavior' },
        schema: {
          type: 'object',
          description: 'MCP tool schema defining the tool interface',
          properties: {
            name: { type: 'string', description: 'Tool name (same as above)' },
            description: { type: 'string', description: 'Tool description for MCP discovery' },
            inputSchema: { type: 'object', description: 'JSON Schema for tool inputs (properties, required fields, types, descriptions)' },
          },
          required: ['name', 'description', 'inputSchema'],
        },
        uxHints: { type: 'string', description: 'UI/UX guidance for the builder: how results should be displayed (simple summary vs detailed breakdown), what matters most to the user, target audience, preferred result format (cards, table, summary). Include any user preferences that affect the tool UI.' },
      },
      required: ['name', 'description', 'schema'],
    },
  },
  {
    name: 'fable_remember_preference',
    description: 'Save a user preference or pattern for future conversations. Use this when the user explicitly states a preference (e.g., "I prefer simple UIs", "always use metric units") or when you notice a consistent pattern in their requests. Do NOT call this for one-off task instructions — only for durable preferences. Set shared=true for team/org-wide preferences (e.g., "Our team uses snake_case for APIs").',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The preference to remember (e.g., "User prefers detailed technical explanations", "User likes tools with example buttons")' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization (e.g., ["ui", "style"], ["communication"])' },
        shared: { type: 'boolean', description: 'If true, this preference is shared with all users in the organization. Use for team-wide conventions.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'fable_start_fix',
    description: 'Start a fix build for infrastructure or frontend issues. Use this instead of fable_start_build when the user reports a bug or wants changes to existing FABLE infrastructure or UI — not when they want a new tool.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Detailed description of what needs to be fixed, including current behavior and expected behavior' },
        fixType: { type: 'string', enum: ['infrastructure', 'frontend'], description: 'Whether this is a backend/Lambda fix or a frontend/UI fix' },
        affectedFiles: { type: 'array', items: { type: 'string' }, description: 'Optional: specific files or components that likely need changes' },
      },
      required: ['description', 'fixType'],
    },
  },
  {
    name: 'fable_web_search',
    description: 'Search the web for current, real-time information. Use when the user asks about recent events, current prices, live data, news, or anything that may have changed after your training cutoff. Do NOT search for things you already know well.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — be specific and include relevant context' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fable_search_memory',
    description: 'Search your own persistent memory for knowledge, patterns, gotchas, capabilities, or anything you\'ve learned from previous builds and conversations. Use this when users ask about your capabilities, your architecture, what you\'ve built, what you know, or how you work. Also use when you need to recall specific technical details about your own system. Your memory contains everything you\'ve learned from building 28+ tools.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for — describe what you want to recall (e.g., "tabbed layout UI patterns", "how does my build pipeline work", "what tools have I built")' },
        types: { type: 'array', items: { type: 'string' }, description: 'Optional: filter by memory type (insight, gotcha, preference, pattern, capability, status)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional: filter by tags (e.g., ["frontend"], ["architecture"], ["builder"])' },
      },
      required: ['query'],
    },
  },
];

async function handleInternalTool(
  toolName: string,
  input: Record<string, unknown>,
  orgId: string,
  userId: string,
  connectionId: string,
  conversationId?: string,
): Promise<unknown> {
  switch (toolName) {
    case 'fable_create_workflow':
      return handleCreateWorkflow(input, orgId, userId, connectionId);
    case 'fable_list_workflows':
      return handleListWorkflows(orgId);
    case 'fable_get_workflow':
      return handleGetWorkflow(input, orgId);
    case 'fable_update_workflow':
      return handleUpdateWorkflow(input, orgId);
    case 'fable_delete_workflow':
      return handleDeleteWorkflow(input, orgId);
    case 'fable_run_workflow':
      return handleRunWorkflow(input, orgId, userId, connectionId);
    case 'fable_pause_workflow':
      return handlePauseWorkflow(input, orgId);
    case 'fable_remember_preference':
      return handleRememberPreference(input, orgId, userId);
    case 'fable_start_build':
      return handleStartBuild(input, orgId, userId, connectionId, conversationId);
    case 'fable_start_fix':
      return handleStartFix(input, orgId, userId, connectionId, conversationId);
    case 'fable_web_search':
      return handleWebSearch(input);
    case 'fable_search_memory':
      return handleSearchMemory(input, orgId, userId);
    default:
      throw new Error(`Unknown internal tool: ${toolName}`);
  }
}

// ---------------------------------------------------------------------------
// Workflow CRUD handlers
// ---------------------------------------------------------------------------

async function handleCreateWorkflow(
  input: Record<string, unknown>,
  orgId: string,
  userId: string,
  connectionId: string,
): Promise<unknown> {
  const workflowId = crypto.randomUUID();
  const now = new Date().toISOString();
  const triggerType = (input.trigger_type as string) || 'manual';
  const schedule = input.schedule as string | undefined;
  const timezone = (input.timezone as string) || 'UTC';

  const item: Record<string, unknown> = {
    PK: `ORG#${orgId}`,
    SK: `WORKFLOW#${workflowId}`,
    workflowId,
    name: input.name,
    description: input.description || '',
    prompt: input.prompt,
    systemPrompt: input.system_prompt || null,
    model: input.model || 'sonnet',
    tools: input.tools || [],
    trigger: { type: triggerType, schedule, timezone },
    status: 'active',
    maxTurns: input.max_turns || 10,
    orgId,
    userId,
    createdAt: now,
    updatedAt: now,
    executionCount: 0,
    // GSI1: user-scoped query
    GSI1PK: `USER#${userId}`,
    GSI1SK: `WORKFLOW#${now}`,
  };

  // If cron trigger, create EventBridge schedule
  let eventBridgeRuleName: string | undefined;
  if (triggerType === 'cron' && schedule) {
    eventBridgeRuleName = `fable-${STAGE}-wf-${workflowId.slice(0, 8)}`;
    await schedulerClient.send(new CreateScheduleCommand({
      Name: eventBridgeRuleName,
      ScheduleExpression: schedule,
      ScheduleExpressionTimezone: timezone,
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: WORKFLOW_EXECUTOR_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({
          workflowId,
          orgId,
          userId,
          connectionId,
          trigger: 'cron',
        }),
      },
      State: 'ENABLED',
    }));
    item.eventBridgeRuleName = eventBridgeRuleName;
  }

  await docClient.send(new PutCommand({
    TableName: WORKFLOWS_TABLE,
    Item: item,
  }));

  return {
    success: true,
    workflowId,
    name: input.name,
    status: 'active',
    trigger: triggerType,
    schedule: schedule || null,
    eventBridgeRule: eventBridgeRuleName || null,
  };
}

async function handleListWorkflows(orgId: string): Promise<unknown> {
  const result = await docClient.send(new QueryCommand({
    TableName: WORKFLOWS_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `ORG#${orgId}`,
      ':prefix': 'WORKFLOW#',
    },
  }));

  const workflows = (result.Items || []).map(item => ({
    workflowId: item.workflowId,
    name: item.name,
    description: item.description,
    status: item.status,
    trigger: item.trigger,
    model: item.model,
    lastExecutedAt: item.lastExecutedAt || null,
    executionCount: item.executionCount || 0,
    createdAt: item.createdAt,
  }));

  return { workflows, count: workflows.length };
}

async function handleGetWorkflow(input: Record<string, unknown>, orgId: string): Promise<unknown> {
  if (input.workflow_id) {
    const result = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${input.workflow_id}` },
    }));

    if (!result.Item) return { error: 'Workflow not found' };

    // Also get recent executions
    const execResult = await docClient.send(new QueryCommand({
      TableName: WORKFLOWS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `WORKFLOW#${input.workflow_id}`,
        ':prefix': 'EXEC#',
      },
      ScanIndexForward: false,
      Limit: 5,
    }));

    return {
      ...result.Item,
      recentExecutions: (execResult.Items || []).map(e => ({
        executionId: e.executionId,
        status: e.status,
        trigger: e.trigger,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        result: e.result,
        error: e.error,
      })),
    };
  }

  // Fuzzy name match
  if (input.name) {
    const searchName = (input.name as string).toLowerCase();
    const allWorkflows = await docClient.send(new QueryCommand({
      TableName: WORKFLOWS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `ORG#${orgId}`,
        ':prefix': 'WORKFLOW#',
      },
    }));

    const match = (allWorkflows.Items || []).find(
      item => (item.name as string).toLowerCase().includes(searchName)
    );

    if (match) return match;
    return { error: `No workflow found matching "${input.name}"` };
  }

  return { error: 'Provide workflow_id or name' };
}

async function handleUpdateWorkflow(input: Record<string, unknown>, orgId: string): Promise<unknown> {
  const workflowId = input.workflow_id as string;

  // Build update expression dynamically
  const updates: string[] = ['updatedAt = :now'];
  const values: Record<string, unknown> = { ':now': new Date().toISOString() };

  const fieldMap: Record<string, string> = {
    name: 'name', description: 'description', prompt: 'prompt',
    system_prompt: 'systemPrompt', model: 'model', tools: 'tools',
    max_turns: 'maxTurns',
  };

  for (const [inputKey, dbKey] of Object.entries(fieldMap)) {
    if (input[inputKey] !== undefined) {
      updates.push(`${dbKey} = :${dbKey}`);
      values[`:${dbKey}`] = input[inputKey];
    }
  }

  await docClient.send(new UpdateCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
    UpdateExpression: `SET ${updates.join(', ')}`,
    ExpressionAttributeValues: values,
    ConditionExpression: 'attribute_exists(PK)',
  }));

  // Update EventBridge schedule if schedule changed
  if (input.schedule) {
    const existing = await docClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
    }));

    if (existing.Item?.eventBridgeRuleName) {
      await schedulerClient.send(new UpdateScheduleCommand({
        Name: existing.Item.eventBridgeRuleName,
        ScheduleExpression: input.schedule as string,
        ScheduleExpressionTimezone: (input.timezone as string) || existing.Item.trigger?.timezone || 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: {
          Arn: WORKFLOW_EXECUTOR_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
          Input: JSON.stringify({
            workflowId,
            orgId,
            userId: existing.Item.userId,
            trigger: 'cron',
          }),
        },
      }));
    }
  }

  return { success: true, workflowId, updated: Object.keys(fieldMap).filter(k => input[k] !== undefined) };
}

async function handleDeleteWorkflow(input: Record<string, unknown>, orgId: string): Promise<unknown> {
  const workflowId = input.workflow_id as string;

  // Get workflow to check for EventBridge rule
  const existing = await docClient.send(new GetCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
  }));

  if (!existing.Item) return { error: 'Workflow not found' };

  // Delete EventBridge schedule if exists
  if (existing.Item.eventBridgeRuleName) {
    try {
      await schedulerClient.send(new DeleteScheduleCommand({
        Name: existing.Item.eventBridgeRuleName,
      }));
    } catch (e) {
      console.warn('Failed to delete EventBridge schedule:', e);
    }
  }

  // Delete workflow record
  await docClient.send(new DeleteCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
  }));

  return { success: true, deleted: workflowId, name: existing.Item.name };
}

async function handleRunWorkflow(
  input: Record<string, unknown>,
  orgId: string,
  userId: string,
  connectionId: string,
): Promise<unknown> {
  const workflowId = input.workflow_id as string;

  // Verify workflow exists and is active
  const existing = await docClient.send(new GetCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
  }));

  if (!existing.Item) return { error: 'Workflow not found' };
  if (existing.Item.status !== 'active') return { error: `Workflow is ${existing.Item.status}` };

  // Invoke workflow executor asynchronously
  await lambdaClient.send(new InvokeCommand({
    FunctionName: WORKFLOW_EXECUTOR_ARN,
    InvocationType: 'Event', // Async invocation
    Payload: JSON.stringify({
      workflowId,
      orgId,
      userId,
      connectionId,
      trigger: 'manual',
    }),
  }));

  return {
    success: true,
    message: `Workflow "${existing.Item.name}" is now running. You'll be notified when it completes.`,
    workflowId,
  };
}

async function handleRememberPreference(
  input: Record<string, unknown>,
  orgId: string,
  userId: string,
): Promise<unknown> {
  const content = input.content as string;
  const tags = (input.tags as string[]) || ['preference'];
  const shared = input.shared === true;
  const scope = shared ? 'project' : 'user'; // 'project' maps to org-level in memory DB

  try {
    const response = await lambdaClient.send(new InvokeCommand({
      FunctionName: MEMORY_LAMBDA_ARN,
      Payload: JSON.stringify({
        action: 'create',
        payload: {
          type: 'preference',
          content,
          scope,
          source: 'user_stated',
          importance: shared ? 0.9 : 0.8, // Org-wide preferences are slightly more important
          tags: shared ? [...tags, 'team', 'shared'] : tags,
          userId: toMemoryUserId(userId),
          orgId: toMemoryOrgId(orgId),
        },
      }),
    }));

    if (response.Payload) {
      const result = JSON.parse(new TextDecoder().decode(response.Payload));
      const body = JSON.parse(result.body);

      if (body.success) {
        const shareLabel = shared ? ' (shared with your team)' : '';
        return { success: true, message: `I'll remember that${shareLabel}: "${content}"` };
      }
    }

    return { success: false, error: 'Failed to save preference' };
  } catch (error) {
    console.error('Error saving preference:', error);
    return { success: false, error: 'Failed to save preference' };
  }
}

async function handleSearchMemory(
  input: Record<string, unknown>,
  orgId: string,
  userId: string,
): Promise<unknown> {
  const query = input.query as string;
  const types = input.types as string[] | undefined;
  const tags = input.tags as string[] | undefined;

  try {
    const response = await lambdaClient.send(new InvokeCommand({
      FunctionName: MEMORY_LAMBDA_ARN,
      Payload: JSON.stringify({
        action: 'search',
        payload: {
          query,
          userId: toMemoryUserId(userId),
          orgId: toMemoryOrgId(orgId),
          scopes: ['user', 'org', 'global'],
          types: types || null,
          tags: tags || null,
          limit: 10,
        },
      }),
    }));

    if (response.Payload) {
      const result = JSON.parse(new TextDecoder().decode(response.Payload));
      const body = JSON.parse(result.body);

      if (body.success && body.memories) {
        const memories = body.memories
          .filter((m: MemoryResult) => (m.score ?? m.similarity) >= 0.3)
          .map((m: MemoryResult) => ({
            type: m.type,
            content: m.content,
            tags: m.tags || [],
            relevance: Math.round((m.score ?? m.similarity) * 100),
          }));

        if (memories.length === 0) {
          return { success: true, results: [], message: `No memories found matching "${query}". I may not have learned about this topic yet.` };
        }

        return {
          success: true,
          results: memories,
          message: `Found ${memories.length} relevant memories.`,
        };
      }
    }

    return { success: false, error: 'Memory search failed' };
  } catch (error) {
    console.error('Error searching memory:', error);
    return { success: false, error: 'Memory search failed' };
  }
}

async function handleStartBuild(
  input: Record<string, unknown>,
  orgId: string,
  userId: string,
  connectionId: string,
  conversationId?: string,
): Promise<unknown> {
  const name = input.name as string;
  const description = input.description as string;
  const schema = input.schema as Record<string, unknown>;
  const uxHints = input.uxHints as string | undefined;

  console.log(`Starting build for tool: ${name}`);

  // Build a rich request string that includes the structured spec
  let request = `Build an MCP tool called "${name}".

Description: ${description}

MCP Schema:
${JSON.stringify(schema, null, 2)}`;

  if (uxHints) {
    request += `

UX Design Notes (from conversation with user):
${uxHints}

Use these UX notes to inform the uiDefinition — form labels, result display type (cards/table/text), summaryTemplate, and examples.`;
  }

  // Invoke build-kickoff Lambda
  const response = await lambdaClient.send(new InvokeCommand({
    FunctionName: BUILD_KICKOFF_ARN,
    Payload: JSON.stringify({
      action: 'start',
      payload: {
        request,
        userId,
        orgId,
        conversationId,
      },
    }),
  }));

  if (response.Payload) {
    const result = JSON.parse(new TextDecoder().decode(response.Payload));
    const body = JSON.parse(result.body);

    if (body.success) {
      // Update conversation with active build ID
      if (conversationId) {
        try {
          await docClient.send(new UpdateCommand({
            TableName: CONVERSATIONS_TABLE,
            Key: { PK: `USER#${userId}`, SK: `CONV#${conversationId}` },
            UpdateExpression: 'SET activeBuildId = :buildId, updatedAt = :now',
            ExpressionAttributeValues: {
              ':buildId': body.buildId,
              ':now': new Date().toISOString(),
            },
          }));
        } catch (err) {
          console.error('Failed to update conversation with buildId:', err);
        }
      }

      // Notify client about build start
      await sendToConnection(connectionId, {
        type: 'build_started',
        payload: { buildId: body.buildId, toolName: name },
      });

      return {
        success: true,
        buildId: body.buildId,
        message: `Build started for "${name}". I'll notify you when it's ready.`,
      };
    }

    return { success: false, error: body.error || 'Failed to start build' };
  }

  return { success: false, error: 'No response from build kickoff' };
}

async function handleStartFix(
  input: Record<string, unknown>,
  orgId: string,
  userId: string,
  connectionId: string,
  conversationId?: string,
): Promise<unknown> {
  const description = input.description as string;
  const fixType = input.fixType as string;
  const affectedFiles = input.affectedFiles as string[] | undefined;

  console.log(`Starting ${fixType} fix build`);

  // Build a request string that clearly signals this is a fix, not a tool build
  let request = `This is a ${fixType} fix request, not a tool build.\n\n${description}`;
  if (affectedFiles?.length) {
    request += `\n\nLikely affected files:\n${affectedFiles.map(f => `- ${f}`).join('\n')}`;
  }

  // Same invocation path as tool builds — calls build-kickoff Lambda
  const response = await lambdaClient.send(new InvokeCommand({
    FunctionName: BUILD_KICKOFF_ARN,
    Payload: JSON.stringify({
      action: 'start',
      payload: {
        request,
        userId,
        orgId,
        conversationId,
      },
    }),
  }));

  if (response.Payload) {
    const result = JSON.parse(new TextDecoder().decode(response.Payload));
    const body = JSON.parse(result.body);

    if (body.success) {
      if (conversationId) {
        try {
          await docClient.send(new UpdateCommand({
            TableName: CONVERSATIONS_TABLE,
            Key: { PK: `USER#${userId}`, SK: `CONV#${conversationId}` },
            UpdateExpression: 'SET activeBuildId = :buildId, updatedAt = :now',
            ExpressionAttributeValues: {
              ':buildId': body.buildId,
              ':now': new Date().toISOString(),
            },
          }));
        } catch (err) {
          console.error('Failed to update conversation with buildId:', err);
        }
      }

      await sendToConnection(connectionId, {
        type: 'build_started',
        payload: { buildId: body.buildId, fixType },
      });

      return {
        success: true,
        buildId: body.buildId,
        message: `${fixType === 'frontend' ? 'Frontend' : 'Infrastructure'} fix build started. I'll notify you when it's deployed.`,
      };
    }

    return { success: false, error: body.error || 'Failed to start fix build' };
  }

  return { success: false, error: 'No response from build kickoff' };
}

async function handleWebSearch(input: Record<string, unknown>): Promise<unknown> {
  const query = input.query as string;
  if (!query) return { error: 'No query provided' };
  if (!GEMINI_API_KEY) return { error: 'Web search not configured (no API key)' };

  console.log(`Web search: "${query}"`);

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: query }] }],
          tools: [{ google_search: {} }],
        }),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Gemini search failed:', resp.status, errText);
      return { error: `Search failed (${resp.status})` };
    }

    const data = await resp.json() as Record<string, unknown>;
    const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
    const candidate = candidates?.[0];
    const content = candidate?.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, unknown>> | undefined;
    const text = (parts?.[0]?.text as string) || '';
    const metadata = candidate?.groundingMetadata as Record<string, unknown> | undefined;
    const chunks = metadata?.groundingChunks as Array<Record<string, unknown>> | undefined;
    const sources = (chunks || []).map((c) => {
      const web = c.web as Record<string, string> | undefined;
      return {
        title: web?.title || '',
        url: web?.uri || '',
      };
    });

    console.log(`Web search returned ${text.length} chars, ${sources.length} sources`);
    return { answer: text, sources, query };
  } catch (error) {
    console.error('Web search error:', error);
    return { error: `Search failed: ${String(error)}` };
  }
}

async function saveAssistantMessage(userId: string, conversationId: string, content: string): Promise<void> {
  try {
    const existing = await docClient.send(new GetCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { PK: `USER#${userId}`, SK: `CONV#${conversationId}` },
    }));

    if (!existing.Item) return;

    const now = new Date().toISOString();
    const messages = (existing.Item.messages || []) as Array<{ role: string; content: string; timestamp: string }>;
    messages.push({ role: 'assistant', content, timestamp: now });

    // Cap at last 50 messages
    const capped = messages.slice(-50);

    await docClient.send(new UpdateCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { PK: `USER#${userId}`, SK: `CONV#${conversationId}` },
      UpdateExpression: 'SET messages = :msgs, updatedAt = :now',
      ExpressionAttributeValues: {
        ':msgs': capped,
        ':now': now,
      },
    }));
  } catch (error) {
    console.error('Error saving assistant message:', error);
  }
}

async function handlePauseWorkflow(input: Record<string, unknown>, orgId: string): Promise<unknown> {
  const workflowId = input.workflow_id as string;
  const action = input.action as string; // 'pause' or 'resume'

  const newStatus = action === 'pause' ? 'paused' : 'active';

  // Update status in DynamoDB
  await docClient.send(new UpdateCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
    UpdateExpression: 'SET #s = :status, updatedAt = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':status': newStatus,
      ':now': new Date().toISOString(),
    },
    ConditionExpression: 'attribute_exists(PK)',
  }));

  // Enable/disable EventBridge schedule if it exists
  const existing = await docClient.send(new GetCommand({
    TableName: WORKFLOWS_TABLE,
    Key: { PK: `ORG#${orgId}`, SK: `WORKFLOW#${workflowId}` },
  }));

  if (existing.Item?.eventBridgeRuleName) {
    try {
      const schedule = await schedulerClient.send(new GetScheduleCommand({
        Name: existing.Item.eventBridgeRuleName,
      }));

      await schedulerClient.send(new UpdateScheduleCommand({
        Name: existing.Item.eventBridgeRuleName,
        ScheduleExpression: schedule.ScheduleExpression!,
        ScheduleExpressionTimezone: schedule.ScheduleExpressionTimezone,
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: schedule.Target!,
        State: action === 'pause' ? 'DISABLED' : 'ENABLED',
      }));
    } catch (e) {
      console.warn('Failed to update EventBridge schedule state:', e);
    }
  }

  return { success: true, workflowId, status: newStatus };
}
