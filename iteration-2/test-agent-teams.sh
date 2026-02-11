#!/bin/bash
# FABLE Agent Teams Local Test
#
# Tests the Agent Teams approach locally before deploying to ECS.
# Creates a clean test project and runs a multi-tool build using
# the new Agent Teams OI template.
#
# Usage:
#   ./iteration-2/test-agent-teams.sh
#
# Prerequisites:
#   - Claude Code CLI installed
#   - CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FABLE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DIR="/Users/simonmoon/Code/FABLE-test-agent-teams"
TEMPLATE_DIR="$FABLE_DIR/iteration-2/templates"
HOOKS_DIR="$FABLE_DIR/iteration-2/hooks"

echo -e "${YELLOW}=== FABLE Agent Teams Local Test ===${NC}"
echo "FABLE dir: $FABLE_DIR"
echo "Test dir: $TEST_DIR"
echo ""

# Check prerequisites
if ! command -v claude &> /dev/null; then
    echo -e "${RED}ERROR: Claude CLI not found${NC}"
    exit 1
fi

if [ -z "$CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" ]; then
    echo -e "${YELLOW}Setting CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1${NC}"
    export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
fi

# Clean up previous test
if [ -d "$TEST_DIR" ]; then
    echo "Cleaning up previous test directory..."
    rm -rf "$TEST_DIR"
fi

# Create test directory
echo "Creating test directory: $TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Initialize git
git init
git config user.email "test@fable.ai"
git config user.name "FABLE Test"

# Copy Agent Teams OI template as CLAUDE.md
cp "$TEMPLATE_DIR/CLAUDE.md.oi-agent-teams" ./CLAUDE.md
cp "$TEMPLATE_DIR/CLAUDE.md.worker-agent-teams" ./CLAUDE.md.worker-template

# Copy quality gate hooks
mkdir -p .claude/hooks
cp "$HOOKS_DIR/teammate-idle.sh" .claude/hooks/
cp "$HOOKS_DIR/task-completed.sh" .claude/hooks/
chmod +x .claude/hooks/*.sh

# Write settings.json with Agent Teams hooks
cat > .claude/settings.json << 'EOF'
{
  "hooks": {
    "TeammateIdle": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/teammate-idle.sh",
            "timeout": 30
          }
        ]
      }
    ],
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/task-completed.sh",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
EOF

# Create a simple build spec (3-tool string-utils package)
cat > build-spec.json << 'EOF'
{
  "request": "Create a string-utils package with three tools: reverse (reverses a string), capitalize (capitalizes first letter of each word), and count-words (counts words in a string). Each tool should be a Lambda handler that takes arguments and returns a result.",
  "tools": [
    {
      "name": "reverse",
      "description": "Reverses a string",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": { "type": "string", "description": "The string to reverse" }
        },
        "required": ["text"]
      }
    },
    {
      "name": "capitalize",
      "description": "Capitalizes the first letter of each word",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": { "type": "string", "description": "The string to capitalize" }
        },
        "required": ["text"]
      }
    },
    {
      "name": "count-words",
      "description": "Counts the number of words in a string",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": { "type": "string", "description": "The string to count words in" }
        },
        "required": ["text"]
      }
    }
  ],
  "techStack": {
    "language": "TypeScript",
    "runtime": "Node.js 20",
    "format": "CommonJS",
    "testFramework": "Jest",
    "buildTool": "esbuild"
  }
}
EOF

# Initialize npm project
cat > package.json << 'EOF'
{
  "name": "string-utils",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc --noEmit",
    "test": "jest"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.0.0"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node"
  }
}
EOF

cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": "."
  },
  "include": ["src/**/*", "__tests__/**/*"]
}
EOF

# Install dependencies
echo ""
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install --silent

# Create source and test directories
mkdir -p src/tools __tests__

# Initial commit
git add -A
git commit -m "Initial test setup"

echo ""
echo -e "${GREEN}=== Test Environment Ready ===${NC}"
echo ""
echo "Directory: $TEST_DIR"
echo "Template:  CLAUDE.md.oi-agent-teams"
echo "Hooks:     TeammateIdle + TaskCompleted"
echo "Spec:      3 tools (reverse, capitalize, count-words)"
echo ""
echo -e "${YELLOW}To run the test:${NC}"
echo "  cd $TEST_DIR"
echo "  export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1"
echo "  claude -p \"Read CLAUDE.md and build-spec.json. Decompose into tasks, spawn teammates, and build all three tools. Output result to output.json\" --dangerously-skip-permissions"
echo ""
echo -e "${YELLOW}To run interactively (recommended for first test):${NC}"
echo "  cd $TEST_DIR"
echo "  export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1"
echo "  claude"
echo "  > Read CLAUDE.md and build-spec.json. Build all three tools using your team."
echo ""
echo -e "${YELLOW}What to observe:${NC}"
echo "  - Does the lead use delegate mode (coordination only)?"
echo "  - Are teammates spawned for each tool?"
echo "  - Do TaskCompleted hooks block premature completion?"
echo "  - Do TeammateIdle hooks prevent workers from stopping early?"
echo "  - Are all three tools built with passing tests?"
echo "  - Does the final output.json get created?"
