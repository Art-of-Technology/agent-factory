---
name: codebase-rag
description: "Semantic code search over indexed repositories. Use when you need to find how something is implemented, locate relevant files, understand architecture, or answer 'where is X done?' questions. Requires codebase-rag CLI and Qdrant."
---

# Codebase RAG

Semantic search over indexed codebases. Ask natural language questions, get relevant code chunks back.

## Quick Usage

```bash
# Search a collection
codebase-rag search "how is auth handled" --collection myproject

# More results
codebase-rag search "risk score calculation" --collection maestro-fraud --top 10

# JSON output (for programmatic use)
codebase-rag search "stripe webhook" --collection openclaw --json

# List available collections
codebase-rag collections
```

## Setup (one-time)

```bash
# Configure Qdrant + OpenAI
codebase-rag config --qdrant http://10.34.9.237:6333 --openai-key $OPENAI_API_KEY

# Index a repository (~$0.50 for large repos)
codebase-rag index --repo /path/to/repo --collection my-repo
```

## When to Use

- Finding where a feature is implemented: `codebase-rag search "billing subscription webhook"`
- Understanding patterns: `codebase-rag search "how are errors handled"`
- Locating files before editing: `codebase-rag search "user authentication middleware"`
- Architecture questions: `codebase-rag search "database connection pooling"`

## Output Format

Each result shows:
```
━━━ src/lib/auth.ts (L45-89) [code] score: 0.847 ━━━
<first 12 lines of the relevant code chunk>
```

Higher score = more relevant (max 1.0).

## Available Collections

Run `codebase-rag collections` to see what's indexed on this instance.
