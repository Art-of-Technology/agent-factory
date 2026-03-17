/**
 * Codebase RAG Indexer
 * 
 * Indexes a git repository into Qdrant for semantic code search.
 * Chunks TypeScript/JavaScript files at function/class level.
 * 
 * Supports dual embedding providers:
 *   - OpenAI text-embedding-3-large (3072 dim, best quality)
 *   - Ollama nomic-embed-text (768 dim, free local)
 * 
 * Environment variables:
 *   EMBEDDING_PROVIDER  - 'openai' (default) or 'ollama'
 *   OPENAI_API_KEY      - Required when provider=openai
 *   OPENAI_MODEL        - OpenAI model (default: text-embedding-3-large)
 *   OLLAMA_URL          - Ollama API URL (default: http://localhost:11434)
 *   OLLAMA_MODEL        - Ollama model (default: nomic-embed-text)
 *   QDRANT_URL          - Qdrant REST API (default: http://localhost:6333)
 *   REPO_PATH           - Repository path to index (default: .)
 *   COLLECTION          - Qdrant collection name (default: codebase)
 * 
 * Usage:
 *   OPENAI_API_KEY=sk-... REPO_PATH=/path/to/repo node indexer.js          # full reindex
 *   OPENAI_API_KEY=sk-... REPO_PATH=/path/to/repo node indexer.js --incremental  # changed files only
 *   OPENAI_API_KEY=sk-... REPO_PATH=/path/to/repo node indexer.js -i --since HEAD~3  # last 3 commits
 *   EMBEDDING_PROVIDER=ollama OLLAMA_URL=http://gpu:11434 node indexer.js
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';
import { execSync } from 'child_process';
import OpenAI from 'openai';

// --- CLI flags ---
const INCREMENTAL = process.argv.includes('--incremental') || process.argv.includes('-i');
const DIFF_BASE = (() => {
  const idx = process.argv.indexOf('--since');
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : 'HEAD~1';
})();

// --- Configuration (all from environment) ---
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const REPO_PATH = process.env.REPO_PATH || '.';
const COLLECTION = process.env.COLLECTION || 'codebase';
const PROVIDER = process.env.EMBEDDING_PROVIDER || 'openai';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'nomic-embed-text';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'text-embedding-3-large';
const BATCH_SIZE = PROVIDER === 'ollama' ? 10 : 50;
const VECTOR_SIZE = (() => {
  if (PROVIDER === 'ollama') return 768;
  if (OPENAI_MODEL.includes('large')) return 3072;
  return 1536; // text-embedding-3-small
})();
const MAX_CONSECUTIVE_FAILURES = 10;

// File scanning config
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.sql', '.md']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'coverage', '.turbo',
  '.env', '.cache', '__tests__', '__mocks__', '.vercel', '.husky',
  '.claude', 'tasks', 'public', 'e2e', 'perf',
]);
const SKIP_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
const MAX_FILE_SIZE = 100_000; // 100KB

// --- Validation ---
function validateConfig() {
  const errors = [];

  if (!existsSync(REPO_PATH)) {
    errors.push(`REPO_PATH "${REPO_PATH}" does not exist`);
  }

  if (PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
    errors.push('OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai');
  }

  if (!['openai', 'ollama'].includes(PROVIDER)) {
    errors.push(`EMBEDDING_PROVIDER must be "openai" or "ollama", got "${PROVIDER}"`);
  }

  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }
}

// --- OpenAI client (lazy, only if needed) ---
let openai = null;
function getOpenAIClient() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// --- Helpers ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Walk directory tree and collect indexable files.
 * @returns {{ path: string, relative: string }[]}
 */
function walkDir(dir, base = dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    console.warn(`⚠️  Cannot read directory: ${dir} (${err.code})`);
    return results;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue; // skip broken symlinks, permission errors
    }
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath, base));
    } else if (
      CODE_EXTENSIONS.has(extname(entry)) &&
      !SKIP_FILES.has(entry) &&
      stat.size < MAX_FILE_SIZE &&
      stat.size > 0
    ) {
      results.push({ path: fullPath, relative: relative(base, fullPath) });
    }
  }
  return results;
}

