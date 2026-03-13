# Workflow Rules — Agent Factory

Lessons learned from production use. All agents and orchestrators should follow these rules.

## Label System (Keep It Simple)

**Only 4 states matter:** `open` → `ready` → `pr-open` → `merged`

- `in-progress` — ONLY add when a PR is actually opened, not when an agent picks up an issue
- If an agent times out or fails, remove `in-progress` immediately
- Don't create dozens of workflow labels — they create noise and go stale
- PR exists = in-progress. No PR = not in-progress. Period.

## Agent Work Rules

### Atomicity
- **1 issue = 1 agent = 1 PR** — no multi-issue PRs, no multi-agent PRs
- Each PR should be small and focused (easier to review, fewer conflicts)
- If an issue is too big for one PR, split the issue first

### Concurrency
- **Max 3 agents working simultaneously** — more causes merge conflicts
- **Sequential merge** — merge PRs one at a time, rebase the next one after each merge
- Never merge multiple PRs in parallel — they WILL conflict

### Failure Handling
- If agent times out → remove `in-progress` label, leave issue as `ready`
- If PR gets rejected → add `needs-fix` label, don't create a new PR
- If rebase fails (diverged history) → close PR, cherry-pick to clean branch

## Code Review (Octopus)

### Merge Threshold
- **3/5 overall + 0 findings = OK to merge**
- 4/5 is ideal but not required — base code quality from agents rarely reaches 4/5
- Don't get stuck in endless fix cycles chasing 4/5

### False Positives
- Document FPs as PR comments with `🟢 False Positive:` prefix and explanation
- Common Octopus FPs:
  - Parameterized SQL flagged as "SQL injection" (look for `$1, $2` placeholders)
  - Test code flagged for missing production-grade error handling
  - Cleanup jobs flagged for "race conditions" (acceptable for housekeeping)
  - Test fixtures flagged for "hardcoded values" (that's what fixtures ARE)

### Test PRs
- PRs tagged `#test`, `#e2e`, `#perf` have relaxed review standards
- Test code != production code — don't apply the same rigor

## Git Rules

- **Never edit directly on production server** — always push to GitHub, pull on server
- **Sequential merge only** — 1 branch → merge → rebase next → merge
- **Same-day merge** — branch open >1 day = stale, risk of conflicts
- **Stale branches** (forked from old main) — never direct merge, use cherry-pick
- **Always `db push`, never `db migrate`** (Prisma rule for this project)

## Deploy Flow

```
local edit → git push → server: git pull → docker compose up -d --build
```

One deploy after all merges complete (batch deploys, don't deploy per-merge).
