#!/bin/bash
# TeammateIdle Hook - Replaces Ralph Wiggum Loop
#
# Fires when a teammate is about to go idle. Checks if they have
# unfinished tasks. If so, blocks idle (exit 2) with feedback.
#
# Exit codes:
#   0 = allow idle (work is done)
#   2 = block idle, feed stderr back as prompt (keep working)

set -euo pipefail

HOOK_INPUT=$(cat)

TEAMMATE_NAME=$(echo "$HOOK_INPUT" | jq -r '.teammate_name // empty')
TEAM_NAME=$(echo "$HOOK_INPUT" | jq -r '.team_name // empty')

if [ -z "$TEAMMATE_NAME" ] || [ -z "$TEAM_NAME" ]; then
    # Not in a team context, allow idle
    exit 0
fi

# Check if this teammate has in-progress tasks
TASKS_DIR="$HOME/.claude/tasks/$TEAM_NAME"

if [ ! -d "$TASKS_DIR" ]; then
    exit 0
fi

# Look for tasks owned by this teammate that are still in_progress
INCOMPLETE=0
INCOMPLETE_SUBJECTS=""

for task_file in "$TASKS_DIR"/*.json; do
    [ -f "$task_file" ] || continue

    OWNER=$(jq -r '.owner // empty' "$task_file")
    STATUS=$(jq -r '.status // empty' "$task_file")
    SUBJECT=$(jq -r '.subject // empty' "$task_file")

    if [ "$OWNER" = "$TEAMMATE_NAME" ] && [ "$STATUS" = "in_progress" ]; then
        INCOMPLETE=$((INCOMPLETE + 1))
        INCOMPLETE_SUBJECTS="$INCOMPLETE_SUBJECTS\n- $SUBJECT"
    fi
done

if [ "$INCOMPLETE" -gt 0 ]; then
    echo "You still have $INCOMPLETE in-progress task(s):$INCOMPLETE_SUBJECTS" >&2
    echo "" >&2
    echo "Complete your tasks before going idle. Run verification (npm run build && npm run test) and mark tasks as completed." >&2
    exit 2
fi

# All tasks done or none assigned, allow idle
exit 0