/**
 * Chunk a source file into semantic units.
 * Small files (<80 lines) → single chunk.
 * Larger files → split at function/class/export boundaries.
 */
function chunkFile(content, filePath) {
  const chunks = [];
  const lines = content.split('\n');

  if (lines.length < 80) {
    const trimmed = content.trim();
    if (trimmed.length > 20) {
      chunks.push({ content: trimmed, startLine: 1, endLine: lines.length, type: 'file' });
    }
    return chunks;
  }

  const patterns = [
    /^(export\s+)?(async\s+)?function\s+\w+/,
    /^(export\s+)?(default\s+)?class\s+\w+/,
    /^(export\s+)?const\s+\w+\s*[:=]/,
    /^(export\s+)?interface\s+\w+/,
    /^(export\s+)?type\s+\w+/,
    /^(export\s+)?enum\s+\w+/,
    /^\s*(private|protected|public|static)\s+(async\s+)?\w+\s*\(/,
    /^\/\*\*$/,
  ];

  const boundaries = [];
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some(p => p.test(lines[i].trim()))) {
      boundaries.push(i);
    }
  }

  if (boundaries.length === 0) {
    chunks.push({ content: content.trim(), startLine: 1, endLine: lines.length, type: 'file' });
    return chunks;
  }

  // File header (imports etc.)
  if (boundaries[0] > 0) {
    const header = lines.slice(0, boundaries[0]).join('\n').trim();
    if (header.length > 50) {
      chunks.push({ content: header, startLine: 1, endLine: boundaries[0], type: 'header' });
    }
  }

  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : lines.length;
    const chunk = lines.slice(start, end).join('\n').trim();

    if (chunk.length > 50 && chunk.length < 8000) {
      chunks.push({ content: chunk, startLine: start + 1, endLine: end, type: 'code' });
    } else if (chunk.length >= 8000) {
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

// --- Qdrant operations ---

async function checkQdrantHealth() {
  try {
    const res = await fetch(QDRANT_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error(`❌ Cannot reach Qdrant at ${QDRANT_URL}: ${err.message}`);
    return false;
  }
}

async function createCollection() {
  // Delete existing
  await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, { method: 'DELETE' }).catch(() => {});
  await sleep(500);

  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
      optimizers_config: { indexing_threshold: 1000 },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown');
    throw new Error(`Failed to create collection "${COLLECTION}": ${body}`);
  }
  console.log(`✅ Collection "${COLLECTION}" created (${VECTOR_SIZE} dims)\n`);
}

async function upsertPoints(points) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown');
    throw new Error(`Qdrant upsert failed (HTTP ${res.status}): ${body}`);
  }
}

// --- Embedding providers ---

async function getOllamaEmbeddings(texts) {
  const embeddings = [];
  for (const text of texts) {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text.substring(0, 8000) }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      throw new Error(`Ollama embedding failed (HTTP ${res.status}): ${body}`);
    }
    const data = await res.json();
    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error(`Ollama returned invalid embedding for model "${OLLAMA_MODEL}"`);
    }
    embeddings.push(data.embedding);
  }
  return embeddings;
}

async function getOpenAIEmbeddings(texts, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await getOpenAIClient().embeddings.create({
        model: OPENAI_MODEL,
        input: texts,
      });
      return response.data.map(d => d.embedding);
    } catch (e) {
      const isRateLimit = e.status === 429;
      const isTransient = e.status >= 500 || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT';
      if (attempt === retries || (!isRateLimit && !isTransient)) throw e;

      const wait = isRateLimit ? 30000 : 5000 * attempt;
      console.warn(`  ⏳ Retry ${attempt}/${retries} in ${wait / 1000}s: ${e.message}`);
      await sleep(wait);
    }
  }
}

async function getEmbeddings(texts) {
  return PROVIDER === 'ollama' ? getOllamaEmbeddings(texts) : getOpenAIEmbeddings(texts);
}

// --- Incremental indexing ---

/**
 * Get changed files since a git ref using git diff.
 * Returns files that were Added, Modified, or Renamed (not Deleted).
 */
