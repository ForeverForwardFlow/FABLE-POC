#!/bin/bash
set -e

# FABLE Build Entrypoint
# Executes Claude Code with the appropriate template for each phase

echo "=== FABLE Build Container Starting ==="
echo "Phase: ${FABLE_PHASE:-core}"
echo "Work dir: ${FABLE_WORK_DIR:-/fable/work}"

# Set defaults
PHASE="${FABLE_PHASE:-core}"
WORK_DIR="${FABLE_WORK_DIR:-/fable/work}"
BUILD_SPEC="${FABLE_BUILD_SPEC:-}"

# Setup GitHub App authentication (for persistent repos)
setup_github_auth() {
    if [ -z "$GITHUB_SECRET_ARN" ]; then
        echo "GITHUB_SECRET_ARN not set, skipping GitHub auth"
        return
    fi

    echo "=== Setting up GitHub authentication ==="

    # Fetch GitHub App credentials from Secrets Manager
    SECRET=$(aws secretsmanager get-secret-value --secret-id "$GITHUB_SECRET_ARN" --query SecretString --output text)
    APP_ID=$(echo "$SECRET" | jq -r '.appId')
    PRIVATE_KEY=$(echo "$SECRET" | jq -r '.privateKey')
    INSTALLATION_ID=$(echo "$SECRET" | jq -r '.installationId')

    # Generate JWT (valid for 10 minutes)
    NOW=$(date +%s)
    IAT=$((NOW - 60))
    EXP=$((NOW + 600))

    # Create JWT header and payload (base64url encoded)
    HEADER=$(echo -n '{"alg":"RS256","typ":"JWT"}' | base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n')
    PAYLOAD=$(echo -n "{\"iat\":$IAT,\"exp\":$EXP,\"iss\":\"$APP_ID\"}" | base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n')

    # Sign with the private key
    SIGNATURE=$(echo -n "$HEADER.$PAYLOAD" | openssl dgst -sha256 -sign <(echo "$PRIVATE_KEY") | base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n')
    JWT="$HEADER.$PAYLOAD.$SIGNATURE"

    # Exchange JWT for installation access token
    TOKEN_RESPONSE=$(curl -s -X POST \
        -H "Authorization: Bearer $JWT" \
        -H "Accept: application/vnd.github+json" \
        "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens")

    TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token')

    if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
        echo "ERROR: Failed to get GitHub token"
        echo "Response: $TOKEN_RESPONSE"
        return 1
    fi

    # Configure git credentials
    mkdir -p ~/.config/git
    echo "https://x-access-token:$TOKEN@github.com" > ~/.git-credentials
    git config --global credential.helper store

    # Export repo info for templates to use
    export FABLE_GITHUB_REPO="$(echo "$SECRET" | jq -r '.repoOwner')/$(echo "$SECRET" | jq -r '.repoName')"
    export FABLE_GITHUB_TOKEN="$TOKEN"

    echo "GitHub auth configured for repo: $FABLE_GITHUB_REPO"
}

# Setup GitHub auth (if credentials available)
setup_github_auth

# Setup MCP memory server configuration and hooks
setup_mcp_config() {
    if [ -z "$MEMORY_LAMBDA_URL" ]; then
        echo "MEMORY_LAMBDA_URL not set, skipping MCP config"
        return
    fi

    echo "=== Setting up MCP memory server (stdio sidecar) ==="

    # Create Claude config directories
    mkdir -p ~/.claude/hooks

    # Write MCP server configuration
    # Using stdio transport - spawns sidecars as subprocesses
    # NOTE: Playwright MCP is only added for OI phase (which may need browser verification)
    # CORE and Worker phases never use Playwright. Including it for all phases caused
    # silent hangs when npx @latest triggered npm registry checks in Fargate.
    if [ "$PHASE" = "oi" ]; then
        cat > ~/.claude.json << EOF
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/fable/mcp-sidecar/dist/index.js"],
      "env": {
        "MEMORY_LAMBDA_URL": "$MEMORY_LAMBDA_URL",
        "FABLE_BUILD_ID": "${FABLE_BUILD_ID:-unknown}",
        "FABLE_ORG_ID": "${FABLE_ORG_ID:-00000000-0000-0000-0000-000000000001}"
      }
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp"]
    }
  }
}
EOF
    else
        cat > ~/.claude.json << EOF
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/fable/mcp-sidecar/dist/index.js"],
      "env": {
        "MEMORY_LAMBDA_URL": "$MEMORY_LAMBDA_URL",
        "FABLE_BUILD_ID": "${FABLE_BUILD_ID:-unknown}",
        "FABLE_ORG_ID": "${FABLE_ORG_ID:-00000000-0000-0000-0000-000000000001}"
      }
    }
  }
}
EOF
    fi

    # Write memory reflection hook for automated builds
    cat > ~/.claude/hooks/memory-reflection.sh << 'HOOKEOF'
