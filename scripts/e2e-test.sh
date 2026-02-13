#!/bin/bash
# E2E test: WebSocket chat → build trigger → ECS builder → completion → deploy → notify
# Usage: ./scripts/e2e-test.sh
#
# This is interactive — it connects to the WebSocket and lets you chat.
# Send messages as JSON: {"type":"message","payload":{"content":"your message"}}
#
# Quick test flow:
# 1. Send: {"type":"message","payload":{"content":"build me a tool that converts celsius to fahrenheit"}}
# 2. Chat will ask clarifying questions — respond naturally
# 3. When chat is satisfied, it triggers a build
# 4. Watch for build_completed or build_failed notifications
# 5. Monitor ECS task: aws ecs list-tasks --cluster fable-dev-builds
# 6. Monitor logs: aws logs tail /ecs/fable-dev-build --follow

WS_URL="wss://f9qynczzkj.execute-api.us-west-2.amazonaws.com/dev"

echo "=== FABLE E2E Test ==="
echo "Connecting to: $WS_URL"
echo ""
echo "Send messages like:"
echo '  {"type":"message","payload":{"content":"build me a temperature converter tool"}}'
echo ""
echo "Monitor build progress in another terminal:"
echo '  aws ecs list-tasks --cluster fable-dev-builds --desired-status RUNNING'
echo '  aws logs tail /ecs/fable-dev-build --follow'
echo ""

wscat -c "$WS_URL"
