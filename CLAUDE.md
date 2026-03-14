# CLAUDE.md — Agent Factory

## What Is This?
Multi-agent AI development pipeline. Deploy 12 specialized AI agents to any GitHub repo — they design, code, review, test, and deploy via GitHub Issues & Projects.

## Architecture

### Components
- **12 Agent Roles**: PO, PM, Architect, Senior Dev, UI, DB, QA, Security, API, CI/CD, Code Review, Infra
- **Codebase RAG**: Qdrant vector DB + embedding for semantic code search
- **Orchestrator**: Cron-based GitHub issue scanner → agent spawner
- **GitHub as backbone**: Issues = tasks, Labels = state machine, Projects = board

### Codebase RAG (codebase-rag/)
Gives agents semantic search over any codebase.

**Stack:**
- **Qdrant** — self-hosted vector DB (Docker, port 6333)
- **OpenAI `text-embedding-3-large`** — 3072 dim, best quality (default)
- **Ollama `nomic-embed-text`** — 768 dim, free local alternative

**Usage:**
```bash
# Index a repo (OpenAI)
OPENAI_API_KEY=sk-... QDRANT_URL=http://qdrant:6333 REPO_PATH=/path/to/repo node indexer.js

# Index a repo (Ollama — free, local)
EMBEDDING_PROVIDER=ollama OLLAMA_URL=http://gpu-server:11434 QDRANT_URL=http://qdrant:6333 REPO_PATH=/path/to/repo node indexer.js

# Search
OPENAI_API_KEY=sk-... QDRANT_URL=http://qdrant:6333 node search.js "how is scoring calculated"
```

**Chunking strategy:**
- Files < 80 lines → single chunk
- Larger files → split at function/class/export boundaries
- Large chunks (> 8000 chars) → sub-split at ~60 lines
- Skips: node_modules, .git, dist, coverage, test fixtures

### Label State Machine
```
open → ready → pr-open → merged
```
Only 4 labels needed. `in-progress` only when PR is actually opened.

### Agent Workflow
1. Issue created with label
2. Orchestrator cron scans every 5min
3. Matches label → spawns correct agent
4. Agent reads issue, writes code/spec, opens PR
5. Code Review agent reviews (≥ 4/5 to merge)
6. Max 3 agent spawns per cron run

## Directory Structure
```
agent-factory/
├── SKILL.md                    # OpenClaw skill definition
├── CLAUDE.md                   # This file
├── CONTRIBUTING.md             # Open source contribution guide
├── LICENSE                     # MIT
├── codebase-rag/               # Vector search for agent context
│   ├── indexer.js              # Repo → chunk → embed → Qdrant
│   ├── search.js               # Semantic search CLI
│   ├── package.json            # Dependencies (openai only)
│   └── README.md               # Usage docs
├── assets/
│   └── soul-templates/         # SOUL.md personality for each agent
├── references/
│   ├── labels.md               # GitHub label definitions
│   ├── workflow-rules.md       # Agent workflow rules
│   └── orchestrator-prompt.md  # Cron orchestrator prompt
├── scripts/
│   ├── setup-agents.ps1        # Windows setup
│   └── setup-agents.sh         # Linux/Mac setup
└── docs/
    └── IMPROVEMENTS.md         # Lessons learned
```

## Key Rules

### Agent Rules
- **1 issue = 1 agent = 1 PR** (atomic)
- **Max 3 spawns per orchestrator run** (cost + rate limit control)
- **Sequential merge**: 1 branch at a time, no parallel merges
- **Same-day merge mandatory** — branch > 1 day = stale
- **No builds in agent loop** — push code, CI catches errors
- **Claude Opus for all agents** — quality over cost

### Code Quality
- TypeScript strict, no `any`
- Small focused PRs
- Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`)
- Self-review before merge

### Embedding Provider Selection
| Use Case | Provider | Why |
|----------|----------|-----|
| Best retrieval quality | OpenAI `text-embedding-3-large` | ~5-8% better on code |
| Free / offline | Ollama `nomic-embed-text` | No API cost, needs GPU |
| Budget | OpenAI `text-embedding-3-small` | Cheaper, good enough |

## Lessons Learned
1. Agents produce stale branches — keep merge cycles short
2. Agent-written code often has import path errors — validate TS before deploy
3. 29 labels was overkill — simplified to 4-state system
4. Agents work best as spec writers / reviewers, not sole implementers
5. Codebase RAG dramatically improves agent code quality (context > prompting)
6. PowerShell ≠ Bash — specify syntax in agent prompts
7. Rate limit embedding API calls — add delays between batches

## Open TODOs
- [ ] Ollama embedding integration in indexer (dual provider done, needs testing)
- [ ] Auto-reindex on git push (webhook or cron)
- [ ] Agent performance metrics dashboard
- [ ] Dependency-aware orchestrator (issue ordering)
- [ ] Webhook-based board sync (vs polling)
