#!/usr/bin/env bash
# Agent Factory Setup Script (Linux/macOS)
# Usage: ./setup-agents.sh --repo "owner/repo" --vision "Product vision..." [--stack "nextjs,prisma,postgresql"] [--model "anthropic/claude-opus-4-6"] [--cron-interval "5m"] [--telegram-chat-id "123456"]

set -euo pipefail

# --- Parse args ---
REPO="" VISION="" STACK="nextjs,prisma,postgresql,docker" MODEL="anthropic/claude-opus-4-6" CRON_INTERVAL="5m" TELEGRAM_CHAT_ID=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --repo) REPO="$2"; shift 2;;
    --vision) VISION="$2"; shift 2;;
    --stack) STACK="$2"; shift 2;;
    --model) MODEL="$2"; shift 2;;
    --cron-interval) CRON_INTERVAL="$2"; shift 2;;
    --telegram-chat-id) TELEGRAM_CHAT_ID="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done
[[ -z "$REPO" ]] && echo "❌ --repo required" && exit 1
[[ -z "$VISION" ]] && echo "❌ --vision required" && exit 1

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OPENCLAW_HOME="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
CONFIG_PATH="$OPENCLAW_HOME/openclaw.json"
OWNER="${REPO%%/*}"

echo "🏭 Agent Factory — Setting up development team for $REPO"

# --- Step 1: Create agent workspaces ---
echo -e "\n📁 Creating agent workspaces..."
AGENTS=("po:Product Owner" "pm:Project Manager" "architect:Software Architect" "senior-dev:Senior Developer" "ui:UI/Frontend Agent" "db:Database Agent" "qa:QA/Testing Agent" "security:Security Agent" "api:API Best Practices Agent" "cicd:CI/CD Agent" "code-review:Code Review Agent" "infra:Infrastructure Agent")

for entry in "${AGENTS[@]}"; do
  IFS=':' read -r id name <<< "$entry"
  dir="$OPENCLAW_HOME/workspace-$id"
  mkdir -p "$dir"
  
  # Copy SOUL.md template and inject project context
  template="$SKILL_DIR/assets/soul-templates/$id.md"
  if [[ -f "$template" ]]; then
    sed -e "s|{REPO}|$REPO|g" -e "s|{STACK}|$STACK|g" -e "s|{VISION}|$VISION|g" "$template" > "$dir/SOUL.md"
  fi
  
  # Create AGENTS.md
  cat > "$dir/AGENTS.md" << AGENTSEOF
