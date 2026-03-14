/**
 * Codebase RAG Indexer
 * 
 * Indexes a git repository into Qdrant for semantic code search.
 * Chunks TypeScript/JavaScript files at function/class level.
 * Uses OpenAI text-embedding-3-small for embeddings.
 * 
 * Usage: OPENAI_API_KEY=sk-... REPO_PATH=/path/to/repo node indexer.js
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import OpenAI from 'openai';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const REPO_PATH = process.env.REPO_PATH || '.';
const COLLECTION = process.env.COLLECTION || 'maestro-fraud';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 50; // Embeddings per batch
const VECTOR_SIZE = 1536;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// File extensions to index
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.sql', '.md']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'coverage', '.turbo', 
  'pnpm-lock.yaml', '.env', '.cache', '__tests__', '__mocks__',
  'test', 'tests', 'fixtures', 'snapshots', '.vercel', '.husky',
  '.claude', 'tasks', 'public', 'e2e', 'perf', 'scripts',
]);
const SKIP_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
const MAX_FILE_SIZE = 100_000; // Skip files > 100KB

/**
 * Walk directory tree and collect files
 */
function walkDir(dir, base = dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath, base));
    } else if (CODE_EXTENSIONS.has(extname(entry)) && !SKIP_FILES.has(entry) && stat.size < MAX_FILE_SIZE) {
      results.push({ path: fullPath, relative: relative(base, fullPath) });
    }
  }
  return results;
}

/**
 * Chunk a TypeScript/JavaScript file into semantic units
 * Strategy: split by top-level functions, classes, exports
 */
function chunkFile(content, filePath) {
  const chunks = [];
  const lines = content.split('\n');
  
  // For small files (< 80 lines), keep as single chunk
  if (lines.length < 80) {
    chunks.push({
      content: content.trim(),
      startLine: 1,
      endLine: lines.length,
      type: 'file',
    });
    return chunks;
  }

  // Split by function/class/export declarations
  const boundaries = [];
  const patterns = [
    /^(export\s+)?(async\s+)?function\s+\w+/,
    /^(export\s+)?(default\s+)?class\s+\w+/,
    /^(export\s+)?const\s+\w+\s*[:=]/,
    /^(export\s+)?interface\s+\w+/,
    /^(export\s+)?type\s+\w+/,
    /^(export\s+)?enum\s+\w+/,
    /^\s*(private|protected|public|static)\s+(async\s+)?\w+\s*\(/,
    /^\/\*\*$/,  // JSDoc start
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (patterns.some(p => p.test(line.trim()))) {
      boundaries.push(i);
    }
  }

  if (boundaries.length === 0) {
    // No boundaries found — treat as single chunk
    chunks.push({ content: content.trim(), startLine: 1, endLine: lines.length, type: 'file' });
    return chunks;
  }

  // Add file header (imports, etc.) as first chunk
  if (boundaries[0] > 0) {
    const header = lines.slice(0, boundaries[0]).join('\n').trim();
    if (header.length > 50) {
      chunks.push({ content: header, startLine: 1, endLine: boundaries[0], type: 'header' });
    }
  }

  // Create chunks between boundaries
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : lines.length;
    const chunk = lines.slice(start, end).join('\n').trim();
    
    if (chunk.length > 50 && chunk.length < 8000) {
      chunks.push({ content: chunk, startLine: start + 1, endLine: end, type: 'code' });
    } else if (chunk.length >= 8000) {
      // Split large chunks further (every ~60 lines)
      for (let j = start; j < end; j += 60) {
        const subEnd = Math.min(j + 60, end);
        const subChunk = lines.slice(j, subEnd).join('\n').trim();
        if (subChunk.length > 50) {
          chunks.push({ content: subChunk, startLine: j + 1, endLine: subEnd, type: 'code' });
        }
      }
    }
  }

  return chunks;
}

/**
 * Create Qdrant collection
 */
async function createCollection() {
  // Delete existing collection
  await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, { method: 'DELETE' }).catch(() => {});

  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
      optimizers_config: { indexing_threshold: 1000 },
    }),
  });
  
  if (!res.ok) throw new Error(`Failed to create collection: ${await res.text()}`);
  console.log(`✅ Collection "${COLLECTION}" created`);
}

/**
 * Sleep helper
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Get embeddings from OpenAI with retry
 */
async function getEmbeddings(texts, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      });
      return response.data.map(d => d.embedding);
    } catch (e) {
      if (attempt === retries) throw e;
      const wait = e.status === 429 ? 30000 : 5000 * attempt;
      console.warn(`  ⏳ Retry ${attempt}/${retries} in ${wait/1000}s: ${e.message}`);
      await sleep(wait);
    }
  }
}

/**
 * Upsert points to Qdrant
 */
async function upsertPoints(points) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points }),
  });
  if (!res.ok) throw new Error(`Qdrant upsert failed: ${await res.text()}`);
}

/**
 * Main indexing pipeline
 */
async function main() {
  console.log(`📂 Scanning: ${REPO_PATH}`);
  const files = walkDir(REPO_PATH);
  console.log(`📄 Found ${files.length} files to index\n`);

  await createCollection();

  let totalChunks = 0;
  let pointId = 1;
  const batch = [];

  for (const file of files) {
    try {
      const content = readFileSync(file.path, 'utf8');
      const chunks = chunkFile(content, file.relative);

      for (const chunk of chunks) {
        // Prefix with file path for better search context
        const searchText = `File: ${file.relative} (lines ${chunk.startLine}-${chunk.endLine})\n\n${chunk.content}`;
        
        batch.push({
          id: pointId++,
          searchText,
          payload: {
            file_path: file.relative,
            start_line: chunk.startLine,
            end_line: chunk.endLine,
            chunk_type: chunk.type,
            content: chunk.content,
            file_ext: extname(file.relative),
          },
        });
        totalChunks++;
      }
    } catch (e) {
      console.warn(`⚠️  Skip ${file.relative}: ${e.message}`);
    }
  }

  console.log(`\n🧩 Total chunks: ${totalChunks}`);
  console.log(`🔄 Embedding in batches of ${BATCH_SIZE}...\n`);

  // Process in batches
  for (let i = 0; i < batch.length; i += BATCH_SIZE) {
    const slice = batch.slice(i, i + BATCH_SIZE);
    const texts = slice.map(s => s.searchText.substring(0, 8000)); // Max token limit
    
    try {
      const embeddings = await getEmbeddings(texts);
      
      const points = slice.map((item, idx) => ({
        id: item.id,
        vector: embeddings[idx],
        payload: item.payload,
      }));

      await upsertPoints(points);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(batch.length / BATCH_SIZE);
      console.log(`  ✅ Batch ${batchNum}/${totalBatches} (${points.length} chunks)`);
      // Rate limit protection: delay between batches
      await sleep(200);
      if (batchNum % 50 === 0) await sleep(2000);
    } catch (e) {
      console.error(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${e.message}`);
    }
  }

  // Get collection info
  const info = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`).then(r => r.json());
  console.log(`\n✅ Indexing complete!`);
  console.log(`   Collection: ${COLLECTION}`);
  console.log(`   Points: ${info.result.points_count}`);
  console.log(`   Vectors: ${info.result.vectors_count}`);
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