#!/bin/bash
# Memory Reflection Stop Hook for FABLE builds
# Prompts for learnings capture before exit (once per session)

set -euo pipefail

HOOK_INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path')
SESSION_HASH=$(echo "$TRANSCRIPT_PATH" | md5sum | cut -c1-8)
REFLECTION_STATE="/tmp/memory-reflection-$SESSION_HASH"

# Skip if already prompted this session
if [[ -f "$REFLECTION_STATE" ]]; then
  rm -f "$REFLECTION_STATE"
  exit 0
fi

touch "$REFLECTION_STATE"

jq -n '{
  "decision": "block",
  "reason": "Before completing, capture any insights or gotchas from this build using mcp__memory__memory_create. If nothing notable, say done.",
  "systemMessage": "Memory capture prompt"
}'
HOOKEOF
    chmod +x ~/.claude/hooks/memory-reflection.sh

    # Write settings.json with hooks (use absolute path, not $HOME)
    HOOK_PATH="$HOME/.claude/hooks/memory-reflection.sh"
    cat > ~/.claude/settings.json << EOF
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOK_PATH",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
EOF

    echo "MCP memory server configured: $MEMORY_LAMBDA_URL"
    echo "Memory reflection hook configured at: $HOOK_PATH"

    # Also copy .claude.json to work directory (Claude Code looks there too)
    export CLAUDE_CONFIG_WRITTEN="true"
}

# Function to copy MCP config to work directory (called after cd to work dir)
copy_mcp_config_to_workdir() {
    if [ "$CLAUDE_CONFIG_WRITTEN" = "true" ] && [ -f ~/.claude.json ]; then
        cp ~/.claude.json ./.claude.json
        echo "MCP config copied to work directory"
    fi
}

# Setup MCP config (if memory Lambda URL available)
# Now using stdio sidecar instead of HTTP transport (HTTP caused hangs)
setup_mcp_config

# Validate required inputs
if [ -z "$BUILD_SPEC" ]; then
    echo "ERROR: FABLE_BUILD_SPEC environment variable is required"
    exit 1
fi

# Create and initialize work directory
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# Copy MCP config to work directory
copy_mcp_config_to_workdir

# Initialize git if not already a repo
if [ ! -d ".git" ]; then
    git init
    git config user.email "fable@fable.ai"
    git config user.name "FABLE"
fi

# Copy the appropriate CLAUDE.md template
case "$PHASE" in
    core)
        cp /fable/templates/CLAUDE.md.core-base ./CLAUDE.md
        echo ""
        echo "=== Running FABLE-CORE ==="
        ;;
    oi)
        cp /fable/templates/CLAUDE.md.oi-base ./CLAUDE.md
        echo ""
        echo "=== Running FABLE-OI ==="
        ;;
    worker)
        cp /fable/templates/CLAUDE.md.worker-base ./CLAUDE.md
        echo ""
        echo "=== Running FABLE-Worker ==="
        ;;
    *)
        echo "ERROR: Unknown phase: $PHASE"
        echo "Valid phases: core, oi, worker"
        exit 1
        ;;
esac

# Write the build spec to the work directory (so Claude can access it)
echo "$BUILD_SPEC" > ./build-spec.json

# Create .fable directory for logs and state
mkdir -p .fable/logs

# Run Claude Code with the build spec
# The template CLAUDE.md instructs Claude how to process the spec
echo ""
echo "=== Starting Claude Code ==="
echo "Build spec: $(echo $BUILD_SPEC | head -c 200)..."
echo ""

# For CORE phase: one-shot execution that creates specs and templates
# For OI phase: runs the orchestration loop (manages workers)
# For Worker phase: implements specific tasks

# Debug: Show claude version and help
echo "Claude CLI version:"
claude --version || echo "Could not get version"
echo ""

# Set the prompt based on phase
if [ "$PHASE" = "core" ]; then
    # CORE is one-shot - creates the decomposition
    PROMPT="Read build-spec.json and execute the CORE phase as described in CLAUDE.md. Output the result to output.json"
elif [ "$PHASE" = "oi" ]; then
    # OI runs the Ralph Wiggum loop until done or stopped
    PROMPT="Read build-spec.json and execute the OI phase as described in CLAUDE.md. Spawn workers as needed. Output the final result to output.json"