# AGENTS.md
## Workspace
Specialized agent workspace for project: $REPO
## Every Session
1. Read \`SOUL.md\`
2. Use \`gh\` CLI for all GitHub operations
3. Work in the repo (clone if needed): \`gh repo clone $REPO\`
## Rules
- All content in **English**
- Reference issue numbers in all work
- Follow the label state machine workflow
## GitHub
- **Repo**: $REPO
- **Branch**: master (default)
AGENTSEOF
  echo "  ✅ $name ($id)"
done

# --- Step 2: Update openclaw.json ---
echo -e "\n⚙️  Updating openclaw.json..."

# Build agents list JSON
AGENT_IDS_JSON=$(printf '"%s",' $(for entry in "${AGENTS[@]}"; do echo "${entry%%:*}"; done))
AGENT_IDS_JSON="[${AGENT_IDS_JSON%,}]"

AGENTS_LIST_JSON='[{"id":"main","default":true,"name":"Main Assistant","workspace":"~/.openclaw/workspace","subagents":{"allowAgents":'"$AGENT_IDS_JSON"'}}'
for entry in "${AGENTS[@]}"; do
  IFS=':' read -r id name <<< "$entry"
  if [[ "$id" == "pm" ]]; then
    AGENTS_LIST_JSON+=",{\"id\":\"$id\",\"name\":\"$name\",\"workspace\":\"~/.openclaw/workspace-$id\",\"subagents\":{\"allowAgents\":$AGENT_IDS_JSON}}"
  else
    AGENTS_LIST_JSON+=",{\"id\":\"$id\",\"name\":\"$name\",\"workspace\":\"~/.openclaw/workspace-$id\"}"
  fi
done
AGENTS_LIST_JSON+=']'

# Use node/bun for JSON manipulation (jq alternative)
if command -v node &>/dev/null; then
  JSON_CMD="node"
  node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('$CONFIG_PATH', 'utf8'));
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    config.agents.defaults.subagents = Object.assign(config.agents.defaults.subagents || {}, {
      maxSpawnDepth: 2, maxChildrenPerAgent: 8, runTimeoutSeconds: 900, model: '$MODEL'
    });
    config.agents.list = $AGENTS_LIST_JSON;
    fs.writeFileSync('$CONFIG_PATH', JSON.stringify(config, null, 2));
  "
elif command -v jq &>/dev/null; then
  tmp=$(mktemp)
  jq --argjson list "$AGENTS_LIST_JSON" --arg model "$MODEL" '
    .agents.defaults.subagents += {maxSpawnDepth:2, maxChildrenPerAgent:8, runTimeoutSeconds:900, model:$model} |
    .agents.list = $list
  ' "$CONFIG_PATH" > "$tmp" && mv "$tmp" "$CONFIG_PATH"
else
  echo "  ⚠️  Need node or jq to update config. Install one and re-run."
  exit 1
fi
echo "  ✅ Config updated with ${#AGENTS[@]} agents"

# --- Step 3: Create GitHub labels ---
echo -e "\n🏷️  Creating GitHub labels..."
LABELS=(
  "epic,0052CC,Epic - large feature group"
  "user-story,1D76DB,User story"
  "task,5319E7,Implementation task"
  "needs-architecture,D93F0B,Waiting for Architect review"
  "architecture-approved,0E8A16,Architecture approved"
  "db-design,FBCA04,Needs DB schema design"
  "schema-ready,0E8A16,DB schema is ready"
  "ready-for-dev,0E8A16,Ready for development"
  "ready-for-ui,1D76DB,Ready for UI implementation"
  "in-progress,FBCA04,Currently being worked on"
  "pr-open,C5DEF5,PR has been opened"
  "needs-review,D93F0B,Needs code review"
  "review-approved,0E8A16,Code review passed"
  "needs-security-review,B60205,Needs security review"
  "security-approved,0E8A16,Security review passed"
  "needs-api-review,D93F0B,Needs API best practices review"
  "api-approved,0E8A16,API review passed"
  "needs-test,D93F0B,Needs test coverage"
  "tests-passing,0E8A16,All tests passing"
  "needs-cicd,D93F0B,Needs CI/CD setup"
  "needs-infra,D93F0B,Needs infrastructure provisioning"
  "infra-ready,0E8A16,Infrastructure provisioned"
  "deployed-staging,0E8A16,Deployed to staging"
  "deployed-prod,0E8A16,Deployed to production"
  "blocker,B60205,Blocked by dependency"
  "priority-high,B60205,High priority"
  "priority-medium,FBCA04,Medium priority"
  "priority-low,0E8A16,Low priority"
)
for l in "${LABELS[@]}"; do
  IFS=',' read -r lname lcolor ldesc <<< "$l"
  gh label create "$lname" --repo "$REPO" --color "$lcolor" --description "$ldesc" --force 2>/dev/null || true
done
echo "  ✅ ${#LABELS[@]} labels created"

# --- Step 4: Create GitHub Project ---
echo -e "\n📊 Creating GitHub Project board..."
REPO_NAME="${REPO##*/}"
PROJECT_JSON=$(gh project create --owner "$OWNER" --title "$REPO_NAME Development" --format json 2>&1)
PROJECT_NUMBER=$(echo "$PROJECT_JSON" | node -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).number)})" 2>/dev/null || echo "$PROJECT_JSON" | jq -r '.number' 2>/dev/null || echo "?")
PROJECT_ID=$(echo "$PROJECT_JSON" | node -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).id)})" 2>/dev/null || echo "$PROJECT_JSON" | jq -r '.id' 2>/dev/null || echo "")

# Link to repo
REPO_ID=$(gh repo view "$REPO" --json id --jq '.id' 2>/dev/null || echo "")
if [[ -n "$PROJECT_ID" && -n "$REPO_ID" ]]; then
  gh api graphql -f query="mutation { linkProjectV2ToRepository(input: { projectId: \"$PROJECT_ID\", repositoryId: \"$REPO_ID\" }) { repository { name } } }" 2>/dev/null || true
fi

# Add Agent field
gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "Agent" --data-type "SINGLE_SELECT" --single-select-options "PO,PM,Architect,Senior Dev,UI,DB,QA,Security,API,CI/CD,Code Review,Infra" 2>/dev/null || true
echo "  ✅ Project #$PROJECT_NUMBER created and linked"

# --- Step 4b: Get project field IDs for board sync ---
echo "  📋 Fetching board field IDs..."
STATUS_FIELD_JSON=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json 2>/dev/null || echo '{"fields":[]}')
STATUS_FIELD_ID=$(echo "$STATUS_FIELD_JSON" | node -e "process.stdin.on('data',d=>{const f=JSON.parse(d).fields.find(f=>f.name==='Status');if(f)console.log(f.id)})" 2>/dev/null || echo "")
IN_PROGRESS_OPT=$(echo "$STATUS_FIELD_JSON" | node -e "process.stdin.on('data',d=>{const f=JSON.parse(d).fields.find(f=>f.name==='Status');if(f){const o=f.options.find(o=>o.name==='In Progress');if(o)console.log(o.id)}})" 2>/dev/null || echo "")
DONE_OPT=$(echo "$STATUS_FIELD_JSON" | node -e "process.stdin.on('data',d=>{const f=JSON.parse(d).fields.find(f=>f.name==='Status');if(f){const o=f.options.find(o=>o.name==='Done');if(o)console.log(o.id)}})" 2>/dev/null || echo "")
echo "  ✅ Status field: $STATUS_FIELD_ID (InProgress=$IN_PROGRESS_OPT, Done=$DONE_OPT)"


# --- Step 4c: Enable branch protection ---
echo "  🔒 Enabling branch protection on default branch..."
DEFAULT_BRANCH=$(gh repo view "$REPO" --json defaultBranchRef --jq '.defaultBranchRef.name')
echo '{"required_pull_request_reviews":{"dismiss_stale_reviews":false,"require_code_owner_reviews":false,"required_approving_review_count":0},"enforce_admins":true,"restrictions":null,"required_status_checks":null}' | \
  gh api "repos/$REPO/branches/$DEFAULT_BRANCH/protection" -X PUT --input - > /dev/null 2>&1 && \
  echo "  ✅ Branch protection enabled (enforce_admins: true)" || \
  echo "  ⚠️  Branch protection failed (may need admin access)"
# --- Step 5: Setup orchestrator cron ---
echo -e "\n🤖 Setting up pipeline orchestrator cron..."
ORCHESTRATOR_PROMPT=$(sed -e "s|{REPO}|$REPO|g" -e "s|{OWNER}|$OWNER|g" -e "s|{PROJECT_ID}|$PROJECT_ID|g" -e "s|{PROJECT_NUMBER}|$PROJECT_NUMBER|g" -e "s|{STATUS_FIELD_ID}|$STATUS_FIELD_ID|g" -e "s|{IN_PROGRESS_OPT}|$IN_PROGRESS_OPT|g" -e "s|{DONE_OPT}|$DONE_OPT|g" "$SKILL_DIR/references/orchestrator-prompt.md")

CRON_ARGS=(cron add --name "pipeline-orchestrator" --every "$CRON_INTERVAL" --message "$ORCHESTRATOR_PROMPT" --agent "pm" --model "$MODEL" --session "isolated" --timeout-seconds "300" --description "Polls GitHub issues and spawns agents for ready tasks")
if [[ -n "$TELEGRAM_CHAT_ID" ]]; then
  CRON_ARGS+=(--announce --to "telegram:$TELEGRAM_CHAT_ID")
fi
openclaw "${CRON_ARGS[@]}" 2>/dev/null || echo "  ⚠️  Cron setup failed — add manually"
echo "  ✅ Orchestrator cron (every $CRON_INTERVAL)"

# --- Step 6: Restart gateway ---
echo -e "\n🔄 Restarting gateway..."
openclaw gateway restart 2>/dev/null || true
sleep 3
echo "  ✅ Gateway restarted"

echo -e "\n🎉 Agent Factory setup complete!"
echo "  Agents: ${#AGENTS[@]}"
echo "  Project: https://github.com/orgs/$OWNER/projects/$PROJECT_NUMBER"
echo "  Labels: ${#LABELS[@]}"
echo "  Orchestrator: every $CRON_INTERVAL"
echo ""
echo "  Next: Spawn PO agent with your vision to begin!"


