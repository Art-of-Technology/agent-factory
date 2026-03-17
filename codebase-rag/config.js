#!/usr/bin/env node

/**
 * Codebase RAG Config Manager
 * 
 * Usage:
 *   node config.js set <key> <value>    Set a config value
 *   node config.js get <key>            Get a config value
 *   node config.js list                 List all config
 *   node config.js delete <key>         Remove a config value
 * 
 * Examples:
 *   node config.js set OPENAI_API_KEY sk-proj-...
 *   node config.js set COHERE_API_KEY 3MMQ...
 *   node config.js set QDRANT_URL http://10.34.9.237:6333
 *   node config.js set EMBEDDING_PROVIDER openai
 *   node config.js list
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dir, '.env');

const SECRET_KEYS = new Set([
  'OPENAI_API_KEY', 'COHERE_API_KEY', 'GEMINI_API_KEY',
  'OLLAMA_API_KEY', 'QDRANT_API_KEY',
]);

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const env = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function saveEnv(env) {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(ENV_PATH, lines.join('\n') + '\n');
}

function mask(key, val) {
  if (SECRET_KEYS.has(key) && val.length > 8) {
    return val.slice(0, 6) + '...' + val.slice(-4);
  }
  return val;
}

// ── Main ──

const [,, cmd, key, ...rest] = process.argv;
const value = rest.join(' ');

if (cmd === 'set' && key && value) {
  const env = loadEnv();
  env[key] = value;
  saveEnv(env);
  console.log(`✅ ${key} = ${mask(key, value)}`);

} else if (cmd === 'get' && key) {
  const env = loadEnv();
  if (env[key]) {
    console.log(`${key} = ${mask(key, env[key])}`);
  } else {
    console.log(`${key} is not set`);
  }

} else if (cmd === 'delete' && key) {
  const env = loadEnv();
  if (env[key]) {
    delete env[key];
    saveEnv(env);
    console.log(`🗑️  ${key} removed`);
  } else {
    console.log(`${key} is not set`);
  }

} else if (cmd === 'list') {
  const env = loadEnv();
  if (Object.keys(env).length === 0) {
    console.log('No config set. Run: node config.js set <KEY> <VALUE>');
  } else {
    for (const [k, v] of Object.entries(env)) {
      console.log(`  ${k} = ${mask(k, v)}`);
    }
  }

} else {
  console.log(`Codebase RAG Config

Usage:
  node config.js set <key> <value>    Set a config value
  node config.js get <key>            Get a config value
  node config.js delete <key>         Remove a config value
  node config.js list                 List all config

Common keys:
  OPENAI_API_KEY         OpenAI API key
  COHERE_API_KEY         Cohere API key (for reranking)
  GEMINI_API_KEY         Google Gemini API key
  QDRANT_URL             Qdrant server URL
  EMBEDDING_PROVIDER     openai | ollama | cohere
  OPENAI_MODEL           text-embedding-3-large (default)
  OLLAMA_URL             Ollama server URL
  OLLAMA_MODEL           nomic-embed-text (default)
  REPO_PATH              Repository path to index
  COLLECTION             Qdrant collection name`);
}
