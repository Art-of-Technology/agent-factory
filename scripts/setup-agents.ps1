#!/usr/bin/env pwsh
# Agent Factory Setup Script (Windows/macOS/Linux via PowerShell)
# Usage: ./setup-agents.ps1 -Repo "owner/repo" -Vision "Product vision..." [-Stack "nextjs,prisma,postgresql"] [-Model "anthropic/claude-opus-4-6"]

param(
    [Parameter(Mandatory=$true)][string]$Repo,
    [Parameter(Mandatory=$true)][string]$Vision,
    [string]$Stack = "nextjs,prisma,postgresql,docker",
    [string]$Model = "anthropic/claude-opus-4-6",
    [string]$CronInterval = "5m",
    [string]$TelegramChatId = ""
)

$ErrorActionPreference = "Stop"
$skillDir = Split-Path -Parent $PSScriptRoot
$templatesDir = Join-Path $skillDir "assets" "soul-templates"
$openclawHome = if ($env:OPENCLAW_STATE_DIR) { $env:OPENCLAW_STATE_DIR } else { Join-Path $HOME ".openclaw" }
$configPath = Join-Path $openclawHome "openclaw.json"
$owner = $Repo.Split("/")[0]
$repoName = $Repo.Split("/")[1]

Write-Host "🏭 Agent Factory — Setting up development team for $Repo" -ForegroundColor Cyan

# --- Step 1: Create agent workspaces ---
Write-Host "`n📁 Creating agent workspaces..." -ForegroundColor Yellow
$agents = @(
    @{ id="po"; name="Product Owner" },
    @{ id="pm"; name="Project Manager" },
    @{ id="architect"; name="Software Architect" },
    @{ id="senior-dev"; name="Senior Developer" },
    @{ id="ui"; name="UI/Frontend Agent" },
    @{ id="db"; name="Database Agent" },
    @{ id="qa"; name="QA/Testing Agent" },
    @{ id="security"; name="Security Agent" },
    @{ id="api"; name="API Best Practices Agent" },
    @{ id="cicd"; name="CI/CD Agent" },
    @{ id="code-review"; name="Code Review Agent" },
    @{ id="infra"; name="Infrastructure Agent" }
)

foreach ($agent in $agents) {
    $dir = Join-Path $openclawHome "workspace-$($agent.id)"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    $templateFile = Join-Path $templatesDir "$($agent.id).md"
    if (Test-Path $templateFile) {
        $soul = Get-Content $templateFile -Raw
        $soul = $soul -replace '\{REPO\}', $Repo
        $soul = $soul -replace '\{STACK\}', $Stack
        $soul = $soul -replace '\{VISION\}', $Vision
        Set-Content -Path (Join-Path $dir "SOUL.md") -Value $soul -Encoding UTF8
    }

    $agentsMd = @"
# AGENTS.md
## Workspace
Specialized agent workspace for project: $Repo
## Every Session
1. Read ``SOUL.md``
2. Use ``gh`` CLI for all GitHub operations
3. Work in the repo (clone if needed): ``gh repo clone $Repo``
## Rules
- All content in **English**
- Reference issue numbers in all work
- Follow the label state machine workflow
## GitHub
- **Repo**: $Repo
- **Branch**: master (default)
"@
    Set-Content -Path (Join-Path $dir "AGENTS.md") -Value $agentsMd -Encoding UTF8
    Write-Host "  ✅ $($agent.name) ($($agent.id))" -ForegroundColor Green
}

# --- Step 2: Update openclaw.json ---
Write-Host "`n⚙️ Updating openclaw.json..." -ForegroundColor Yellow
$config = Get-Content $configPath -Raw | ConvertFrom-Json -Depth 20

if (-not $config.agents) { $config | Add-Member -NotePropertyName "agents" -NotePropertyValue @{} -Force }
if (-not $config.agents.defaults) { $config.agents | Add-Member -NotePropertyName "defaults" -NotePropertyValue @{} -Force }
if (-not $config.agents.defaults.subagents) { $config.agents.defaults | Add-Member -NotePropertyName "subagents" -NotePropertyValue @{} -Force }

