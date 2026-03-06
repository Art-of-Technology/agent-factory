# Agent Timeout Root Cause Analysis

## Timeout Patterns Observed

### 1. Orchestrator Cron (PM agent)
- Prompt: 7,831 chars with 12 steps
- Runs 10 `gh issue list` queries sequentially
- Board sync runs complex PowerShell loop
- Each run: ~5-10 min just for scanning
- Spawns agents which add to gateway load

### 2. Senior Dev Agent
- SOUL.md: 12,457 bytes (massive)
- "Pre-PR Verification" section says: run type-check, lint, test
- Agent spends 50-80% of time running builds/checks
- PowerShell template literal issues cause retry loops
- Turbo build takes 30-40s per attempt, fails, retries

### 3. UI Agent
- Same SOUL.md pattern
- Also tries to run builds
- Node/bun install sometimes triggered

## Root Causes (Priority Order)

### RC1: SOUL.md tells agents to run builds (CRITICAL)
```
## Pre-PR Verification (MANDATORY — run before opening ANY PR)
bun run type-check 2>&1
bun run lint 2>&1
bun run test 2>&1
```
This is in every dev agent's SOUL.md. Agent reads "MANDATORY" and spends 10+ minutes on build loops.

### RC2: Orchestrator does too much per run
- Board sync (Step 0) — loops through all project items
- 10 label queries (Step 1)
- Dependency checking (Step 2)
- Active agent check (Step 3)
- Spawn + label update (Step 4-5)
Total: ~50+ API calls per 5-min cron

### RC3: Agent prompt too large
- SOUL.md: 12KB of instructions
- Task prompt: 500-2000 chars
- Combined context: 15-20K tokens before agent starts
- Leaves less budget for actual work

### RC4: PowerShell incompatibility
- Agents use bash syntax (&&, template literals, heredocs)
- PowerShell fails, agent retries with different syntax
- 3-5 retry cycles wasted per file write

### RC5: Single repo shared by all agents
- Git lock conflicts when 2+ agents work on same repo
- `git checkout master && git pull` can fail mid-operation
- No isolation between agent workspaces for the same repo
