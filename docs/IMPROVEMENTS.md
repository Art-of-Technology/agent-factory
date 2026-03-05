# 🤖 Multi-Agent Pipeline — Improvements & Lessons Learned

## Overview
12 AI agents collaborating via GitHub Issues/Projects to build ProblemRadar — a signal aggregation platform. 60+ tasks, 45+ PRs merged across 4 sprints in ~72 hours.

---

## 🔧 Problems Encountered & Fixes

### 1. Agent Timeout (15min too short)
**Problem:** Agents were timing out at 900s (15min) before finishing tasks. They'd write code, then run `turbo build` / `tsc` to verify, hit errors, try to fix them, and run out of time.

**Fix:**
- Increased `runTimeoutSeconds` from 900 → 1800 (30min)
- Added explicit instruction: **"DO NOT run builds or typechecks. Just write files, commit, push, PR."**
- Result: Agents complete tasks in 10-15 min instead of timing out

**Lesson:** Agents waste most time on build verification loops. For feature work, "write and push" is faster — let CI catch issues.

### 2. Stale Labels on Closed Issues
**Problem:** 38 closed issues still had `in-progress` label. Agents would add `in-progress` when starting work but never clean up after PR merge.

**Fix:**
- Bulk cleanup script: `gh issue edit <num> --remove-label "in-progress"` for all closed issues
- Added label cleanup to the Code Review agent's merge flow

**Lesson:** Label state machine needs explicit cleanup on every state transition. "Closed" is not enough — labels must reflect the final state.

### 3. Project Board Out of Sync
**Problem:** GitHub Project Board "Status" field is independent from issue labels. Closed issues stayed "In Progress" on the board even after merge.

**Fix:**
- Added "Step 0: Board Sync" to the orchestrator cron — checks label state vs board status and fixes mismatches
- Manual bulk fix for 26+ stale board items

**Lesson:** Board status ≠ issue state. Need explicit sync logic. GitHub doesn't auto-move board items when issues close.

### 4. Cron Delivery Errors
**Problem:** 3 cron jobs (Orchestrator, Merge Bot, Octopus Orchestrator) had missing `delivery.to` field → silent failures ("No delivery target").

**Fix:** Edited `~/.openclaw/cron/jobs.json` directly, added `"to": "telegram:6321082392"` to all delivery configs, reset error counters.

**Lesson:** Always verify cron delivery config after creation. Test with a manual trigger before relying on it.

### 5. Branch Protection Blocking Direct Push
**Problem:** `enforce_admins: true` on master blocked even admin pushes (needed for hotfixes/UI tweaks).

**Fix:** Temporarily disable `enforce_admins`, push, re-enable:
```powershell
# Disable
gh api repos/OWNER/REPO/branches/master/protection -X PUT --input body.json
git push origin master
# Re-enable
gh api repos/OWNER/REPO/branches/master/protection -X PUT --input body.json
```

**Lesson:** Keep `enforce_admins: true` for agents but have a documented bypass flow for human hotfixes.

### 6. Agent Config Key Name
**Problem:** Agents were configured under `agents.items` — OpenClaw expects `agents.list`. Config validation silently ignored the wrong key.

**Fix:** Renamed to `agents.list` in `openclaw.json`.

**Lesson:** Always check OpenClaw docs for exact config schema.

### 7. PowerShell vs Bash Incompatibility
**Problem:** Agents running on Windows would use `&&` (bash syntax) which fails in PowerShell. Template literals with `${}` also break.

**Fix:**
- Use `;` instead of `&&` in PowerShell
- Write files via `Set-Content` or node scripts instead of heredocs
- Add PowerShell-specific notes in agent SOUL.md files

**Lesson:** If agents run on Windows, explicitly state PowerShell syntax rules in their system prompt.

### 8. Prisma Client Stale After Deploy
**Problem:** Docker build generated Prisma client with old schema. New columns existed in DB but client didn't know about them → `P2022` errors.

**Fix:**
- Regenerate client inside container: `bunx prisma@6.19.2 generate`
- Long-term: `docker compose up --build --no-cache` for full rebuild
- Added `COPY prisma/schema.prisma` before `bun install` in Dockerfile

**Lesson:** Prisma client is generated at build time. Schema changes require image rebuild, not just DB migration.

### 9. Gateway Timeout Under Load
**Problem:** Spawning 3+ concurrent agents would cause gateway timeout (10s). WebSocket connections pile up.

**Fix:**
- Limit concurrent spawns to 2-3
- Add delay between spawn calls
- Gateway restart if stuck

**Lesson:** Don't spawn too many agents simultaneously. Queue them or use the orchestrator cron's max-3-per-run limit.

---

## 📊 Pipeline Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  PO Agent   │────▶│  PM Agent    │────▶│ Orchestrator│
│ (Vision)    │     │ (Sprint Plan)│     │ (Cron 5min) │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                    Scans labels, spawns agents  │
                    ┌───────────────────────────┘
                    ▼
    ┌───────────────────────────────────────────┐
    │            Agent Pool (12 agents)          │
    │                                            │
    │  Architect → DB → Senior Dev → UI          │
    │  QA → Security → API → CI/CD → Infra       │
    │                                            │
    │  Code Review (merges PRs, quality gate)     │
    └───────────────────────────────────────────┘
                    │
                    ▼
    ┌───────────────────────────────────────────┐
    │          Label State Machine               │
    │                                            │
    │  needs-architecture → architecture-approved │
    │  → ready-for-dev → in-progress → pr-open   │
    │  → needs-review → merged → done            │
    └───────────────────────────────────────────┘
```

## 🔑 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| GitHub Issues as communication layer | Universal, searchable, audit trail |
| Labels as state machine | Simple, visible, no custom infra needed |
| Code Review as only merger | Quality gate, prevents bad code from landing |
| Max 3 agents per cron run | Cost control, prevents gateway overload |
| 30min timeout per agent | Enough for single task, not enough to waste money |
| "No builds" rule for agents | 80% of timeout failures were build verification loops |
| Opus for all agents | Quality > cost. Cheaper models produced worse PRs |
| Feature branch → PR → merge | Never push to master. Always reviewable |

## 📈 Results

- **Sprint 1:** 20/20 tasks, 14 PRs — Signal Pipeline & Idea Analyzer
- **Sprint 2:** 18/19 tasks, 16 PRs — Real-time Alerts & Notifications  
- **Sprint 3:** 20/20 tasks, 15 PRs — Billing & API Platform
- **Sprint 4:** 9/17 done (in progress) — Conversational AI Project Builder
- **Total:** 67+ tasks, 45+ PRs merged in ~72 hours
- **Production:** Live at app.problemradar.ai with 9,400+ signals

## 🚀 What's Next

- Automated PR conflict resolution (rebase agent)
- Better board sync (webhook-based instead of polling)
- Agent performance metrics (time-to-PR, review scores)
- Multi-repo orchestration (ProblemRadar + Octopus parallel)
