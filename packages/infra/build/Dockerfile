# FABLE Build Container
# Runs Claude Code CLI with Amazon Bedrock for autonomous builds
#
# Build from FABLE repo root:
#   docker build -f packages/infra/build/Dockerfile -t fable-build .

FROM node:20-slim

# Install system dependencies (including Playwright browser prerequisites)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    unzip \
    zip \
    jq \
    openssl \
    # Playwright browser dependencies
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI v2
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws

# Install Claude Code CLI, Playwright MCP, and Playwright test runner
RUN npm install -g @anthropic-ai/claude-code @playwright/mcp @playwright/test

# Install Playwright browsers (Chromium only to save space)
RUN npx @playwright/mcp install-browsers chromium || npx playwright install chromium || true

# Create non-root user for Claude Code (required for --dangerously-skip-permissions)
RUN groupadd -r fable && useradd -r -g fable -d /fable -s /bin/bash fable

# Create working directory and set ownership
WORKDIR /fable
RUN mkdir -p /fable/work /fable/templates && chown -R fable:fable /fable

# Copy active FABLE templates (build context is FABLE repo root)
COPY --chown=fable:fable templates/ /fable/templates/

# Build MCP Memory Sidecar (stdio bridge to Memory Lambda)
COPY packages/infra/mcp-sidecar/package*.json /fable/mcp-sidecar/
WORKDIR /fable/mcp-sidecar
RUN npm install
COPY packages/infra/mcp-sidecar/tsconfig.json /fable/mcp-sidecar/
COPY packages/infra/mcp-sidecar/src /fable/mcp-sidecar/src
RUN npm run build
RUN chown -R fable:fable /fable/mcp-sidecar
WORKDIR /fable

# Copy entrypoint script
COPY --chown=fable:fable packages/infra/build/entrypoint.sh /fable/entrypoint.sh
RUN chmod +x /fable/entrypoint.sh

# Environment variables for Bedrock
ENV CLAUDE_CODE_USE_BEDROCK=1
ENV AWS_REGION=us-west-2
ENV CLAUDE_CODE_SKIP_OOBE=1
ENV DISABLE_AUTOUPDATER=1
ENV HOME=/fable

# Switch to non-root user
USER fable

# The build spec and phase are passed via environment variables:
# - FABLE_BUILD_SPEC: JSON spec from CORE or the build request
# - FABLE_PHASE: "builder"
# - FABLE_WORK_DIR: Where to do the work (default /fable/work)

ENTRYPOINT ["/fable/entrypoint.sh"]
