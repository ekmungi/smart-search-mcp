// Search orchestrator: semantic search and related-note lookup over vault embeddings.
// Operates on preloaded embeddings Maps; does not perform any file I/O.

import { cosineSimilarity } from './similarity.js';

// Default maximum number of results returned when the caller does not specify a limit.
const DEFAULT_LIMIT = 10;

// Default minimum cosine similarity score for a result to be included.
// 0.3 filters out weakly related noise while keeping meaningful matches.
const DEFAULT_THRESHOLD = 0.3;

// HuggingFace model identifier embedded in getStats() output.
// Must match the model used to generate the vault's .ajson embeddings.
const MODEL_ID = 'TaylorAI/bge-micro-v2';

/**
 * Run semantic search against all vault embeddings using a natural-language query.
 *
 * Encodes the query via the embedder, computes cosine similarity against every
 * entry in the embeddings Map, filters entries below the threshold, sorts by
 * descending score, and returns up to `limit` results.
 *
 * @param {string} query - The natural-language search query.
 * @param {Map<string, {vec: number[], type: string}>} embeddings - Preloaded vault embeddings.
 * @param {{ encode: (text: string) => Promise<Float32Array> }} embedder - Text encoder instance.
 * @param {{ limit?: number, threshold?: number, type?: string, folder?: string }} [options] - Optional search configuration.
 * @returns {Promise<Array<{path: string, score: number}>>} Sorted results, best match first.
 */
export async function semanticSearch(query, embeddings, embedder, options = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  const queryVec = await embedder.encode(query);
  // Convert Float32Array to a plain array for cosineSimilarity compatibility.
  const queryArr = Array.from(queryVec);

  // Pre-compute lowercase folder prefix for case-insensitive folder filtering.
  const folderLower = options.folder ? options.folder.toLowerCase() : null;

  // Build results array using functional reduce to avoid mutation of the outer array.
  // Pre-filter by type and folder before computing cosine similarity (avoids wasted dot products).
  const results = Array.from(embeddings.entries()).reduce((acc, [path, entry]) => {
    if (options.type && entry.type !== options.type) {
      return acc;
    }
    if (folderLower && !path.toLowerCase().startsWith(folderLower)) {
      return acc;
    }
    const score = cosineSimilarity(queryArr, entry.vec);
    if (score >= threshold) {
      return [...acc, { path, score }];
    }
    return acc;
  }, []);

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Find notes related to a given note by comparing its embedding against all others.
 *
 * Looks up the source note's embedding, computes cosine similarity against every
 * other entry (excluding the note itself), filters by threshold, sorts by
 * descending score, and returns up to `limit` entries.
 *
 * @param {string} notePath - Vault-relative path of the source note (e.g. "notes/foo.md").
 * @param {Map<string, {vec: number[], type: string}>} embeddings - Preloaded vault embeddings.
 * @param {{ limit?: number, threshold?: number, type?: string }} [options] - Optional search configuration.
 * @returns {Array<{path: string, score: number}>} Sorted related notes, best match first.
 * @throws {Error} If notePath is not present in the embeddings Map.
 */
export function findRelated(notePath, embeddings, options = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  const source = embeddings.get(notePath);
  if (!source) {
    throw new Error(
      `findRelated: the requested note path was not found in the embeddings Map`
    );
  }

  // Build results, skipping the source note itself to avoid self-similarity.
  // Pre-filter by type before computing cosine similarity.
  const results = Array.from(embeddings.entries()).reduce((acc, [path, entry]) => {
    if (path === notePath) {
      return acc;
    }
    if (options.type && entry.type !== options.type) {
      return acc;
    }
    const score = cosineSimilarity(source.vec, entry.vec);
    if (score >= threshold) {
      return [...acc, { path, score }];
    }
    return acc;
  }, []);

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Compute summary statistics for the loaded embeddings collection.
 *
 * @param {Map<string, {vec: number[], type: string}>} embeddings - Preloaded vault embeddings.
 * @returns {{ totalNotes: number, totalBlocks: number, dimensions: number, modelId: string }}
 *   totalNotes: count of entries with type "source".
 *   totalBlocks: count of entries with type "block".
 *   dimensions: vec.length of the first entry, or 0 if the Map is empty.
 *   modelId: the HuggingFace model identifier used to generate the embeddings.
 */
export function getStats(embeddings) {
  // Use a single-pass reduce to count types and capture dimensions immutably.
  const { totalNotes, totalBlocks, dimensions } = Array.from(embeddings.values()).reduce(
    (acc, { vec, type }) => ({
      totalNotes: type === 'source' ? acc.totalNotes + 1 : acc.totalNotes,
      totalBlocks: type === 'block' ? acc.totalBlocks + 1 : acc.totalBlocks,
      // Capture vec.length only from the first entry (dimensions === 0 until then).
      dimensions: acc.dimensions === 0 && vec ? vec.length : acc.dimensions,
    }),
    { totalNotes: 0, totalBlocks: 0, dimensions: 0 }
  );

  return { totalNotes, totalBlocks, dimensions, modelId: MODEL_ID };
}
