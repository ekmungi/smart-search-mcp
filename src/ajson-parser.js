// Parses AJSON files produced by the Smart Connections Obsidian plugin.
// Each .ajson file holds pre-computed note embeddings, one entry per line.

import { promises as fs } from 'fs';
import path from 'path';

// The embedding model key used by Smart Connections in the AJSON format.
// Must match the model configured in the Obsidian vault's Smart Connections settings.
const MODEL_KEY = 'TaylorAI/bge-micro-v2';

// Key prefixes that distinguish full-note embeddings from heading-level blocks.
const SOURCE_PREFIX = 'smart_sources:';
const BLOCK_PREFIX = 'smart_blocks:';

/**
 * Parse a single line from an AJSON file into a {key, value} pair.
 *
 * Each line is formatted as `"key": {value},` which is not valid standalone
 * JSON. This function wraps it in braces and strips the trailing comma so
 * JSON.parse can handle it.
 *
 * @param {string} line - A single trimmed line from an AJSON file.
 * @returns {{key: string, value: object}|null} Parsed pair, or null on failure.
 */
function parseLine(line) {
  if (!line) {
    return null;
  }

  // Strip optional trailing comma before parsing.
  const normalized = line.endsWith(',') ? line.slice(0, -1) : line;

  let parsed;
  try {
    // Wrapping in braces turns the key-value pair into a valid JSON object.
    parsed = JSON.parse('{' + normalized + '}');
  } catch {
    // Silently skip malformed lines -- vault files may have partial writes.
    return null;
  }

  const keys = Object.keys(parsed);
  if (keys.length === 0) {
    return null;
  }

  return { key: keys[0], value: parsed[keys[0]] };
}

/**
 * Determine the entry type and path from an AJSON key.
 *
 * @param {string} key - The raw key, e.g. "smart_sources:path/to/note.md".
 * @returns {{type: string, path: string}|null} Type and path, or null if unrecognised.
 */
function resolveKeyMeta(key) {
  if (key.startsWith(SOURCE_PREFIX)) {
    return { type: 'source', path: key.slice(SOURCE_PREFIX.length) };
  }
  if (key.startsWith(BLOCK_PREFIX)) {
    return { type: 'block', path: key.slice(BLOCK_PREFIX.length) };
  }
  // Unknown prefix -- skip.
  return null;
}

/**
 * Extract the embedding vector from a parsed AJSON value object.
 *
 * Navigates the nested structure: value.embeddings[MODEL_KEY].vec
 *
 * @param {object} value - The parsed value portion of an AJSON entry.
 * @returns {number[]|null} The vec array, or null if absent.
 */
function extractVec(value) {
  const vec = value?.embeddings?.[MODEL_KEY]?.vec;
  return Array.isArray(vec) && vec.length > 0 ? vec : null;
}

/**
 * Parse the full text content of an AJSON file into an array of embedding entries.
 *
 * Processes the file line-by-line. Lines that are blank, malformed, or lack
 * embeddings are silently skipped. The function never throws.
 *
 * @param {string} content - Full text contents of a .ajson file.
 * @returns {Array<{path: string, vec: number[], type: string}>} Parsed entries.
 */
export function parseAjsonContent(content) {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const entries = [];

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) {
      continue;
    }

    const pair = parseLine(line);
    if (!pair) {
      continue;
    }

    const meta = resolveKeyMeta(pair.key);
    if (!meta) {
      continue;
    }

    const vec = extractVec(pair.value);
    if (!vec) {
      continue;
    }

    entries.push({ path: meta.path, vec, type: meta.type });
  }

  return entries;
}

/**
 * Load all pre-computed embeddings from a vault's .smart-env/multi/ directory.
 *
 * Reads every .ajson file in the directory, parses each with parseAjsonContent,
 * and aggregates the results into a Map keyed by note/block path.
 *
 * If the directory does not exist, returns an empty Map (graceful degradation
 * so callers can detect "no embeddings" without catching errors).
 *
 * @param {string} vaultPath - Absolute path to the Obsidian vault root.
 * @returns {Promise<Map<string, {vec: number[], type: string}>>} Embeddings map.
 */
export async function loadEmbeddings(vaultPath) {
  const multiDir = path.join(vaultPath, '.smart-env', 'multi');

  let files;
  try {
    files = await fs.readdir(multiDir);
  } catch {
    // Directory absent -- vault has no Smart Connections embeddings yet.
    return new Map();
  }

  const ajsonFiles = files.filter((f) => f.endsWith('.ajson'));

  const embeddings = new Map();

  for (const filename of ajsonFiles) {
    const filePath = path.join(multiDir, filename);
    let content;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      // Skip files that cannot be read (permissions, partial writes, etc.).
      continue;
    }

    const entries = parseAjsonContent(content);
    for (const entry of entries) {
      // Last-write-wins for duplicate paths across files.
      embeddings.set(entry.path, { vec: entry.vec, type: entry.type });
    }
  }

  return embeddings;
}