$config.agents.defaults.subagents | Add-Member -NotePropertyName "maxSpawnDepth" -NotePropertyValue 2 -Force
$config.agents.defaults.subagents | Add-Member -NotePropertyName "maxChildrenPerAgent" -NotePropertyValue 8 -Force
$config.agents.defaults.subagents | Add-Member -NotePropertyName "runTimeoutSeconds" -NotePropertyValue 900 -Force
$config.agents.defaults.subagents | Add-Member -NotePropertyName "model" -NotePropertyValue $Model -Force

$allowList = $agents | ForEach-Object { $_.id }
$mainAgent = @{ id="main"; default=$true; name="Main Assistant"; workspace="~/.openclaw/workspace"; subagents=@{ allowAgents=$allowList } }

$agentsList = @($mainAgent)
foreach ($agent in $agents) {
    $entry = @{ id=$agent.id; name=$agent.name; workspace="~/.openclaw/workspace-$($agent.id)" }
    if ($agent.id -eq "pm") {
        $entry.subagents = @{ allowAgents = $allowList }
    }
    $agentsList += $entry
}
$config.agents | Add-Member -NotePropertyName "list" -NotePropertyValue $agentsList -Force

$config | ConvertTo-Json -Depth 20 | Set-Content $configPath -Encoding UTF8
Write-Host "  ✅ Config updated with $($agents.Count) agents" -ForegroundColor Green

# --- Step 3: Create GitHub labels ---
Write-Host "`n🏷️ Creating GitHub labels..." -ForegroundColor Yellow
$labels = @(
    "epic,0052CC,Epic - large feature group",
    "user-story,1D76DB,User story",
    "task,5319E7,Implementation task",
    "needs-architecture,D93F0B,Waiting for Architect review",
    "architecture-approved,0E8A16,Architecture approved",
    "db-design,FBCA04,Needs DB schema design",
    "schema-ready,0E8A16,DB schema is ready",
    "ready-for-dev,0E8A16,Ready for development",
    "ready-for-ui,1D76DB,Ready for UI implementation",
    "in-progress,FBCA04,Currently being worked on",
    "pr-open,C5DEF5,PR has been opened",
    "needs-review,D93F0B,Needs code review",
    "review-approved,0E8A16,Code review passed",
    "needs-security-review,B60205,Needs security review",
    "security-approved,0E8A16,Security review passed",
    "needs-api-review,D93F0B,Needs API best practices review",
    "api-approved,0E8A16,API review passed",
    "needs-test,D93F0B,Needs test coverage",
    "tests-passing,0E8A16,All tests passing",
    "needs-cicd,D93F0B,Needs CI/CD setup",
    "needs-infra,D93F0B,Needs infrastructure provisioning",
    "infra-ready,0E8A16,Infrastructure provisioned",
    "deployed-staging,0E8A16,Deployed to staging",
    "deployed-prod,0E8A16,Deployed to production",
    "blocker,B60205,Blocked by dependency",
    "priority-high,B60205,High priority",
    "priority-medium,FBCA04,Medium priority",
    "priority-low,0E8A16,Low priority"
)
foreach ($l in $labels) {
    $parts = $l.Split(",")
    gh label create $parts[0] --repo $Repo --color $parts[1] --description $parts[2] --force 2>&1 | Out-Null
}
Write-Host "  ✅ $($labels.Count) labels created" -ForegroundColor Green

# --- Step 4: Create GitHub Project ---
Write-Host "`n📊 Creating GitHub Project board..." -ForegroundColor Yellow
$projectJson = gh project create --owner $owner --title "$repoName Development" --format json 2>&1
$project = $projectJson | ConvertFrom-Json
$projectNumber = $project.number
$projectId = $project.id

