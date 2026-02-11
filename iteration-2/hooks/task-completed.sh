#!/bin/bash
# TaskCompleted Hook - Replaces Completion Promise Verification
#
# Fires when a task is being marked as completed. Verifies that
# the work is actually done before allowing completion.
#
# Exit codes:
#   0 = allow completion (verified)
#   2 = block completion, feed stderr back as prompt (not ready)

set -euo pipefail

HOOK_INPUT=$(cat)

TASK_SUBJECT=$(echo "$HOOK_INPUT" | jq -r '.task_subject // empty')
TASK_DESCRIPTION=$(echo "$HOOK_INPUT" | jq -r '.task_description // empty')
CWD=$(echo "$HOOK_INPUT" | jq -r '.cwd // empty')

# Use hook-provided cwd, fall back to pwd
if [ -n "$CWD" ]; then
    cd "$CWD"
fi

# Skip verification for non-implementation tasks (e.g., "integrate results")
if echo "$TASK_SUBJECT" | grep -qiE "^(integrate|merge|push|deploy|review)"; then
    exit 0
fi

# Check if we're in a project directory with package.json
if [ ! -f "package.json" ]; then
    echo "Warning: No package.json found in $(pwd). Skipping build verification." >&2
    exit 0
fi

# Verify build passes
echo "Verifying build..." >&2
if ! npm run build 2>&1 >/dev/null; then
    echo "BUILD FAILED. Fix build errors before completing task: $TASK_SUBJECT" >&2
    echo "" >&2
    echo "Run 'npm run build' to see errors." >&2
    exit 2
fi

# Verify tests pass (if test script exists)
HAS_TEST=$(npm pkg get scripts.test 2>/dev/null | grep -v '{}' || true)
if [ -n "$HAS_TEST" ]; then
    echo "Verifying tests..." >&2
    if ! npm run test 2>&1 >/dev/null; then
        echo "TESTS FAILED. Fix failing tests before completing task: $TASK_SUBJECT" >&2
        echo "" >&2
        echo "Run 'npm run test' to see failures." >&2
        exit 2
    fi
fi

# Extract expected files from task description and verify they exist
# Look for patterns like "src/tools/{name}.ts" in the description
if [ -n "$TASK_DESCRIPTION" ]; then
    MISSING_FILES=""
    while IFS= read -r filepath; do
        [ -z "$filepath" ] && continue
        if [ ! -f "$filepath" ]; then
            MISSING_FILES="$MISSING_FILES\n- $filepath"
        fi
    done < <(echo "$TASK_DESCRIPTION" | grep -oE '(src|__tests__)/[a-zA-Z0-9_/.-]+\.(ts|js)' | sort -u)

    if [ -n "$MISSING_FILES" ]; then
        echo "MISSING FILES. These files were expected but don't exist:$MISSING_FILES" >&2
        echo "" >&2
        echo "Create the missing files before completing task: $TASK_SUBJECT" >&2
        exit 2
    fi
fi

# All checks passed
exit 0
