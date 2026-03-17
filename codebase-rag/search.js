/**
 * Codebase RAG Search
 * 
 * Semantic search over an indexed codebase in Qdrant.
 * Returns relevant code chunks for a natural language query.
 * 
 * Environment variables:
 *   EMBEDDING_PROVIDER  - 'openai' (default) or 'ollama'
 *   OPENAI_API_KEY      - Required when provider=openai
 *   OPENAI_MODEL        - OpenAI model (default: text-embedding-3-large)
 *   OLLAMA_URL          - Ollama API URL (default: http://localhost:11434)
 *   OLLAMA_MODEL        - Ollama model (default: nomic-embed-text)
 *   QDRANT_URL          - Qdrant REST API (default: http://localhost:6333)
 *   COLLECTION          - Qdrant collection name (default: codebase)
 *   JSON_OUTPUT         - Set to '1' for JSON output
 * 
 * Usage:
 *   OPENAI_API_KEY=sk-... node search.js "how is risk score calculated"
 *   OPENAI_API_KEY=sk-... node search.js --top 10 "detection orchestrator"
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

// --- Auto-load .env from script directory ---
const __scriptDir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__scriptDir, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = process.env.COLLECTION || 'codebase';
const PROVIDER = process.env.EMBEDDING_PROVIDER || 'openai';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'nomic-embed-text';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'text-embedding-3-large';

let openai = null;
function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai');
      process.exit(1);
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

/**
 * Get embedding for a query string.
 * @param {string} text 
 * @returns {Promise<number[]>}
 */
async function getQueryEmbedding(text) {
  if (PROVIDER === 'ollama') {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      throw new Error(`Ollama embedding failed (HTTP ${res.status}): ${body}`);
    }
    const data = await res.json();
    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error(`Ollama returned invalid embedding for model "${OLLAMA_MODEL}"`);
    }
    return data.embedding;
  }

  const response = await getOpenAIClient().embeddings.create({
    model: OPENAI_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Search the Qdrant collection.
 * @param {string} query
 * @param {number} topK
 */
async function search(query, topK = 5) {
  // Check Qdrant is reachable
  try {
    const healthRes = await fetch(QDRANT_URL, { signal: AbortSignal.timeout(5000) });
    if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`);
  } catch (err) {
    console.error(`❌ Cannot reach Qdrant at ${QDRANT_URL}: ${err.message}`);
    process.exit(1);
  }

  // Check collection exists
  const colRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, { signal: AbortSignal.timeout(5000) });
  if (!colRes.ok) {
    console.error(`❌ Collection "${COLLECTION}" not found. Run indexer first.`);
    process.exit(1);
  }

  const queryVector = await getQueryEmbedding(query);

  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vector: queryVector,
      limit: topK,
      with_payload: true,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown');
    throw new Error(`Search failed (HTTP ${res.status}): ${body}`);
  }

  const data = await res.json();

  return data.result.map(hit => ({
    score: hit.score,
    file: hit.payload.file_path,
    lines: `${hit.payload.start_line}-${hit.payload.end_line}`,
    type: hit.payload.chunk_type,
    content: hit.payload.content,
  }));
}

// --- CLI ---
const args = process.argv.slice(2);
let topK = 5;
let query = '';

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--top' || args[i] === '-n') && args[i + 1]) {
    topK = parseInt(args[i + 1], 10);
    if (isNaN(topK) || topK < 1) {
      console.error('❌ --top must be a positive integer');
      process.exit(1);
    }
    i++;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node search.js [--top N] "your query"');
    console.log('');
    console.log('Options:');
    console.log('  --top, -n N    Number of results (default: 5)');
    console.log('  --help, -h     Show this help');
    console.log('');
    console.log('Environment:');
    console.log('  OPENAI_API_KEY, QDRANT_URL, COLLECTION, EMBEDDING_PROVIDER');
    process.exit(0);
  } else {
    query += (query ? ' ' : '') + args[i];
  }
}

if (!query) {
  console.error('❌ No query provided.');
  console.error('Usage: node search.js [--top N] "your query"');
  process.exit(1);
}

console.log(`🔍 Searching: "${query}" (top ${topK}) [${PROVIDER}/${PROVIDER === 'ollama' ? OLLAMA_MODEL : OPENAI_MODEL}]\n`);

try {
  const results = await search(query, topK);

  if (results.length === 0) {
    console.log('No results found.');
    process.exit(0);
  }

  for (const r of results) {
    console.log(`━━━ ${r.file} (L${r.lines}) [${r.type}] score: ${r.score.toFixed(3)} ━━━`);
    const lines = r.content.split('\n').slice(0, 12);
    console.log(lines.join('\n'));
    if (r.content.split('\n').length > 12) console.log('  ...');
    console.log();
  }

  if (process.env.JSON_OUTPUT === '1') {
    console.log('\n---JSON---');
    console.log(JSON.stringify(results, null, 2));
  }
} catch (err) {
  console.error(`❌ Search failed: ${err.message}`);
  process.exit(1);
}