function getChangedFiles(repoPath, sinceRef) {
  try {
    const output = execSync(
      `git diff --name-only --diff-filter=AMR ${sinceRef}`,
      { cwd: repoPath, encoding: 'utf8', timeout: 10000 }
    ).trim();
    if (!output) return [];
    return output.split('\n').filter(f => {
      const ext = extname(f);
      return CODE_EXTENSIONS.has(ext) && !SKIP_FILES.has(f.split('/').pop());
    });
  } catch (e) {
    console.warn(`⚠️  git diff failed: ${e.message}`);
    console.warn('   Falling back to full reindex');
    return null; // null = fallback to full
  }
}

/**
 * Get files that were deleted since a git ref.
 */
function getDeletedFiles(repoPath, sinceRef) {
  try {
    const output = execSync(
      `git diff --name-only --diff-filter=D ${sinceRef}`,
      { cwd: repoPath, encoding: 'utf8', timeout: 10000 }
    ).trim();
    if (!output) return [];
    return output.split('\n');
  } catch {
    return [];
  }
}

/**
 * Delete points from Qdrant by file_path filter.
 */
async function deletePointsByFiles(filePaths) {
  if (filePaths.length === 0) return 0;
  
  let deleted = 0;
  for (const filePath of filePaths) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    try {
      const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: {
            must: [{ key: 'file_path', match: { value: normalizedPath } }]
          }
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) deleted++;
    } catch (e) {
      console.warn(`  ⚠️  Failed to delete points for ${filePath}: ${e.message}`);
    }
  }
  return deleted;
}

/**
 * Ensure collection exists (for incremental mode — don't delete it).
 */
async function ensureCollection() {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`);
  if (res.ok) {
    const data = await res.json();
    console.log(`✅ Collection "${COLLECTION}" exists (${data.result?.points_count ?? '?'} points)\n`);
    return true;
  }
  // Collection doesn't exist — create it
  console.log(`📦 Collection "${COLLECTION}" not found, creating...`);
  await createCollection();
  return false;
}

/**
 * Get next available point ID (max existing + 1).
 */
async function getNextPointId() {
  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`);
    if (!res.ok) return 1;
    const data = await res.json();
    return (data.result?.points_count ?? 0) + 1000; // offset to avoid collisions
  } catch {
    return 1;
  }
}

// --- Main pipeline ---

