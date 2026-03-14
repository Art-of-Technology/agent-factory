#!/usr/bin/env bash
# Agent Factory Setup Script (Linux/macOS)
# Usage: ./setup-agents.sh --repo "owner/repo" --vision "Product vision..." [options]
#
# Options:
#   --repo              "owner/repo"                    (required)
#   --vision            "Product vision..."             (required)
#   --branch            "main"                          (default: main)
#   --framework         "Next.js 15"                   (default: Next.js 15)
#   --orm               "Prisma"                        (default: Prisma)
#   --database          "PostgreSQL"                    (default: PostgreSQL)
#   --auth              "NextAuth.js"                   (default: NextAuth.js)
#   --package-manager   "npm"                           (default: npm)
#   --infra             "Docker + Cloudflare Tunnel"    (default: Docker)
#   --install-cmd       "npm install"                   (auto-derived from package manager)
#   --dev-cmd           "npm run dev"                   (auto-derived from package manager)
#   --build-cmd         "npm run build"                 (auto-derived)
#   --test-cmd          "npm test"                      (auto-derived)
#   --lint-cmd          "npm run lint"                  (auto-derived)
#   --migrate-cmd       "npx prisma migrate dev"        (auto-derived from ORM)
#   --api-routes-path   "src/app/api"                   (default)
#   --schema-path       "prisma/schema.prisma"          (auto-derived from ORM)
#   --components-path   "src/components"                (default)
#   --team-roster       "- @alice: PM\n- @bob: Dev"    (optional)
#   --schema-highlights "User, Post, Comment models"    (optional)
#   --github-project    "https://github.com/orgs/..."  (auto-created)
#   --model             "anthropic/claude-opus-4-6"    (default)
#   --cron-interval     "5m"                            (default)
#   --telegram-chat-id  "123456"                        (optional)

set -euo pipefail

# --- Parse args ---
REPO="" VISION="" BRANCH="main"
FRAMEWORK="Next.js 15" ORM="Prisma" DATABASE="PostgreSQL" AUTH="NextAuth.js"
PACKAGE_MANAGER="npm" INFRA="Docker"
INSTALL_CMD="" DEV_CMD="" BUILD_CMD="" TEST_CMD="" LINT_CMD="" MIGRATE_CMD=""
API_ROUTES_PATH="src/app/api" SCHEMA_PATH="" COMPONENTS_PATH="src/components"
TEAM_ROSTER="_(not configured)_" SCHEMA_HIGHLIGHTS="_(not configured)_"
GITHUB_PROJECT="" MODEL="anthropic/claude-opus-4-6" CRON_INTERVAL="5m" TELEGRAM_CHAT_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --repo)               REPO="$2"; shift 2;;
    --vision)             VISION="$2"; shift 2;;
    --branch)             BRANCH="$2"; shift 2;;
    --framework)          FRAMEWORK="$2"; shift 2;;
    --orm)                ORM="$2"; shift 2;;
    --database)           DATABASE="$2"; shift 2;;
    --auth)               AUTH="$2"; shift 2;;
    --package-manager)    PACKAGE_MANAGER="$2"; shift 2;;
    --infra)              INFRA="$2"; shift 2;;
    --install-cmd)        INSTALL_CMD="$2"; shift 2;;
    --dev-cmd)            DEV_CMD="$2"; shift 2;;
    --build-cmd)          BUILD_CMD="$2"; shift 2;;
    --test-cmd)           TEST_CMD="$2"; shift 2;;
    --lint-cmd)           LINT_CMD="$2"; shift 2;;
    --migrate-cmd)        MIGRATE_CMD="$2"; shift 2;;
    --api-routes-path)    API_ROUTES_PATH="$2"; shift 2;;
    --schema-path)        SCHEMA_PATH="$2"; shift 2;;
    --components-path)    COMPONENTS_PATH="$2"; shift 2;;
    --team-roster)        TEAM_ROSTER="$2"; shift 2;;
    --schema-highlights)  SCHEMA_HIGHLIGHTS="$2"; shift 2;;
    --github-project)     GITHUB_PROJECT="$2"; shift 2;;
    --model)              MODEL="$2"; shift 2;;
    --cron-interval)      CRON_INTERVAL="$2"; shift 2;;
    --telegram-chat-id)   TELEGRAM_CHAT_ID="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[[ -z "$REPO" ]] && echo "❌ --repo required" && exit 1
[[ -z "$VISION" ]] && echo "❌ --vision required" && exit 1

