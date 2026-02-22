#!/bin/bash
set -e

# FABLE Build Entrypoint
# Executes Claude Code with the appropriate template for each phase

# --- Real-time progress reporting ---
send_progress() {
    local phase="$1"
    local message="$2"
    local progress="${3:-}"
    local iteration="${4:-}"
    local max_iterations="${5:-}"

    echo "[PROGRESS] $phase: $message"

    if [ -z "${BUILD_PROGRESS_LAMBDA_NAME:-}" ] || [ -z "${FABLE_BUILD_ID:-}" ]; then
        return
    fi

    local payload
    payload=$(jq -n \
        --arg buildId "${FABLE_BUILD_ID}" \
        --arg orgId "${FABLE_ORG_ID:-00000000-0000-0000-0000-000000000001}" \
        --arg userId "${FABLE_USER_ID:-unknown}" \
        --arg phase "$phase" \
        --arg message "$message" \
        --arg progress "$progress" \
        --arg iteration "$iteration" \
        --arg max_iterations "$max_iterations" \
        '{buildId: $buildId, orgId: $orgId, userId: $userId, phase: $phase, message: $message}
         + (if $progress != "" then {progress: ($progress | tonumber)} else {} end)
         + (if $iteration != "" then {iteration: ($iteration | tonumber)} else {} end)
         + (if $max_iterations != "" then {maxIterations: ($max_iterations | tonumber)} else {} end)'
    )

    aws lambda invoke --function-name "$BUILD_PROGRESS_LAMBDA_NAME" \
        --cli-binary-format raw-in-base64-out \
        --payload "$payload" /tmp/progress-response.json > /dev/null 2>&1 || true
}

HEARTBEAT_PID=""

start_heartbeat() {
    local iteration="${1:-}"
    local max_iterations="${2:-}"
    local parent_pid=$$
    (
        local count=0
        while kill -0 $parent_pid 2>/dev/null; do
            sleep 30
            count=$((count + 1))
            local mins=$((count / 2))
            local secs=$((count % 2 * 30))
            send_progress "building" "Claude Code working... (${mins}m${secs}s)" "" "$iteration" "$max_iterations"
        done
    ) &
    HEARTBEAT_PID=$!
}

stop_heartbeat() {
    if [ -n "${HEARTBEAT_PID:-}" ]; then
        kill $HEARTBEAT_PID 2>/dev/null || true
        wait $HEARTBEAT_PID 2>/dev/null || true
        HEARTBEAT_PID=""
    fi
}

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

    # Export repo info for templates to use (token available via git credential helper)
    export FABLE_GITHUB_REPO="$(echo "$SECRET" | jq -r '.repoOwner')/$(echo "$SECRET" | jq -r '.repoName')"

    echo "GitHub auth configured for repo: $FABLE_GITHUB_REPO"
}

# Setup GitHub auth (if credentials available)
setup_github_auth
send_progress "initializing" "GitHub authentication complete" 10

# Setup MCP memory server configuration and hooks
setup_mcp_config() {
    if [ -z "$MEMORY_LAMBDA_NAME" ]; then
        echo "MEMORY_LAMBDA_NAME not set, skipping MCP config"
        return
    fi

    echo "=== Setting up MCP memory server (stdio sidecar) ==="

    # Create Claude config directories
    mkdir -p ~/.claude/hooks

    # Write MCP server configuration
    # Using stdio transport - spawns sidecars as subprocesses
    # Playwright MCP disabled: its tool definitions (~50+ tools) are sent with
    # every Bedrock API call, adding massive token overhead. OI without Playwright
    # completes in ~13min; with Playwright it takes 48+ min or hangs.
    # TODO: Re-enable as a focused "browser verification" step at end of OI,
    # not as an always-on MCP server.
    cat > ~/.claude.json << EOF
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/fable/mcp-sidecar/dist/index.js"],
      "env": {
        "MEMORY_LAMBDA_NAME": "$MEMORY_LAMBDA_NAME",
        "INFRA_OPS_LAMBDA_NAME": "${INFRA_OPS_LAMBDA_NAME:-}",
        "FABLE_BUILD_ID": "${FABLE_BUILD_ID:-unknown}",
        "FABLE_ORG_ID": "${FABLE_ORG_ID:-00000000-0000-0000-0000-000000000001}"
      }
    },
    "context7": {
      "command": "context7-mcp",
      "args": []
    }
  }
}
EOF

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

    echo "MCP memory server configured: $MEMORY_LAMBDA_NAME"
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
send_progress "initializing" "Build environment configured" 20