else
    # Worker implements a specific task
    PROMPT="Read build-spec.json and implement the task as described in CLAUDE.md. Output the result to output.json"
fi

echo "Running Claude with prompt: $PROMPT"
echo ""

# Run Claude Code with hang detection
# Claude should produce output within STARTUP_TIMEOUT seconds.
# If it doesn't, MCP server initialization likely hung (known issue with npx registry checks).
STARTUP_TIMEOUT=300  # 5 minutes
CLAUDE_OUTPUT="/tmp/claude-output-$$"

# Start Claude in background, capturing output to file
claude -p "$PROMPT" --dangerously-skip-permissions > "$CLAUDE_OUTPUT" 2>&1 &
CLAUDE_PID=$!

# Stream output to CloudWatch in real-time
tail -f "$CLAUDE_OUTPUT" 2>/dev/null &
TAIL_PID=$!

# Monitor for startup hang - check every 10 seconds
ELAPSED=0
HAS_OUTPUT=false
while [ $ELAPSED -lt $STARTUP_TIMEOUT ]; do
    # Check if Claude has exited (success or failure)
    if ! kill -0 $CLAUDE_PID 2>/dev/null; then
        HAS_OUTPUT=true
        break
    fi

    # Check if any output has been produced
    if [ -s "$CLAUDE_OUTPUT" ]; then
        HAS_OUTPUT=true
        break
    fi

    sleep 10
    ELAPSED=$((ELAPSED + 10))
    echo "  [watchdog] Waiting for Claude output... ${ELAPSED}s elapsed"
done

if [ "$HAS_OUTPUT" = "true" ]; then
    # Claude is producing output or has exited - wait for completion
    wait $CLAUDE_PID 2>/dev/null || {
        EXIT_CODE=$?
        echo "Claude exited with code: $EXIT_CODE"
    }
else
    # Claude hung - no output after STARTUP_TIMEOUT
    echo ""
    echo "=== HANG DETECTED: Claude produced no output after ${STARTUP_TIMEOUT}s ==="
    echo "Dumping diagnostics..."
    echo ""
    echo "--- Process tree ---"
    ps auxf 2>/dev/null || ps aux
    echo ""
    echo "--- Memory usage ---"
    free -m 2>/dev/null || cat /proc/meminfo 2>/dev/null || echo "Cannot read memory info"
    echo ""
    echo "--- MCP config ---"
    cat ~/.claude.json 2>/dev/null || echo "No MCP config found"
    echo ""

    # Kill the hung process tree
    echo "Killing hung Claude process (PID $CLAUDE_PID)..."
    kill $CLAUDE_PID 2>/dev/null || true
    sleep 2
    kill -9 $CLAUDE_PID 2>/dev/null || true
    wait $CLAUDE_PID 2>/dev/null || true

    echo "Claude process terminated."
fi

# Stop the tail streamer
kill $TAIL_PID 2>/dev/null || true
wait $TAIL_PID 2>/dev/null || true
rm -f "$CLAUDE_OUTPUT"

# Check for output and upload to S3
if [ -f ./output.json ]; then
    echo ""
    echo "=== Build Complete ==="
    cat ./output.json

    # Upload output to S3 for Step Functions to retrieve
    if [ -n "$ARTIFACTS_BUCKET" ] && [ -n "$FABLE_BUILD_ID" ]; then
        S3_KEY="builds/${FABLE_BUILD_ID}/${PHASE}-output.json"
        echo ""
        echo "=== Uploading output to S3 ==="
        echo "Bucket: $ARTIFACTS_BUCKET"
        echo "Key: $S3_KEY"
        aws s3 cp ./output.json "s3://${ARTIFACTS_BUCKET}/${S3_KEY}"
        echo "Upload complete"
    else
        echo "WARNING: ARTIFACTS_BUCKET or FABLE_BUILD_ID not set, skipping S3 upload"
    fi
else
    echo ""
    echo "=== Build Complete (no output.json) ==="
    echo "Check .fable/logs/ for details"

    # Create a failure output and upload to S3
    if [ -n "$ARTIFACTS_BUCKET" ] && [ -n "$FABLE_BUILD_ID" ]; then
        echo '{"success":false,"error":"No output.json produced"}' > ./output.json
        S3_KEY="builds/${FABLE_BUILD_ID}/${PHASE}-output.json"
        aws s3 cp ./output.json "s3://${ARTIFACTS_BUCKET}/${S3_KEY}"
    fi
fi
