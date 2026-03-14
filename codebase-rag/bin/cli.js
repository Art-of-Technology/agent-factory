#!/usr/bin/env node
/**
 * codebase-rag CLI
 *
 * Semantic code search for AI agents.
 * Index any git repository into Qdrant and query it with natural language.
 *
 * Commands:
 *   config   --qdrant <URL> --openai-key <KEY>   Save connection settings
 *   index    --repo <path> --collection <name>   Index a repository
 *   search   <query> --collection <name>         Semantic search
 *   collections                                  List all indexed collections
 *   delete   --collection <name>                 Delete a collection
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { homedir } from 'os';
import OpenAI from 'openai';

const CONFIG_DIR  = join(homedir(), '.codebase-rag');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// ── Config ───────────────────────────────────────────────────────────────────

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return null; }
}

function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function requireConfig() {
  const cfg = loadConfig();
  if (!cfg?.qdrant) {
    console.error('Not configured. Run: codebase-rag config --qdrant <URL> --openai-key <KEY>');
    process.exit(1);
  }
  return cfg;
}

// ── Embedding ────────────────────────────────────────────────────────────────

let _openai = null;
function getOpenAI(key) {
  if (!_openai) _openai = new OpenAI({ apiKey: key });
  return _openai;
}

async function embed(texts, cfg) {
  const provider = cfg.provider || 'openai';
  const model    = cfg.openaiModel || 'text-embedding-3-large';

  if (provider === 'ollama') {
    const embeddings = [];
    for (const text of texts) {
      const res = await fetch(`${cfg.ollamaUrl || 'http://localhost:11434'}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.ollamaModel || 'nomic-embed-text', prompt: text.slice(0, 8000) }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`Ollama error HTTP ${res.status}`);
      const d = await res.json();
      embeddings.push(d.embedding);
    }
    return embeddings;
  }

  if (!cfg.openaiKey) {
    console.error('OpenAI key not set. Run: codebase-rag config --openai-key <KEY>');
    process.exit(1);
  }
  const response = await getOpenAI(cfg.openaiKey).embeddings.create({ model, input: texts });
  return response.data.map(d => d.embedding);
}

function vectorSize(cfg) {
  if ((cfg.provider || 'openai') === 'ollama') return 768;
  const m = cfg.openaiModel || 'text-embedding-3-large';
  return m.includes('large') ? 3072 : 1536;
}

// ── File scanning & chunking ─────────────────────────────────────────────────

const CODE_EXT  = new Set(['.ts', '.tsx', '.js', '.jsx', '.sql', '.md']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'coverage',
  '.turbo', '.cache', '__tests__', '__mocks__', '.vercel', '.husky', 'public', 'e2e']);
const MAX_FILE_BYTES = 100_000;

function walkDir(dir, base = dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      results.push(...walkDir(full, base));
    } else if (CODE_EXT.has(extname(entry)) && stat.size > 0 && stat.size < MAX_FILE_BYTES) {
      results.push({ path: full, relative: relative(base, full) });
    }
  }
  return results;
}

function chunkFile(content, filePath) {
  const lines = content.split('\n');
  if (lines.length < 80) {
    const t = content.trim();
    return t.length > 20 ? [{ content: t, startLine: 1, endLine: lines.length, type: 'file' }] : [];
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

  const boundaries = lines.reduce((acc, line, i) => {
    if (patterns.some(p => p.test(line.trim()))) acc.push(i);
    return acc;
  }, []);

  if (boundaries.length === 0) {
    return [{ content: content.trim(), startLine: 1, endLine: lines.length, type: 'file' }];
  }

  const chunks = [];
  if (boundaries[0] > 0) {
    const hdr = lines.slice(0, boundaries[0]).join('\n').trim();
    if (hdr.length > 50) chunks.push({ content: hdr, startLine: 1, endLine: boundaries[0], type: 'header' });
  }

  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end   = i + 1 < boundaries.length ? boundaries[i + 1] : lines.length;
    const chunk = lines.slice(start, end).join('\n').trim();

    if (chunk.length > 50 && chunk.length < 8000) {
      chunks.push({ content: chunk, startLine: start + 1, endLine: end, type: 'code' });
    } else if (chunk.length >= 8000) {
      for (let j = start; j < end; j += 60) {
        const sub = lines.slice(j, Math.min(j + 60, end)).join('\n').trim();
        if (sub.length > 50) chunks.push({ content: sub, startLine: j + 1, endLine: Math.min(j + 60, end), type: 'code' });
      }
    }
  }
  return chunks;
}

// ── Qdrant helpers ───────────────────────────────────────────────────────────

async function qdrant(cfg, method, path, body = null) {
  const url  = `${cfg.qdrant.replace(/\/$/, '')}${path}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Qdrant ${method} ${path} → HTTP ${res.status}: ${txt}`);
  }
  return res.json();
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdConfig(args) {
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };

  const qdrantUrl  = get('--qdrant');
  const openaiKey  = get('--openai-key');
  const provider   = get('--provider');
  const ollamaUrl  = get('--ollama-url');
  const ollamaModel = get('--ollama-model');
  const openaiModel = get('--openai-model');

  if (!qdrantUrl && !openaiKey && !provider) {
    const cfg = loadConfig();
    if (!cfg) {
      console.log('Not configured yet.');
      console.log('Usage: codebase-rag config --qdrant <URL> --openai-key <KEY>');
    } else {
      console.log('Current config:');
      console.log(`  Qdrant URL:    ${cfg.qdrant}`);
      console.log(`  Provider:      ${cfg.provider || 'openai'}`);
      if (cfg.openaiKey)   console.log(`  OpenAI key:    ${cfg.openaiKey.slice(0, 8)}...`);
      if (cfg.openaiModel) console.log(`  OpenAI model:  ${cfg.openaiModel}`);
      if (cfg.ollamaUrl)   console.log(`  Ollama URL:    ${cfg.ollamaUrl}`);
      if (cfg.ollamaModel) console.log(`  Ollama model:  ${cfg.ollamaModel}`);
      console.log(`  Config file:   ${CONFIG_FILE}`);
    }
    return;
  }

  const existing = loadConfig() || {};
  const updated  = {
    ...existing,
    ...(qdrantUrl   ? { qdrant: qdrantUrl }       : {}),
    ...(openaiKey   ? { openaiKey }               : {}),
    ...(provider    ? { provider }                : {}),
    ...(ollamaUrl   ? { ollamaUrl }               : {}),
    ...(ollamaModel ? { ollamaModel }             : {}),
    ...(openaiModel ? { openaiModel }             : {}),
  };

  // Verify Qdrant reachability
  if (qdrantUrl) {
    try {
      const res = await fetch(qdrantUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log(`✅ Qdrant reachable at ${qdrantUrl}`);
    } catch (err) {
      console.error(`⚠️  Could not reach Qdrant at ${qdrantUrl}: ${err.message}`);
      console.error('   Config saved anyway — check the URL.');
    }
  }

  saveConfig(updated);
  console.log(`✅ Config saved to ${CONFIG_FILE}`);
}

async function cmdIndex(args) {
  const cfg = requireConfig();
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };

  const repoPath   = get('--repo') || '.';
  const collection = get('--collection') || 'codebase';
  const provider   = get('--provider') || cfg.provider || 'openai';
  const batchSize  = parseInt(get('--batch') || (provider === 'ollama' ? '10' : '50'), 10);
  const effectiveCfg = { ...cfg, provider };

  if (!existsSync(repoPath)) {
    console.error(`❌ Repo path not found: ${repoPath}`);
    process.exit(1);
  }

  const dims = vectorSize(effectiveCfg);
  console.log(`🔧 Provider: ${provider} | Dims: ${dims}`);
  console.log(`📂 Repo:     ${repoPath}`);
  console.log(`🗄️  Qdrant:   ${cfg.qdrant} | Collection: ${collection}\n`);

  // Recreate collection
  await fetch(`${cfg.qdrant}/collections/${collection}`, { method: 'DELETE' }).catch(() => {});
  await new Promise(r => setTimeout(r, 500));
  await qdrant(cfg, 'PUT', `/collections/${collection}`, {
    vectors: { size: dims, distance: 'Cosine' },
    optimizers_config: { indexing_threshold: 1000 },
  });
  console.log(`✅ Collection "${collection}" created\n`);

  // Scan & chunk
  const files = walkDir(repoPath);
  console.log(`📄 Found ${files.length} files`);

  const batch = [];
  let pointId = 1;
  for (const file of files) {
    try {
      const content = readFileSync(file.path, 'utf8');
      for (const chunk of chunkFile(content, file.relative)) {
        batch.push({
          id: pointId++,
          searchText: `File: ${file.relative} (lines ${chunk.startLine}-${chunk.endLine})\n\n${chunk.content}`,
          payload: {
            file_path: file.relative,
            start_line: chunk.startLine,
            end_line: chunk.endLine,
            chunk_type: chunk.type,
            content: chunk.content,
            file_ext: extname(file.relative),
          },
        });
      }
    } catch { /* skip unreadable files */ }
  }

  console.log(`🧩 Total chunks: ${batch.length}`);
  console.log(`🔄 Embedding in batches of ${batchSize}...\n`);

  const totalBatches = Math.ceil(batch.length / batchSize);
  let done = 0, failed = 0;

  for (let i = 0; i < batch.length; i += batchSize) {
    const batchNum = Math.floor(i / batchSize) + 1;
    const slice    = batch.slice(i, i + batchSize);
    try {
      const embeddings = await embed(slice.map(s => s.searchText.slice(0, 8000)), effectiveCfg);
      const points = slice.map((item, idx) => ({
        id: item.id, vector: embeddings[idx], payload: item.payload,
      }));
      await qdrant(cfg, 'PUT', `/collections/${collection}/points`, { points });
      done++;
      process.stdout.write(`  ✅ ${batchNum}/${totalBatches}\r`);
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      failed++;
      console.error(`  ❌ Batch ${batchNum} failed: ${err.message}`);
    }
  }

  console.log('\n');
  if (failed === 0) {
    const info = await qdrant(cfg, 'GET', `/collections/${collection}`).catch(() => null);
    console.log(`✅ Done! Collection: ${collection} | Points: ${info?.result?.points_count ?? '?'}`);
  } else {
    console.log(`⚠️  Completed with ${failed}/${totalBatches} failed batches`);
    process.exitCode = 1;
  }
}