# Validate required inputs
if [ -z "$BUILD_SPEC" ]; then
    echo "ERROR: FABLE_BUILD_SPEC environment variable is required"
    exit 1
fi

# Create and initialize work directory
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# Handle S3-based buildSpec (if spec is too large for env var)
if [[ "$BUILD_SPEC" == s3://* ]]; then
    echo "=== Downloading build spec from S3 ==="
    echo "Source: $BUILD_SPEC"
    aws s3 cp "$BUILD_SPEC" ./build-spec.json
    BUILD_SPEC=$(cat ./build-spec.json)
fi

# Copy MCP config to work directory
copy_mcp_config_to_workdir

# Initialize git if not already a repo
if [ ! -d ".git" ]; then
    git init
    git config user.email "fable@fable.ai"
    git config user.name "FABLE"
fi

# Pull latest templates from S3 (falls back to Docker-baked version)
if [ -n "$ARTIFACTS_BUCKET" ] && [ -n "$STAGE" ]; then
    echo "=== Pulling latest templates from S3 ==="
    aws s3 cp "s3://${ARTIFACTS_BUCKET}/templates/CLAUDE.md.builder" \
        /fable/templates/CLAUDE.md.builder 2>/dev/null \
        || echo "No S3 template found, using baked-in version"
    # Pull skills from S3 (new skill files override Docker-baked versions)
    aws s3 sync "s3://${ARTIFACTS_BUCKET}/templates/skills/" \
        /fable/templates/skills/ 2>/dev/null \
        || echo "No S3 skills found, using baked-in versions"
    send_progress "initializing" "Templates and skills loaded" 30
fi

# Copy the CLAUDE.md template
case "$PHASE" in
    builder)
        cp /fable/templates/CLAUDE.md.builder ./CLAUDE.md
        echo ""
        echo "=== Running FABLE-Builder ==="
        ;;
    *)
        echo "ERROR: Unknown phase: $PHASE"
        echo "Valid phases: builder"
        exit 1
        ;;
esac

