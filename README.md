# 🏭 Agent Factory

> Multi-agent AI development pipeline — 12 specialized agents collaborating via GitHub Issues & Projects

Turn any GitHub repo into an autonomous development factory. Agents design architecture, write code, review PRs, run tests, and deploy — all orchestrated through GitHub's native tooling.

## 🎯 What Is This?

Agent Factory is an [OpenClaw](https://github.com/openclaw/openclaw) skill that deploys **12 AI agents** to work on your codebase:

| Agent | Role |
|-------|------|
| **PO** (Product Owner) | Creates vision, epics, priorities |
| **PM** (Project Manager) | Sprint planning, task breakdown, orchestration |
| **Architect** | System design, tech decisions, architecture docs |
| **Senior Dev** | Core feature implementation |
| **UI Dev** | Frontend components, pages, styling |
| **DB Engineer** | Schema design, migrations, queries |
| **QA** | Test coverage, integration tests |
| **Security** | Security audits, vulnerability review |
| **API Reviewer** | API design review, consistency |
| **CI/CD** | Pipeline setup, deployment automation |
| **Code Review** | PR review, quality gate (only agent that merges) |
| **Infra** | Infrastructure, Docker, monitoring |

## 🔄 How It Works

```
GitHub Issue (with label) → Orchestrator Cron → Spawn Agent → PR → Code Review → Merge
```

1. **Labels as state machine** — each label triggers the right agent
2. **Orchestrator cron** (every 5min) scans issues, spawns agents
3. **Agents** read issues, write code, open PRs
4. **Code Review** reviews PRs with quality gate (≥ 4/5 score)
5. **Merge Bot** auto-merges approved PRs

### Label Flow
```
needs-architecture → architecture-approved → ready-for-dev → in-progress 
→ pr-open → needs-review → merged/done
```

## 🚀 Quick Start

### Prerequisites
- [OpenClaw](https://github.com/openclaw/openclaw) installed and running
- GitHub CLI (`gh`) authenticated
- A GitHub repo to deploy to

### Deploy to Your Repo

```bash
# 1. Clone this repo
git clone https://github.com/Art-of-Technology/agent-factory.git
cd agent-factory

# 2. Run setup (creates labels, project board, agent configs)
# PowerShell:
.\scripts\setup-agents.ps1 -Owner "your-org" -Repo "your-repo"
# Bash:
./scripts/setup-agents.sh your-org your-repo

# 3. Configure OpenClaw agents (see references/config-example.md)

# 4. Create orchestrator cron job
# See references/orchestrator-prompt.md
```

## 📁 Structure

```
agent-factory/
├── SKILL.md                    # OpenClaw skill definition
├── assets/
│   └── soul-templates/         # SOUL.md for each agent (personality + rules)
│       ├── architect.md
│       ├── senior-dev.md
│       ├── code-review.md
│       └── ... (12 agents)
├── references/
│   ├── labels.md               # 28 labels with colors & descriptions
│   ├── board-commands.md       # GitHub Project board setup
│   ├── config-example.md       # openclaw.json agent config
│   └── orchestrator-prompt.md  # Cron job prompt for PM orchestrator
├── scripts/
│   ├── setup-agents.ps1        # Windows setup script
│   └── setup-agents.sh         # Linux/Mac setup script
└── docs/
    └── IMPROVEMENTS.md         # Lessons learned & troubleshooting
```

## 📊 Results

Deployed on [ProblemRadar](https://github.com/Art-of-Technology/problem-radar):

- **67+ tasks** completed across 4 sprints
- **45+ PRs** merged autonomously
- **~72 hours** from zero to production
- **9,400+ signals** collected by the live app
- **3 concurrent projects** managed (ProblemRadar + Octopus)

## 🧠 Key Design Decisions

- **GitHub Issues as communication** — universal, searchable, no custom infra
- **Labels as state machine** — simple, visible, auditable
- **Code Review as only merger** — quality gate prevents bad code
- **Max 3 agents per cron run** — cost control + gateway stability
- **"No builds" rule** — agents write & push, CI catches errors (80% faster)
- **Claude Opus for all agents** — quality > cost

## ⚠️ Lessons Learned

See [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) for detailed troubleshooting:

1. Set agent timeout to 30min (15min too short)
2. Agents waste time on build loops — tell them "no builds, just push"
3. Board status ≠ issue state — need explicit sync
4. PowerShell ≠ Bash — specify syntax in agent prompts
5. Don't spawn 3+ agents simultaneously — gateway overload
6. Prisma client needs rebuild after schema changes

## 🔍 Codebase RAG (Vector Search)

Agents need context to write good code. Codebase RAG gives them semantic search over your entire repository.

### Architecture
```
Your Repo → Indexer (chunk + embed) → Qdrant → Agent queries → Relevant code chunks
```

### Stack
- **Qdrant** — Self-hosted vector DB (Docker)
- **OpenAI** `text-embedding-3-small` — 1536-dim embeddings
- **Ollama** `nomic-embed-text` — Free local alternative (GPU recommended)

### Quick Start
```bash
# Start Qdrant
docker run -d --name qdrant -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant:latest

# Index your repo
cd codebase-rag && npm install
OPENAI_API_KEY=sk-... REPO_PATH=/path/to/repo COLLECTION=my-repo node indexer.js

# Search
node search.js "how does authentication work"
```

### How It Works
1. **Walk** — Scans `.ts`, `.tsx`, `.js`, `.jsx`, `.sql`, `.md` files
2. **Chunk** — Splits at function/class boundaries (small files stay whole)
3. **Embed** — OpenAI `text-embedding-3-small` (batched, with retry + rate limiting)
4. **Index** — Upserts into Qdrant with file path, line numbers, chunk type metadata
5. **Search** — Query embedding → cosine similarity → top-K relevant chunks

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed setup instructions.

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Setting up the development environment
- Codebase RAG setup and testing
- Agent template guidelines
- Code style and PR process

### Areas We Need Help
- 🧠 Better agent prompts (reduce hallucination)
- 🔍 Improved code chunking strategies
- 🌐 More embedding providers (Ollama, Cohere, local models)
- 📚 Deployment guides and tutorials
- 🤖 New agent templates (ML engineer, DevOps, etc.)

## 📄 License

[MIT](LICENSE) — Art of Technology, 2026

---

Built with [OpenClaw](https://github.com/openclaw/openclaw) 🐾