async function cmdSearch(args) {
  const cfg = requireConfig();
  const topIdx = args.indexOf('--top');
  const topK   = topIdx !== -1 && args[topIdx + 1] ? parseInt(args[topIdx + 1], 10) : 5;
  const colIdx = args.indexOf('--collection');
  const collection = colIdx !== -1 && args[colIdx + 1] ? args[colIdx + 1] : 'codebase';
  const jsonOut = args.includes('--json');

  const query = args.filter((a, i) => {
    if (a.startsWith('--')) return false;
    if (i > 0 && (args[i - 1] === '--top' || args[i - 1] === '--collection')) return false;
    return true;
  }).join(' ');

  if (!query) {
    console.error('Usage: codebase-rag search <query> [--collection <name>] [--top N] [--json]');
    process.exit(1);
  }

  const [queryVec] = await embed([query], cfg);
  const res = await qdrant(cfg, 'POST', `/collections/${collection}/points/search`, {
    vector: queryVec, limit: topK, with_payload: true,
  });

  const results = res.result.map(hit => ({
    score:   hit.score,
    file:    hit.payload.file_path,
    lines:   `${hit.payload.start_line}-${hit.payload.end_line}`,
    type:    hit.payload.chunk_type,
    content: hit.payload.content,
  }));

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  if (jsonOut) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const r of results) {
    console.log(`━━━ ${r.file} (L${r.lines}) [${r.type}] score: ${r.score.toFixed(3)} ━━━`);
    const preview = r.content.split('\n').slice(0, 12).join('\n');
    console.log(preview);
    if (r.content.split('\n').length > 12) console.log('  ...');
    console.log();
  }
}

