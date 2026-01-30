# MCP Server Patterns

## Dual Transport Architecture

Every MCP server supports both local (stdio) and remote (HTTP) deployment:

```
server-name/
├── src/
│   ├── server-setup.ts   # Shared: createServer(), tool handlers
│   ├── index.ts          # Entry: StdioServerTransport (local)
│   ├── worker.ts         # Entry: HTTP transport (Cloudflare)
│   ├── tools/            # One file per tool
│   │   └── tool-name.ts
│   └── types.ts          # Zod schemas for inputs/outputs
├── __tests__/            # Unit tests
├── wrangler.toml         # Cloudflare Workers config
├── tsconfig.worker.json  # Worker-specific tsconfig
├── package.json
└── tsconfig.json
```

### Key Separation

- **server-setup.ts**: Tool registration, request handlers — shared by both transports
- **index.ts**: Local stdio entry point
- **worker.ts**: Cloudflare Workers entry point with auth

## Tool Implementation

```typescript
import { z } from 'zod';

// 1. Define input schema
export const InputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().default(10),
  dry_run: z.boolean().default(false), // Required for write operations
});

// 2. Implement tool
export async function toolName(input: z.infer<typeof InputSchema>) {
  const validated = InputSchema.parse(input);

  if (validated.dry_run) {
    return { would_do: 'description of action', dry_run: true };
  }

  // Actual implementation
  return { result: 'data' };
}
```

## Requirements

1. Every tool has a Zod input schema
2. Write operations support `dry_run: true` parameter
3. Return structured data, never throw unhandled exceptions
4. Mock external APIs in tests

## Testing

- Test success paths with valid input
- Test error paths with invalid input
- Test edge cases (empty arrays, null values, limits)
- Mock all external API calls

## Connecting to MCP Servers

### Local (Stdio)

```typescript
import { connectToMcpServer, callTool, disconnectFromMcpServer } from './utils/mcp-client.js';

const connection = await connectToMcpServer({
  name: 'greeting',
  command: 'node',
  args: ['packages/mcp-servers/greeting/dist/index.js'],
});
const result = await callTool(connection.client, 'greet', { name: 'World' });
await disconnectFromMcpServer(connection);
```

### Remote (HTTP)

```typescript
import { connectToRemoteMcpServer, callRemoteTool } from './utils/mcp-client.js';

const connection = await connectToRemoteMcpServer({
  name: 'greeting',
  url: 'https://mcp-greeting.workers.dev/mcp',
  apiKey: process.env.MCP_GREETING_API_KEY,
});
const result = await callRemoteTool(connection, 'greet', { name: 'World' });
```

## Deployment

```bash
# Local development with wrangler
npm run dev:worker

# Deploy to Cloudflare
npx wrangler secret put MCP_API_KEY  # Set secret once
npm run deploy
```

GitHub Actions deploys automatically on push to main for MCP server paths.