async function main() {
  validateConfig();

  console.log(`🔧 Provider: ${PROVIDER} | Model: ${PROVIDER === 'ollama' ? OLLAMA_MODEL : OPENAI_MODEL} | Dims: ${VECTOR_SIZE}`);
  console.log(`📂 Repo: ${REPO_PATH}`);
  console.log(`🗄️  Qdrant: ${QDRANT_URL} | Collection: ${COLLECTION}\n`);

  // Pre-flight checks
  const qdrantOk = await checkQdrantHealth();
  if (!qdrantOk) {
    process.exit(1);
  }

  if (PROVIDER === 'ollama') {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const modelNames = (data.models || []).map(m => m.name);
      if (!modelNames.some(n => n.startsWith(OLLAMA_MODEL))) {
        console.warn(`⚠️  Model "${OLLAMA_MODEL}" not found in Ollama. Available: ${modelNames.join(', ')}`);
        console.warn('   Run: ollama pull ' + OLLAMA_MODEL);
        process.exit(1);
      }
    } catch (err) {
      console.error(`❌ Cannot reach Ollama at ${OLLAMA_URL}: ${err.message}`);
      process.exit(1);
    }
  }

  // --- Incremental vs Full mode ---
  let files;
  
  if (INCREMENTAL) {
    console.log(`🔄 Incremental mode (since ${DIFF_BASE})\n`);
    
    // Ensure collection exists (don't recreate)
    await ensureCollection();
    
    // Get changed + deleted files
    const changedRelative = getChangedFiles(REPO_PATH, DIFF_BASE);
    const deletedRelative = getDeletedFiles(REPO_PATH, DIFF_BASE);
    
    if (changedRelative === null) {
      // git diff failed — fall back to full
      console.log('⚠️  Falling back to full reindex\n');
      files = walkDir(REPO_PATH);
      await createCollection();
    } else if (changedRelative.length === 0 && deletedRelative.length === 0) {
      console.log('✅ No changes detected. Index is up to date.');
      process.exit(0);
    } else {
      // Delete old points for changed + deleted files
      const allAffected = [...new Set([...changedRelative, ...deletedRelative])];
      console.log(`📝 Changed: ${changedRelative.length} files, Deleted: ${deletedRelative.length} files`);
      const deleted = await deletePointsByFiles(allAffected);
      console.log(`🗑️  Removed ${deleted} file entries from index`);
      
      // Only index changed files (not deleted ones)
      files = changedRelative
        .map(rel => ({ path: join(REPO_PATH, rel), relative: rel }))
        .filter(f => existsSync(f.path));
      
      if (files.length === 0) {
        console.log('✅ Only deletions — index updated.');
        process.exit(0);
      }
      console.log(`📄 Re-indexing ${files.length} changed files`);
    }
  } else {
    // Full mode
    files = walkDir(REPO_PATH);
    if (files.length === 0) {
      console.error('❌ No indexable files found. Check REPO_PATH and file extensions.');
      process.exit(1);
    }
    console.log(`📄 Found ${files.length} files to index`);

    // Create collection (deletes old one)
    await createCollection();
  }

  // Build chunks
  let totalChunks = 0;
  let pointId = INCREMENTAL ? await getNextPointId() : 1;
  const batch = [];
  let skippedFiles = 0;

  for (const file of files) {
    try {
      const content = readFileSync(file.path, 'utf8');
      const chunks = chunkFile(content, file.relative);

      for (const chunk of chunks) {
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
      skippedFiles++;
      if (skippedFiles <= 5) console.warn(`⚠️  Skip ${file.relative}: ${e.message}`);
    }
  }

  if (skippedFiles > 5) {
    console.warn(`⚠️  ...and ${skippedFiles - 5} more files skipped`);
  }

  console.log(`\n🧩 Total chunks: ${totalChunks}`);
  console.log(`🔄 Embedding in batches of ${BATCH_SIZE}...\n`);

  // Process batches
  let successBatches = 0;
  let failedBatches = 0;
  let consecutiveFailures = 0;
  const totalBatches = Math.ceil(batch.length / BATCH_SIZE);

  for (let i = 0; i < batch.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const slice = batch.slice(i, i + BATCH_SIZE);
    const texts = slice.map(s => s.searchText.substring(0, 8000));

    try {
      const embeddings = await getEmbeddings(texts);
      const points = slice.map((item, idx) => ({
        id: item.id,
        vector: embeddings[idx],
        payload: item.payload,
      }));
      await upsertPoints(points);

      successBatches++;
      consecutiveFailures = 0;
      console.log(`  ✅ Batch ${batchNum}/${totalBatches} (${points.length} chunks)`);

      // Rate limit protection
      await sleep(200);
      if (batchNum % 50 === 0) await sleep(2000);
    } catch (e) {
      failedBatches++;
      consecutiveFailures++;
      console.error(`  ❌ Batch ${batchNum}/${totalBatches} failed: ${e.message}`);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n🛑 ${MAX_CONSECUTIVE_FAILURES} consecutive failures — aborting.`);
        console.error(`   Successfully indexed ${successBatches * BATCH_SIZE} chunks before failure.`);
        console.error('   Check network connectivity to Qdrant and embedding provider.');
        process.exit(1);
      }

      // Back off on failure
      await sleep(3000 * consecutiveFailures);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(50));
  if (failedBatches === 0) {
    const info = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`)
      .then(r => r.json())
      .catch(() => null);
    console.log(`✅ Indexing complete!`);
    console.log(`   Collection: ${COLLECTION}`);
    console.log(`   Points: ${info?.result?.points_count ?? 'unknown'}`);
    console.log(`   Vectors: ${info?.result?.vectors_count ?? 'unknown'}`);
  } else {
    console.log(`⚠️  Indexing completed with errors`);
    console.log(`   Successful batches: ${successBatches}/${totalBatches}`);
    console.log(`   Failed batches: ${failedBatches}/${totalBatches}`);
    console.log(`   ~${successBatches * BATCH_SIZE} chunks indexed`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error(`\n❌ Fatal error: ${e.message}`);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
