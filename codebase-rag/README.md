# Codebase RAG

Semantic code search for AI agents. Index any repository into Qdrant vector DB, query with natural language, and optionally rerank results with Cohere.

## Requirements

- Node.js 20+
- [Qdrant](https://qdrant.tech/) running (Docker recommended)
- OpenAI API key (for embeddings)
- Cohere API key (optional, for reranking)

## Quick Start

```bash
npm install

# Configure (stored in .env, gitignored)
node config.js set OPENAI_API_KEY sk-proj-...
node config.js set COHERE_API_KEY xxxx          # optional, enables reranking
node config.js set QDRANT_URL http://localhost:6333
node config.js set COLLECTION my-repo

# Index a repo
REPO_PATH=/path/to/repo node indexer.js

# Search
node search.js "how is risk score calculated"
```

## Config

All settings stored in `.env` (auto-loaded, gitignored). Manage with `config.js`:

```bash
node config.js set <key> <value>    # Set a value
node config.js get <key>            # Get a value
node config.js delete <key>         # Remove a value
node config.js list                 # List all config
```

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | (required for openai) | OpenAI API key |
| `COHERE_API_KEY` | (optional) | Cohere API key — enables reranking |
| `COHERE_RERANK_MODEL` | `rerank-v3.5` | Cohere rerank model |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant REST API URL |
| `REPO_PATH` | `.` | Path to repository to index |
| `COLLECTION` | `codebase` | Qdrant collection name |
| `EMBEDDING_PROVIDER` | `openai` | `openai` or `ollama` |
| `OPENAI_MODEL` | `text-embedding-3-large` | OpenAI embedding model |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_MODEL` | `nomic-embed-text` | Ollama embedding model |

Environment variables always take precedence over `.env` values.

## Indexing

```bash
# Full reindex (drops and recreates collection)
REPO_PATH=/path/to/repo node indexer.js

# Incremental (only changed files since last commit)
REPO_PATH=/path/to/repo node indexer.js --incremental

# Incremental since specific ref
REPO_PATH=/path/to/repo node indexer.js -i --since HEAD~3

# Force drop + full rebuild
REPO_PATH=/path/to/repo node indexer.js --force-recreate
```

| Flag | Short | Description |
|------|-------|-------------|
| `--incremental` | `-i` | Index only changed files (via `git diff`) |
| `--since <ref>` | | Diff base for incremental (default: `HEAD~1`) |
| `--force-recreate` | `-f` | Drop collection and full reindex |

## Searching

```bash
# Basic search
node search.js "OAuth token validation"

# More results
node search.js --top 10 "detection orchestrator"

# Skip Cohere reranking (vector-only)
node search.js --no-rerank "risk score calculation"

# JSON output
JSON_OUTPUT=1 node search.js "query"
```

| Flag | Short | Description |
|------|-------|-------------|
| `--top` | `-n` | Number of results (default: 5) |
| `--no-rerank` | | Skip Cohere reranking |
| `--help` | `-h` | Show help |

### Cohere Reranking

When `COHERE_API_KEY` is set, search automatically:
1. Fetches 3× more results from Qdrant (better recall)
2. Reranks with Cohere `rerank-v3.5` (semantic relevance)
3. Returns top K with both relevance and vector scores

Output shows both scores:
```
━━━ apps/auth/lib/token.ts (L12-45) [code] relevance: 0.533 (vector: 0.442) ━━━
```

## How It Works

### Indexing
1. Walks the repo, collecting `.ts`, `.tsx`, `.js`, `.jsx`, `.sql`, `.md` files
2. Skips: `node_modules`, `.git`, `.next`, `dist`, `coverage`, test fixtures
3. Chunks files at function/class/export boundaries
4. Small files (<80 lines) → single chunk
5. Large chunks (>8000 chars) → split into ~60-line sub-chunks
6. Embeds with OpenAI `text-embedding-3-large` (3072 dimensions)
7. Upserts to Qdrant with metadata (file path, line numbers, chunk type)

### Searching
1. Embeds query with same embedding model
2. Cosine similarity search in Qdrant
3. (Optional) Reranks results with Cohere for better relevance
4. Returns top-K results with file path, line numbers, and code content

## Cost

- `text-embedding-3-large`: ~$0.13 per 1M tokens
- Cohere rerank: ~$2.00 per 1000 searches
- A 2000-file repo (~15K chunks) costs ~$0.50 to index
- Each search: ~$0.001 (embedding) + ~$0.002 (rerank)

## Supported File Types

| Extension | Chunking Strategy |
|-----------|-------------------|
| `.ts`, `.tsx` | Function/class/export boundaries |
| `.js`, `.jsx` | Function/class/export boundaries |
| `.sql` | Full file or statement boundaries |
| `.md` | Full file or heading boundaries |
