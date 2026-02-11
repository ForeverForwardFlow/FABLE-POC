#!/bin/bash
# Stop Hook - Prevent lead from exiting while tasks are incomplete
#
# This blocks the lead agent from stopping while there are
# pending or in-progress tasks remaining.
#
# Exit codes:
#   0 = allow stop
#   2 = block stop with feedback
#
# Safety: Tracks consecutive blocks to prevent infinite loops.
# After MAX_BLOCKS attempts, allows exit with warning.

set -euo pipefail

HOOK_INPUT=$(cat)

CWD=$(echo "$HOOK_INPUT" | jq -r '.cwd // empty')
if [ -z "$CWD" ]; then
    CWD="$(pwd)"
fi

# Safety valve: track consecutive blocks to prevent infinite loops
BLOCK_COUNT_FILE="/tmp/fable-lead-stop-blocks"
MAX_BLOCKS=20

if [ -f "$BLOCK_COUNT_FILE" ]; then
    BLOCK_COUNT=$(cat "$BLOCK_COUNT_FILE")
else
    BLOCK_COUNT=0
fi

# Check stop_hook_active - if true, this is a continuation from a previous block
STOP_HOOK_ACTIVE=$(echo "$HOOK_INPUT" | jq -r '.stop_hook_active // false')

# If no build-spec, this isn't a FABLE build - allow stop
SPEC_FILE="$CWD/build-spec.json"
if [ ! -f "$SPEC_FILE" ]; then
    rm -f "$BLOCK_COUNT_FILE"
    exit 0
fi

# If output.json exists, build is complete - allow stop
if [ -f "$CWD/output.json" ]; then
    rm -f "$BLOCK_COUNT_FILE"
    exit 0
fi

# Safety valve: if we've blocked too many times, allow exit
if [ "$BLOCK_COUNT" -ge "$MAX_BLOCKS" ]; then
    echo "WARNING: Build incomplete but hit max stop-hook blocks ($MAX_BLOCKS). Allowing exit." >&2
    rm -f "$BLOCK_COUNT_FILE"
    exit 0
fi

# Increment block count
BLOCK_COUNT=$((BLOCK_COUNT + 1))
echo "$BLOCK_COUNT" > "$BLOCK_COUNT_FILE"

# Check if all expected tool source files exist
MISSING=0
MISSING_NAMES=""
TOOLS=$(jq -r '.tools[].name' "$SPEC_FILE" 2>/dev/null)
for TOOL in $TOOLS; do
    if [ ! -f "$CWD/src/tools/$TOOL.ts" ]; then
        MISSING=$((MISSING + 1))
        MISSING_NAMES="$MISSING_NAMES $TOOL"
    fi
done

if [ "$MISSING" -gt 0 ]; then
    echo "BUILD INCOMPLETE ($BLOCK_COUNT/$MAX_BLOCKS): $MISSING tool(s) still missing:$MISSING_NAMES" >&2
    echo "Do not stop. Check on your teammates and spawn new ones for missing tools if needed." >&2
    exit 2
fi

# All files exist but no output.json yet
echo "All source files exist but output.json has not been written yet. ($BLOCK_COUNT/$MAX_BLOCKS)" >&2
echo "Run final verification (npm run build && npm run test) and write output.json." >&2
exit 2
