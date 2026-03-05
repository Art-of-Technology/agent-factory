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

## 🤝 Contributing

This is an evolving system. Improvements welcome:
- Better agent prompts (reduce hallucination)
- Smarter orchestrator (dependency resolution)
- Webhook-based board sync (vs polling)
- Agent performance metrics

## 📄 License

MIT

---

Built with [OpenClaw](https://github.com/openclaw/openclaw) 🐾