async function cmdCollections() {
  const cfg = requireConfig();
  const data = await qdrant(cfg, 'GET', '/collections');
  const collections = data.result?.collections || [];
  if (collections.length === 0) {
    console.log('No collections found.');
    return;
  }
  console.log(`Collections in ${cfg.qdrant}:\n`);
  for (const col of collections) {
    const info = await qdrant(cfg, 'GET', `/collections/${col.name}`).catch(() => null);
    const pts  = info?.result?.points_count ?? '?';
    console.log(`  📦 ${col.name}  (${pts} points)`);
  }
}

async function cmdDelete(args) {
  const colIdx = args.indexOf('--collection');
  const collection = colIdx !== -1 && args[colIdx + 1] ? args[colIdx + 1] : null;
  if (!collection) {
    console.error('Usage: codebase-rag delete --collection <name>');
    process.exit(1);
  }
  const cfg = requireConfig();
  await fetch(`${cfg.qdrant}/collections/${collection}`, { method: 'DELETE' });
  console.log(`✅ Collection "${collection}" deleted.`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const command = args[0];
const cmdArgs = args.slice(1);

const HELP = `
codebase-rag — Semantic code search for AI agents

Setup:
  config --qdrant <URL> --openai-key <KEY>       Save connection settings
  config                                          Show current config

Commands:
  index    --repo <path> --collection <name>      Index a repository
             [--provider openai|ollama]
             [--batch <n>]
  search   <query> --collection <name>            Semantic search
             [--top <n>]  [--json]
  collections                                     List all indexed collections
  delete   --collection <name>                    Delete a collection

Examples:
  codebase-rag config --qdrant http://10.34.9.237:6333 --openai-key sk-...
  codebase-rag index --repo /home/user/myproject --collection myproject
  codebase-rag search "how is auth handled" --collection myproject
  codebase-rag search "risk score calculation" --collection maestro-fraud --top 10
  codebase-rag collections
  codebase-rag delete --collection old-project
`;

if (!command || command === '--help' || command === '-h') {
  console.log(HELP);
} else {
  const commands = {
    config:      cmdConfig,
    index:       cmdIndex,
    search:      cmdSearch,
    collections: cmdCollections,
    delete:      cmdDelete,
  };
  const handler = commands[command];
  if (!handler) {
    console.error(`Unknown command: ${command}\nRun 'codebase-rag --help' for usage.`);
    process.exitCode = 1;
  } else {
    try { await handler(cmdArgs); }
    catch (err) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  }
}
