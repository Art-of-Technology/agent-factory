# Contributing to Agent Factory

Thank you for your interest in contributing! Agent Factory turns any GitHub repo into an autonomous AI development pipeline. Here's how you can help.

## Code of Conduct

Be respectful, constructive, and inclusive. We're building tools that augment human developers — not replace them.

## Getting Started

### Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed and running
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated
- Node.js 20+
- Docker (for Qdrant vector DB)

### Local Setup

```bash
# 1. Fork and clone
git clone https://github.com/<your-fork>/agent-factory.git
cd agent-factory

# 2. Install codebase RAG dependencies
cd codebase-rag
npm install
cd ..
```

### Codebase RAG Setup

Agent Factory uses **Qdrant** (vector DB) + **OpenAI embeddings** to give agents semantic code search over any repository.

```bash
# 1. Start Qdrant
docker run -d --name qdrant \
  --restart unless-stopped \
  -p 6333:6333 -p 6334:6334 \
  -v qdrant_storage:/qdrant/storage \
  qdrant/qdrant:latest

# 2. Verify Qdrant is running
curl http://localhost:6333/collections
# → {"result":{"collections":[]},"status":"ok"}

# 3. Index a repository
cd codebase-rag
OPENAI_API_KEY=sk-... \
QDRANT_URL=http://localhost:6333 \
REPO_PATH=/path/to/your/repo \
COLLECTION=your-repo-name \
node indexer.js

# 4. Search the codebase
OPENAI_API_KEY=sk-... \
QDRANT_URL=http://localhost:6333 \
COLLECTION=your-repo-name \
node search.js "how is risk score calculated"
```

**Alternative: Ollama (local, free)**

If you have a GPU and Ollama installed, you can use `nomic-embed-text` instead of OpenAI:

```bash
ollama pull nomic-embed-text
# Then modify indexer.js to use Ollama's embedding endpoint
```

## Project Structure

```
agent-factory/
├── SKILL.md                     # OpenClaw skill definition
├── codebase-rag/                # Vector search for agent context
│   ├── indexer.js               # Repo → Qdrant indexer
│   ├── search.js                # Semantic code search CLI
│   └── package.json
├── assets/
│   └── soul-templates/          # SOUL.md for each agent role
├── references/
│   ├── labels.md                # GitHub label definitions
│   ├── workflow-rules.md        # Agent workflow rules
│   └── orchestrator-prompt.md   # Cron job prompt
├── scripts/
│   ├── setup-agents.ps1         # Windows setup
│   └── setup-agents.sh          # Linux/Mac setup
└── docs/
    └── IMPROVEMENTS.md          # Lessons learned
```

## How to Contribute

### Areas We Need Help

1. **Agent Prompts** — Reduce hallucination, improve code quality
2. **Codebase RAG** — Better chunking strategies, support more languages
3. **Orchestrator Logic** — Dependency resolution, smarter scheduling
4. **Embedding Providers** — Ollama/local model support, Cohere, etc.
5. **Documentation** — Deployment guides, tutorials, examples
6. **Agent Templates** — New specialist agents (e.g., ML engineer, DevOps)

### Reporting Issues

1. Check [existing issues](https://github.com/Art-of-Technology/agent-factory/issues) first
2. Include: what you expected, what happened, your environment
3. For agent quality issues, include the agent prompt and output

### Submitting Code

#### Branch Naming
```
feat/short-description      # New features
fix/short-description       # Bug fixes
docs/short-description      # Documentation
```

#### Workflow
1. Fork the repository
2. Create a branch from `main`
3. Make changes
4. Test locally (index a repo, run a search)
5. Open a Pull Request

#### Commit Messages
```
feat: add Ollama embedding support
fix: handle empty files in indexer chunking
docs: add deployment guide for Kubernetes
refactor: extract chunking logic into module
```

### Code Guidelines

#### JavaScript/Node.js (codebase-rag)
- ES Modules (`import/export`)
- No unnecessary dependencies (keep it lightweight)
- Error handling with retries for API calls
- Rate limit awareness (embedding APIs)

#### Agent Templates (soul-templates)
- Clear role definition — what the agent IS and ISN'T
- Explicit constraints — file patterns, tools, boundaries
- Example outputs — show what good looks like
- Failure modes — what to do when stuck

#### Scripts
- Support both PowerShell and Bash
- Idempotent — safe to run multiple times
- Clear error messages

## Architecture Decisions

| Decision | Reason |
|----------|--------|
| Qdrant over Pinecone | Self-hosted, free, Docker-native |
| OpenAI embeddings | Best quality, `text-embedding-3-small` is cheap (~$0.02/M tokens) |
| Function-level chunking | Better retrieval than file-level for code |
| GitHub Labels as state | Universal, no custom infra, auditable |
| Max 3 agents per run | Cost control + API rate limits |
| Claude Opus for agents | Quality over cost for code generation |

## Testing

### Test Indexer
```bash
# Index a small test repo
REPO_PATH=./test-fixtures COLLECTION=test node codebase-rag/indexer.js

# Verify points were created
curl http://localhost:6333/collections/test
```

### Test Search
```bash
node codebase-rag/search.js "function that handles authentication"
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Questions? Open a [Discussion](https://github.com/Art-of-Technology/agent-factory/discussions) 🏭
