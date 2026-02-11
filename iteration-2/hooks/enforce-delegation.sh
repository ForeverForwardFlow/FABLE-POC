#!/bin/bash
# PreToolUse Hook - Enforce Delegation for Lead Agent
#
# Blocks the lead agent from creating source/test files via any mechanism:
# Write, Edit, or Bash (cat/echo/tee/heredoc).
# Teammates (identified by CLAUDE_CODE_AGENT_NAME env var) are allowed.
#
# Exit codes:
#   0 = allow the tool call
#   2 = block with feedback (stderr is shown to agent)

set -euo pipefail

HOOK_INPUT=$(cat)

TOOL_NAME=$(echo "$HOOK_INPUT" | jq -r '.tool_name // empty')

# If this is a teammate, allow everything
if [ -n "${CLAUDE_CODE_AGENT_NAME:-}" ]; then
    exit 0
fi

# Gate Write and Edit tools
if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ]; then
    FILE_PATH=$(echo "$HOOK_INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')

    if [ -z "$FILE_PATH" ]; then
        exit 0
    fi

    # Allow config/output files
    BASENAME=$(basename "$FILE_PATH")
    case "$BASENAME" in
        output.json|package.json|package-lock.json|tsconfig.json|tool.json|jest.config.js|.gitignore)
            exit 0
            ;;
    esac

    # Allow .claude/ and .fable/ directories
    case "$FILE_PATH" in
        */.claude/*|*/.fable/*)
            exit 0
            ;;
    esac

    # Block implementation files
    case "$FILE_PATH" in
        */src/*|*/__tests__/*|*.ts|*.js)
            echo "DELEGATION REQUIRED: You are the lead agent and cannot write implementation files directly." >&2
            echo "File blocked: $FILE_PATH" >&2
            echo "Spawn a teammate to implement this." >&2
            exit 2
            ;;
    esac

    exit 0
fi

# Gate Bash commands that create files in src/ or __tests__/
if [ "$TOOL_NAME" = "Bash" ]; then
    COMMAND=$(echo "$HOOK_INPUT" | jq -r '.tool_input.command // empty')

    if [ -z "$COMMAND" ]; then
        exit 0
    fi

    # Check if the bash command writes to src/ or __tests__/ paths
    # Note: grep returns exit 1 on no match; use || true to avoid set -e failure
    WRITES_TO_SRC=$(echo "$COMMAND" | grep -cE '(>|tee|cat\s.*>)\s*(src/|__tests__/|.*/src/|.*/__tests__/)' || true)
    if [ "$WRITES_TO_SRC" -gt 0 ]; then
        echo "DELEGATION REQUIRED: You are the lead agent and cannot create implementation files via Bash." >&2
        echo "Blocked command that writes to src/ or __tests__/" >&2
        echo "Spawn a teammate to implement this." >&2
        exit 2
    fi

    # Also catch heredocs and redirects targeting .ts/.js files in those dirs
    TARGETS_IMPL=$(echo "$COMMAND" | grep -cE '(src/tools/|__tests__/).*\.(ts|js)' || true)
    if [ "$TARGETS_IMPL" -gt 0 ]; then
        IS_WRITE=$(echo "$COMMAND" | grep -cE '(>|tee|cat\s*<<|printf|echo)' || true)
        if [ "$IS_WRITE" -gt 0 ]; then
            echo "DELEGATION REQUIRED: You are the lead agent and cannot create implementation files via Bash." >&2
            echo "Blocked command targeting implementation files." >&2
            echo "Spawn a teammate to implement this." >&2
            exit 2
        fi
    fi

    exit 0
fi

# Allow everything else (Read, Glob, Grep, TaskCreate, etc.)
exit 0