# --- Derive defaults from package manager ---
PKG="${PACKAGE_MANAGER,,}"  # lowercase
if [[ -z "$INSTALL_CMD" ]]; then
  case "$PKG" in
    bun)  INSTALL_CMD="bun install" ;;
    pnpm) INSTALL_CMD="pnpm install" ;;
    yarn) INSTALL_CMD="yarn" ;;
    *)    INSTALL_CMD="npm install" ;;
  esac
fi
if [[ -z "$DEV_CMD" ]]; then
  case "$PKG" in
    bun)  DEV_CMD="bun run dev" ;;
    pnpm) DEV_CMD="pnpm dev" ;;
    yarn) DEV_CMD="yarn dev" ;;
    *)    DEV_CMD="npm run dev" ;;
  esac
fi
if [[ -z "$BUILD_CMD" ]]; then
  case "$PKG" in
    bun)  BUILD_CMD="bun run build" ;;
    pnpm) BUILD_CMD="pnpm build" ;;
    yarn) BUILD_CMD="yarn build" ;;
    *)    BUILD_CMD="npm run build" ;;
  esac
fi
if [[ -z "$TEST_CMD" ]]; then
  case "$PKG" in
    bun)  TEST_CMD="bun test" ;;
    pnpm) TEST_CMD="pnpm test" ;;
    yarn) TEST_CMD="yarn test" ;;
    *)    TEST_CMD="npm test" ;;
  esac
fi
if [[ -z "$LINT_CMD" ]]; then
  case "$PKG" in
    bun)  LINT_CMD="bun run lint" ;;
    pnpm) LINT_CMD="pnpm lint" ;;
    yarn) LINT_CMD="yarn lint" ;;
    *)    LINT_CMD="npm run lint" ;;
  esac
fi

# --- Derive defaults from ORM ---
ORM_LOWER="${ORM,,}"
if [[ -z "$MIGRATE_CMD" ]]; then
  case "$ORM_LOWER" in
    prisma)  MIGRATE_CMD="${INSTALL_CMD%% *}x prisma migrate dev" ;;
    drizzle) MIGRATE_CMD="${INSTALL_CMD%% *} run db:migrate" ;;
    *)       MIGRATE_CMD="_(not configured)_" ;;
  esac
fi
if [[ -z "$SCHEMA_PATH" ]]; then
  case "$ORM_LOWER" in
    prisma)  SCHEMA_PATH="prisma/schema.prisma" ;;
    drizzle) SCHEMA_PATH="packages/db/schema/" ;;
    *)       SCHEMA_PATH="_(not configured)_" ;;
  esac
fi

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

  # Copy SOUL.md template as-is (no substitutions — it's universal)
  template="$SKILL_DIR/assets/soul-templates/$id.md"
  if [[ -f "$template" ]]; then
    cp "$template" "$dir/SOUL.md"
  fi

  # Generate PROJECT.md from template with actual project values
  project_template="$SKILL_DIR/assets/PROJECT.md.template"
  if [[ -f "$project_template" ]]; then
    sed \
      -e "s|{REPO}|$REPO|g" \
      -e "s|{BRANCH}|$BRANCH|g" \
      -e "s|{GITHUB_PROJECT}|${GITHUB_PROJECT:-_(will be set after project creation)_}|g" \
      -e "s|{FRAMEWORK}|$FRAMEWORK|g" \
      -e "s|{ORM}|$ORM|g" \
      -e "s|{DATABASE}|$DATABASE|g" \
      -e "s|{AUTH}|$AUTH|g" \
      -e "s|{PACKAGE_MANAGER}|$PACKAGE_MANAGER|g" \
      -e "s|{INFRA}|$INFRA|g" \
      -e "s|{INSTALL_CMD}|$INSTALL_CMD|g" \
      -e "s|{DEV_CMD}|$DEV_CMD|g" \
      -e "s|{BUILD_CMD}|$BUILD_CMD|g" \
      -e "s|{TEST_CMD}|$TEST_CMD|g" \
      -e "s|{LINT_CMD}|$LINT_CMD|g" \
      -e "s|{MIGRATE_CMD}|$MIGRATE_CMD|g" \
      -e "s|{API_ROUTES_PATH}|$API_ROUTES_PATH|g" \
      -e "s|{SCHEMA_PATH}|$SCHEMA_PATH|g" \
      -e "s|{COMPONENTS_PATH}|$COMPONENTS_PATH|g" \
      "$project_template" > "$dir/PROJECT.md"

    # Append multi-line fields (sed doesn't handle newlines well)
    # Replace {TEAM_ROSTER} and {SCHEMA_HIGHLIGHTS} with actual content
    python3 -c "