# Copy skills to .claude/skills/ (Claude Code discovers these automatically)
if [ -d /fable/templates/skills ]; then
    mkdir -p .claude/skills
    cp -r /fable/templates/skills/* .claude/skills/ 2>/dev/null || true
    echo "Skills loaded: $(ls .claude/skills/ 2>/dev/null | tr '\n' ', ')"
fi

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

# Debug: Show claude version
echo "Claude CLI version:"
claude --version || echo "Could not get version"
echo ""

# Build timeout enforcement (default: 15 minutes)
BUILD_TIMEOUT=${FABLE_BUILD_TIMEOUT:-900}
BUILD_START=$(date +%s)

check_timeout() {
    local elapsed=$(( $(date +%s) - BUILD_START ))
    if [ $elapsed -ge $BUILD_TIMEOUT ]; then
        echo "=== BUILD TIMEOUT: ${elapsed}s elapsed (limit: ${BUILD_TIMEOUT}s) ==="
        stop_heartbeat
        send_progress "timeout" "Build timed out after ${elapsed}s" "" "" ""
        echo "{\"status\":\"error\",\"error\":\"Build timed out after ${elapsed}s\"}" > ./output.json
        if [ -n "$ARTIFACTS_BUCKET" ] && [ -n "$FABLE_BUILD_ID" ]; then
            S3_KEY="builds/${FABLE_BUILD_ID}/${PHASE}-output.json"
            aws s3 cp ./output.json "s3://${ARTIFACTS_BUCKET}/${S3_KEY}" 2>/dev/null || true
        fi
        exit 1
    fi
}

# Inner retry loop: iterate until build succeeds or max iterations reached
MAX_ITERATIONS=${MAX_BUILDER_ITERATIONS:-3}
ITER=1

while [ $ITER -le $MAX_ITERATIONS ]; do
    echo ""
    echo "=== Builder Iteration $ITER of $MAX_ITERATIONS ==="

    if [ $ITER -eq 1 ]; then
        PROMPT="Read build-spec.json and implement the task as described in CLAUDE.md. Output the result to output.json"
    else
        PROMPT="Read build-spec.json and CLAUDE.md. Your previous attempt (iteration $((ITER-1))) failed. Read previous-attempt.json to understand what went wrong. Fix the issues and output the result to output.json"
    fi

    check_timeout

    echo "Running Claude with prompt: $PROMPT"
    echo ""

    send_progress "building" "Starting Claude Code (iteration $ITER/$MAX_ITERATIONS)" 40 "$ITER" "$MAX_ITERATIONS"
    start_heartbeat "$ITER" "$MAX_ITERATIONS"

    # Run Claude Code with timeout
    # Note: `claude -p` buffers all output until completion (not a TTY).
    timeout "${BUILD_TIMEOUT}s" claude -p "$PROMPT" --dangerously-skip-permissions 2>&1 || {
        EXIT_CODE=$?
        echo "Claude exited with code: $EXIT_CODE"
    }

    stop_heartbeat

    # Check if output.json exists and has status=success
    if [ -f ./output.json ]; then
        STATUS=$(jq -r '.status // "unknown"' ./output.json 2>/dev/null || echo "unknown")
        if [ "$STATUS" = "success" ]; then
            echo "=== Build succeeded on iteration $ITER ==="
            send_progress "iteration_complete" "Build succeeded on iteration $ITER" 80 "$ITER" "$MAX_ITERATIONS"
            break
        fi
        echo "=== Build reported status: $STATUS on iteration $ITER ==="
        send_progress "iteration_failed" "Iteration $ITER: $STATUS — retrying" "" "$ITER" "$MAX_ITERATIONS"
        # Save failure context for next iteration
        cp ./output.json ./previous-attempt.json
    else
        echo "=== No output.json produced on iteration $ITER ==="
        send_progress "iteration_failed" "Iteration $ITER: no output produced — retrying" "" "$ITER" "$MAX_ITERATIONS"
        echo "{\"failedIteration\":$ITER,\"failureReason\":\"No output.json produced\"}" > ./previous-attempt.json
    fi

    ITER=$((ITER + 1))
done

# Stamp iteration count into output.json before S3 upload
if [ -f ./output.json ]; then
    jq --arg i "$ITER" --arg m "$MAX_ITERATIONS" \
        '. + {iteration:($i|tonumber),maxIterations:($m|tonumber)}' \
        ./output.json > ./output-tmp.json && mv ./output-tmp.json ./output.json
fi

# Check for output and upload to S3
if [ -f ./output.json ]; then
    echo ""
    echo "=== Build Complete ==="
    cat ./output.json

    # Upload output to S3 for build-completion Lambda to retrieve
    if [ -n "$ARTIFACTS_BUCKET" ] && [ -n "$FABLE_BUILD_ID" ]; then
        send_progress "uploading" "Uploading build artifacts" 90
        S3_KEY="builds/${FABLE_BUILD_ID}/${PHASE}-output.json"
        echo ""
        echo "=== Uploading output to S3 ==="
        echo "Bucket: $ARTIFACTS_BUCKET"
        echo "Key: $S3_KEY"
        aws s3 cp ./output.json "s3://${ARTIFACTS_BUCKET}/${S3_KEY}"
        # Also save iteration-stamped copy for debugging (won't overwrite on retry)
        ITER=$(echo "$BUILD_SPEC" | jq -r '.iteration // 1' 2>/dev/null || echo "1")
        aws s3 cp ./output.json "s3://${ARTIFACTS_BUCKET}/builds/${FABLE_BUILD_ID}/${PHASE}-output-iter${ITER}.json" 2>/dev/null || true
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

send_progress "complete" "Build container finished" 100

# Cleanup credentials
rm -f ~/.git-credentials 2>/dev/null || true
