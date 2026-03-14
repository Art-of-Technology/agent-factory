# Codebase RAG

Semantic code search for AI agents. Index any repository into Qdrant vector DB and query it with natural language.

## Requirements

- Node.js 20+
- [Qdrant](https://qdrant.tech/) running (Docker recommended)
- OpenAI API key (for embeddings)

## Setup

```bash
npm install

# Start Qdrant if not running
docker run -d --name qdrant -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant:latest
```

## Usage

### Index a Repository

```bash
OPENAI_API_KEY=sk-... \
QDRANT_URL=http://localhost:6333 \
REPO_PATH=/path/to/repo \
COLLECTION=my-repo \
node indexer.js
```

**Environment Variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | (required for openai) | OpenAI API key for embeddings |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant REST API URL |
| `REPO_PATH` | `.` | Path to repository to index |
| `COLLECTION` | `codebase` | Qdrant collection name |
| `EMBEDDING_PROVIDER` | `openai` | `openai` or `ollama` |
| `OPENAI_MODEL` | `text-embedding-3-large` | OpenAI embedding model |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_MODEL` | `nomic-embed-text` | Ollama embedding model |

### Search

```bash
OPENAI_API_KEY=sk-... \
QDRANT_URL=http://localhost:6333 \
COLLECTION=my-repo \
node search.js "how is risk score calculated"
```

**Options:**
```bash
node search.js --top 10 "detection orchestrator"   # More results
JSON_OUTPUT=1 node search.js "query"                # JSON output
```

## How It Works

### Indexing
1. Walks the repo, collecting `.ts`, `.tsx`, `.js`, `.jsx`, `.sql`, `.md` files
2. Skips: `node_modules`, `.git`, `.next`, `dist`, `coverage`, test fixtures
3. Chunks files at function/class/export boundaries
4. Small files (<80 lines) → single chunk
5. Large chunks (>8000 chars) → split into ~60-line sub-chunks
6. Embeds with OpenAI `text-embedding-3-small` (1536 dimensions)
7. Upserts to Qdrant with metadata (file path, line numbers, chunk type)

### Searching
1. Embeds query with same model
2. Cosine similarity search in Qdrant
3. Returns top-K results with file path, line numbers, and code content

## Cost

- `text-embedding-3-small`: ~$0.02 per 1M tokens
- A 4000-file repo (~44K chunks) costs ~$0.50 to index
- Searches cost ~$0.0001 each

## Supported File Types

| Extension | Chunking Strategy |
|-----------|-------------------|
| `.ts`, `.tsx` | Function/class/export boundaries |
| `.js`, `.jsx` | Function/class/export boundaries |
| `.sql` | Full file or statement boundaries |
| `.md` | Full file or heading boundaries |