import sys
content = open('$dir/PROJECT.md').read()
content = content.replace('{TEAM_ROSTER}', '''$TEAM_ROSTER''')
content = content.replace('{SCHEMA_HIGHLIGHTS}', '''$SCHEMA_HIGHLIGHTS''')
open('$dir/PROJECT.md', 'w').write(content)
" 2>/dev/null || true
  fi

  # Create AGENTS.md
  cat > "$dir/AGENTS.md" << AGENTSEOF
# AGENTS.md
## Workspace
Specialized agent workspace for: $REPO

## Every Session
1. Read \`SOUL.md\` — this is who you are (your identity, expertise, and principles)
2. Read \`PROJECT.md\` — this is the project context (tech stack, commands, team)
3. Use \`gh\` CLI for all GitHub operations
4. Clone the repo if needed: \`gh repo clone $REPO\`

## Rules
- All content in **English**
- Reference issue numbers in all work
- Follow the label state machine workflow defined in your SOUL.md
- Never push directly to $BRANCH — always use feature branches and PRs

## GitHub
- **Repo**: $REPO
- **Default branch**: $BRANCH
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
PROJECT_URL="https://github.com/orgs/$OWNER/projects/$PROJECT_NUMBER"

# Link to repo
REPO_ID=$(gh repo view "$REPO" --json id --jq '.id' 2>/dev/null || echo "")
if [[ -n "$PROJECT_ID" && -n "$REPO_ID" ]]; then
  gh api graphql -f query="mutation { linkProjectV2ToRepository(input: { projectId: \"$PROJECT_ID\", repositoryId: \"$REPO_ID\" }) { repository { name } } }" 2>/dev/null || true
fi

# Add Agent field
gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "Agent" --data-type "SINGLE_SELECT" --single-select-options "PO,PM,Architect,Senior Dev,UI,DB,QA,Security,API,CI/CD,Code Review,Infra" 2>/dev/null || true
echo "  ✅ Project #$PROJECT_NUMBER created and linked"

# --- Update PROJECT.md in all workspaces with the real GitHub Project URL ---
echo "  📝 Updating PROJECT.md with GitHub Project URL..."
for entry in "${AGENTS[@]}"; do
  IFS=':' read -r id _ <<< "$entry"
  dir="$OPENCLAW_HOME/workspace-$id"
  if [[ -f "$dir/PROJECT.md" ]]; then
    sed -i "s|_(will be set after project creation)_|$PROJECT_URL|g" "$dir/PROJECT.md" 2>/dev/null || true
  fi
done

# --- Step 4b: Get project field IDs for board sync ---
echo "  📋 Fetching board field IDs..."
STATUS_FIELD_JSON=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json 2>/dev/null || echo '{"fields":[]}')
STATUS_FIELD_ID=$(echo "$STATUS_FIELD_JSON" | node -e "process.stdin.on('data',d=>{const f=JSON.parse(d).fields.find(f=>f.name==='Status');if(f)console.log(f.id)})" 2>/dev/null || echo "")
IN_PROGRESS_OPT=$(echo "$STATUS_FIELD_JSON" | node -e "process.stdin.on('data',d=>{const f=JSON.parse(d).fields.find(f=>f.name==='Status');if(f){const o=f.options.find(o=>o.name==='In Progress');if(o)console.log(o.id)}})" 2>/dev/null || echo "")
DONE_OPT=$(echo "$STATUS_FIELD_JSON" | node -e "process.stdin.on('data',d=>{const f=JSON.parse(d).fields.find(f=>f.name==='Status');if(f){const o=f.options.find(o=>o.name==='Done');if(o)console.log(o.id)}})" 2>/dev/null || echo "")
echo "  ✅ Status field: $STATUS_FIELD_ID (InProgress=$IN_PROGRESS_OPT, Done=$DONE_OPT)"

# --- Step 4c: Enable branch protection ---
echo "  🔒 Enabling branch protection on $BRANCH..."
echo '{"required_pull_request_reviews":{"dismiss_stale_reviews":false,"require_code_owner_reviews":false,"required_approving_review_count":0},"enforce_admins":true,"restrictions":null,"required_status_checks":null}' | \
  gh api "repos/$REPO/branches/$BRANCH/protection" -X PUT --input - > /dev/null 2>&1 && \
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
echo "  Project: $PROJECT_URL"
echo "  Labels: ${#LABELS[@]}"
echo "  Orchestrator: every $CRON_INTERVAL"
echo ""
echo "  Each agent workspace contains:"
echo "    SOUL.md      — universal agent identity (never changes per project)"
echo "    PROJECT.md   — project-specific context (tech stack, commands, team)"
echo "    AGENTS.md    — session startup instructions"
echo ""
echo "  Next: Spawn PO agent with your vision to begin!"
