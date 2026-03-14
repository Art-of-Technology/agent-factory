/**
 * Codebase RAG Search
 * 
 * Semantic search over indexed codebase.
 * Returns relevant code chunks for a natural language query.
 * 
 * Usage: 
 *   OPENAI_API_KEY=sk-... node search.js "how is risk score calculated"
 *   OPENAI_API_KEY=sk-... node search.js --top 10 "detection orchestrator"
 */

import OpenAI from 'openai';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = process.env.COLLECTION || 'maestro-fraud';
const EMBEDDING_MODEL = 'text-embedding-3-small';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function search(query, topK = 5) {
  // Get query embedding
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  });
  const queryVector = response.data[0].embedding;

  // Search Qdrant
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vector: queryVector,
      limit: topK,
      with_payload: true,
    }),
  });

  if (!res.ok) throw new Error(`Search failed: ${await res.text()}`);
  const data = await res.json();

  return data.result.map(hit => ({
    score: hit.score,
    file: hit.payload.file_path,
    lines: `${hit.payload.start_line}-${hit.payload.end_line}`,
    type: hit.payload.chunk_type,
    content: hit.payload.content,
  }));
}

// CLI usage
const args = process.argv.slice(2);
let topK = 5;
let query = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--top' && args[i + 1]) {
    topK = parseInt(args[i + 1]);
    i++;
  } else {
    query += (query ? ' ' : '') + args[i];
  }
}

if (!query) {
  console.error('Usage: node search.js [--top N] "your query"');
  process.exit(1);
}

console.log(`🔍 Searching: "${query}" (top ${topK})\n`);

const results = await search(query, topK);

for (const r of results) {
  console.log(`━━━ ${r.file} (L${r.lines}) [${r.type}] score: ${r.score.toFixed(3)} ━━━`);
  // Show first 10 lines of content
  const lines = r.content.split('\n').slice(0, 10);
  console.log(lines.join('\n'));
  if (r.content.split('\n').length > 10) console.log('  ...');
  console.log();
}

// Also output as JSON for programmatic use
if (process.env.JSON_OUTPUT === '1') {
  console.log('\n---JSON---');
  console.log(JSON.stringify(results, null, 2));
}
