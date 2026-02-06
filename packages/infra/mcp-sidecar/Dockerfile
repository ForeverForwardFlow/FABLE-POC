# FABLE MCP Memory Sidecar
# Stdio MCP server that bridges to the Memory Lambda

FROM node:20-slim

WORKDIR /app

# Copy package files
COPY packages/infra/mcp-sidecar/package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY packages/infra/mcp-sidecar/tsconfig.json ./
COPY packages/infra/mcp-sidecar/src ./src

# Build TypeScript
RUN npm run build

# The sidecar runs as a stdio server - Claude Code connects via stdin/stdout
CMD ["node", "dist/index.js"]