$repoId = gh repo view $Repo --json id --jq '.id' 2>&1
gh api graphql -f query="mutation { linkProjectV2ToRepository(input: { projectId: `"$projectId`", repositoryId: `"$repoId`" }) { repository { name } } }" 2>&1 | Out-Null
gh project field-create $projectNumber --owner $owner --name "Agent" --data-type "SINGLE_SELECT" --single-select-options "PO,PM,Architect,Senior Dev,UI,DB,QA,Security,API,CI/CD,Code Review,Infra" 2>&1 | Out-Null
Write-Host "  ✅ Project #$projectNumber created and linked" -ForegroundColor Green

# --- Step 4b: Get project field IDs for board sync ---
Write-Host "  📋 Fetching board field IDs..." -ForegroundColor Yellow
$fieldsJson = gh project field-list $projectNumber --owner $owner --format json 2>&1 | ConvertFrom-Json
$statusField = $fieldsJson.fields | Where-Object { $_.name -eq "Status" }
$statusFieldId = $statusField.id
$inProgressOpt = ($statusField.options | Where-Object { $_.name -eq "In Progress" }).id
$doneOpt = ($statusField.options | Where-Object { $_.name -eq "Done" }).id
Write-Host "  ✅ Status field: $statusFieldId (InProgress=$inProgressOpt, Done=$doneOpt)" -ForegroundColor Green


# --- Step 4c: Enable branch protection ---
Write-Host "  🔒 Enabling branch protection..." -ForegroundColor Yellow
$defaultBranch = gh repo view $Repo --json defaultBranchRef --jq '.defaultBranchRef.name' 2>&1
$protBody = '{"required_pull_request_reviews":{"dismiss_stale_reviews":false,"require_code_owner_reviews":false,"required_approving_review_count":0},"enforce_admins":true,"restrictions":null,"required_status_checks":null}'
try {
    $protBody | gh api "repos/$Repo/branches/$defaultBranch/protection" -X PUT --input - 2>&1 | Out-Null
    Write-Host "  ✅ Branch protection enabled (enforce_admins: true)" -ForegroundColor Green
} catch {
    Write-Host "  ⚠️  Branch protection failed (may need admin access)" -ForegroundColor Yellow
}
# --- Step 5: Setup orchestrator cron ---
Write-Host "`n🤖 Setting up pipeline orchestrator cron..." -ForegroundColor Yellow
$orchestratorPrompt = (Get-Content (Join-Path $skillDir "references" "orchestrator-prompt.md") -Raw) -replace '\{REPO\}', $Repo -replace '\{OWNER\}', $owner -replace '\{PROJECT_ID\}', $projectId -replace '\{PROJECT_NUMBER\}', $projectNumber -replace '\{STATUS_FIELD_ID\}', $statusFieldId -replace '\{IN_PROGRESS_OPT\}', $inProgressOpt -replace '\{DONE_OPT\}', $doneOpt

$cronArgs = @("cron", "add", "--name", "pipeline-orchestrator", "--every", $CronInterval, "--message", $orchestratorPrompt, "--agent", "pm", "--model", $Model, "--session", "isolated", "--timeout-seconds", "300", "--description", "Polls GitHub issues and spawns agents for ready tasks")
if ($TelegramChatId) {
    $cronArgs += @("--announce", "--to", "telegram:$TelegramChatId")
}
& openclaw @cronArgs 2>&1 | Out-Null
Write-Host "  ✅ Orchestrator cron (every $CronInterval)" -ForegroundColor Green

# --- Step 6: Restart gateway ---
Write-Host "`n🔄 Restarting gateway..." -ForegroundColor Yellow
openclaw gateway restart 2>&1 | Out-Null
Start-Sleep 3
Write-Host "  ✅ Gateway restarted" -ForegroundColor Green

Write-Host "`n🎉 Agent Factory setup complete!" -ForegroundColor Cyan
Write-Host "  Agents: $($agents.Count)" -ForegroundColor White
Write-Host "  Project: https://github.com/orgs/$owner/projects/$projectNumber" -ForegroundColor White
Write-Host "  Labels: $($labels.Count)" -ForegroundColor White
Write-Host "  Orchestrator: every $CronInterval" -ForegroundColor White
Write-Host "`n  Next: Spawn PO agent with your vision to begin!" -ForegroundColor Yellow


