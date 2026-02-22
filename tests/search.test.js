// Tests for the search orchestrator (src/search.js).
// Covers semanticSearch, findRelated, and getStats with controlled mock data.

import { describe, it, expect } from 'vitest';
import { semanticSearch, findRelated, getStats } from '../src/search.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Mock embedder that always returns a unit vector pointing along the x-axis.
// Allows us to predict cosine similarity values against known test vectors.
const mockEmbedder = { encode: async () => new Float32Array([1, 0, 0]) };

// Build a controlled embeddings Map with predictable similarity scores.
//
// Vector geometry (all compared against query [1, 0, 0]):
//   "notes/alpha.md"  -> [1, 0, 0]  cosineSimilarity = 1.000  (identical)
//   "notes/beta.md"   -> [0, 1, 0]  cosineSimilarity = 0.000  (orthogonal)
//   "notes/gamma.md"  -> [1, 1, 0]  cosineSimilarity = 0.707  (45 degrees)
//   "notes/delta.md"  -> [-1, 0, 0] cosineSimilarity = -1.000 (opposite)
//   "notes/alpha.md#Section" (block) -> [1, 0, 0] cosineSimilarity = 1.000
function buildTestEmbeddings() {
  const entries = [
    ['notes/alpha.md',          { vec: [1, 0, 0],  type: 'source' }],
    ['notes/beta.md',           { vec: [0, 1, 0],  type: 'source' }],
    ['notes/gamma.md',          { vec: [1, 1, 0],  type: 'source' }],
    ['notes/delta.md',          { vec: [-1, 0, 0], type: 'source' }],
    ['notes/alpha.md#Section',  { vec: [1, 0, 0],  type: 'block'  }],
  ];
  return new Map(entries);
}

// Embeddings spread across multiple folders for folder-filter tests.
// All vectors are [1,0,0] so every entry matches the mock query equally (score 1.0).
function buildFolderTestEmbeddings() {
  const entries = [
    ['Projects/alpha.md',            { vec: [1, 0, 0], type: 'source' }],
    ['Projects/alpha.md#Heading',    { vec: [1, 0, 0], type: 'block'  }],
    ['Projects/beta.md',             { vec: [1, 0, 0], type: 'source' }],
    ['Reference/gamma.md',           { vec: [1, 0, 0], type: 'source' }],
    ['Reference/gamma.md#Section',   { vec: [1, 0, 0], type: 'block'  }],
  ];
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// semanticSearch
// ---------------------------------------------------------------------------

describe('semanticSearch', () => {
  it('returns results sorted by score descending', async () => {
    const embeddings = buildTestEmbeddings();
    const results = await semanticSearch('test query', embeddings, mockEmbedder);

    // Scores must be in non-increasing order.
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('returns result objects with path and score fields', async () => {
    const embeddings = buildTestEmbeddings();
    const results = await semanticSearch('test query', embeddings, mockEmbedder);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('path');
    expect(results[0]).toHaveProperty('score');
  });

  it('respects the limit option and returns at most limit results', async () => {
    const embeddings = buildTestEmbeddings();
    const results = await semanticSearch('test query', embeddings, mockEmbedder, { limit: 2 });

    expect(results).toHaveLength(2);
  });

  it('filters out results below the threshold', async () => {
    const embeddings = buildTestEmbeddings();
    // threshold of 0.5 should exclude beta (0.0), delta (-1.0), keep alpha (1.0) and gamma (0.707)
    const results = await semanticSearch('test query', embeddings, mockEmbedder, { threshold: 0.5 });

    const scores = results.map((r) => r.score);
    for (const score of scores) {
      expect(score).toBeGreaterThanOrEqual(0.5);
    }
    // beta.md (score 0.0) and delta.md (score -1.0) must not appear
    const paths = results.map((r) => r.path);
    expect(paths).not.toContain('notes/beta.md');
    expect(paths).not.toContain('notes/delta.md');
  });

  it('returns an empty array when no results meet the threshold', async () => {
    const embeddings = buildTestEmbeddings();
    // threshold of 2.0 is above maximum possible cosine similarity (1.0)
    const results = await semanticSearch('test query', embeddings, mockEmbedder, { threshold: 2.0 });

    expect(results).toEqual([]);
  });

  it('uses default limit of 10 when not specified', async () => {
    // Build a Map with 15 identical source entries, all above threshold.
    const entries = Array.from({ length: 15 }, (_, i) => [
      `notes/note${i}.md`,
      { vec: [1, 0, 0], type: 'source' },
    ]);
    const embeddings = new Map(entries);

    const results = await semanticSearch('test query', embeddings, mockEmbedder);

    // Default limit is 10, so at most 10 results returned.
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('uses default threshold of 0.3, excluding entries below it', async () => {
    const embeddings = buildTestEmbeddings();
    const results = await semanticSearch('test query', embeddings, mockEmbedder);

    // delta.md has score -1.0 and must be excluded by default threshold (0.3)
    const paths = results.map((r) => r.path);
    expect(paths).not.toContain('notes/delta.md');
  });

  it('returns an empty array for an empty embeddings Map', async () => {
    const results = await semanticSearch('test query', new Map(), mockEmbedder);
    expect(results).toEqual([]);
  });

  it('top result is the entry most similar to the query', async () => {
    const embeddings = buildTestEmbeddings();
    const results = await semanticSearch('test query', embeddings, mockEmbedder);

    // alpha.md and alpha.md#Section both have score 1.0 -- top result is one of them
    expect(results[0].score).toBe(1.0);
  });

  // -- type filter ----------------------------------------------------------

  it('returns only source entries when type is "source"', async () => {
    const embeddings = buildTestEmbeddings();
    const results = await semanticSearch('test query', embeddings, mockEmbedder, {
      type: 'source',
      threshold: 0,
    });

    // No block entries should appear in results.
    const paths = results.map((r) => r.path);
    expect(paths).not.toContain('notes/alpha.md#Section');
    // At least one source must be present.
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns only block entries when type is "block"', async () => {
    const embeddings = buildTestEmbeddings();
    const results = await semanticSearch('test query', embeddings, mockEmbedder, {
      type: 'block',
      threshold: 0,
    });

    // Every result must be a block (path contains '#').
    for (const r of results) {
      expect(r.path).toContain('#');
    }
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns all entry types when type is omitted (backward compat)', async () => {
    const embeddings = buildTestEmbeddings();
    const results = await semanticSearch('test query', embeddings, mockEmbedder, {
      threshold: 0,
    });

    const types = results.map((r) => {
      const entry = embeddings.get(r.path);
      return entry.type;
    });
    // Must include at least one source and one block.
    expect(types).toContain('source');
    expect(types).toContain('block');
  });

  // -- folder filter --------------------------------------------------------

  it('returns only entries within the specified folder', async () => {
    const embeddings = buildFolderTestEmbeddings();
    const results = await semanticSearch('test query', embeddings, mockEmbedder, {
      folder: 'Projects/',
      threshold: 0,
    });

    for (const r of results) {
      expect(r.path.toLowerCase().startsWith('projects/')).toBe(true);
    }
    expect(results.length).toBeGreaterThan(0);
  });

  it('folder matching is case-insensitive', async () => {
    const embeddings = buildFolderTestEmbeddings();
    const lower = await semanticSearch('test query', embeddings, mockEmbedder, {
      folder: 'projects/',
      threshold: 0,
    });
    const upper = await semanticSearch('test query', embeddings, mockEmbedder, {
      folder: 'PROJECTS/',
      threshold: 0,
    });

    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBeGreaterThan(0);
  });

  it('returns empty results for a nonexistent folder', async () => {
    const embeddings = buildFolderTestEmbeddings();
    const results = await semanticSearch('test query', embeddings, mockEmbedder, {
      folder: 'NonexistentFolder/',
      threshold: 0,
    });

    expect(results).toEqual([]);
  });

  it('combines folder and type filters correctly', async () => {
    const embeddings = buildFolderTestEmbeddings();
    const results = await semanticSearch('test query', embeddings, mockEmbedder, {
      folder: 'Projects/',
      type: 'source',
      threshold: 0,
    });

    for (const r of results) {
      expect(r.path.toLowerCase().startsWith('projects/')).toBe(true);
      expect(r.path).not.toContain('#');
    }
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns all entries when folder is omitted', async () => {
    const embeddings = buildFolderTestEmbeddings();
    const withoutFolder = await semanticSearch('test query', embeddings, mockEmbedder, {
      threshold: 0,
    });

    // Should include entries from multiple folders.
    expect(withoutFolder.length).toBe(embeddings.size);
  });
});

// ---------------------------------------------------------------------------
// findRelated
// ---------------------------------------------------------------------------

describe('findRelated', () => {
  it('excludes the queried note itself from results', () => {
    const embeddings = buildTestEmbeddings();
    const results = findRelated('notes/alpha.md', embeddings);

    const paths = results.map((r) => r.path);
    expect(paths).not.toContain('notes/alpha.md');
  });

  it('throws a descriptive error when the note path is not in the Map', () => {
    const embeddings = buildTestEmbeddings();
    expect(() => findRelated('notes/missing.md', embeddings)).toThrowError(
      /not found in the embeddings Map/
    );
  });

  it('returns results sorted by score descending', () => {
    const embeddings = buildTestEmbeddings();
    const results = findRelated('notes/beta.md', embeddings);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('respects the limit option', () => {
    const embeddings = buildTestEmbeddings();
    const results = findRelated('notes/alpha.md', embeddings, { limit: 1 });

    expect(results).toHaveLength(1);
  });

  it('respects the threshold option and excludes entries below it', () => {
    const embeddings = buildTestEmbeddings();
    // alpha.md vector is [1,0,0]. gamma.md is [1,1,0] = 0.707, beta is [0,1,0] = 0.0.
    // threshold 0.5 should keep gamma and alpha#Section (1.0) but drop beta and delta.
    const results = findRelated('notes/alpha.md', embeddings, { threshold: 0.5 });

    for (const result of results) {
      expect(result.score).toBeGreaterThanOrEqual(0.5);
    }
    const paths = results.map((r) => r.path);
    expect(paths).not.toContain('notes/beta.md');
    expect(paths).not.toContain('notes/delta.md');
  });

  it('returns result objects with path and score fields', () => {
    const embeddings = buildTestEmbeddings();
    const results = findRelated('notes/alpha.md', embeddings);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('path');
    expect(results[0]).toHaveProperty('score');
  });

  it('returns an empty array when the only entry is the queried note', () => {
    const embeddings = new Map([
      ['notes/only.md', { vec: [1, 0, 0], type: 'source' }],
    ]);
    const results = findRelated('notes/only.md', embeddings);
    expect(results).toEqual([]);
  });

  // -- type filter ----------------------------------------------------------

  it('returns only source entries when type is "source"', () => {
    const embeddings = buildTestEmbeddings();
    const results = findRelated('notes/alpha.md', embeddings, {
      type: 'source',
      threshold: 0,
    });

    const paths = results.map((r) => r.path);
    // Block entry must be excluded.
    expect(paths).not.toContain('notes/alpha.md#Section');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns only block entries when type is "block"', () => {
    const embeddings = buildTestEmbeddings();
    const results = findRelated('notes/alpha.md', embeddings, {
      type: 'block',
      threshold: 0,
    });

    for (const r of results) {
      expect(r.path).toContain('#');
    }
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns all entry types when type is omitted (backward compat)', () => {
    const embeddings = buildTestEmbeddings();
    const results = findRelated('notes/alpha.md', embeddings, { threshold: 0 });

    const types = results.map((r) => {
      const entry = embeddings.get(r.path);
      return entry.type;
    });
    expect(types).toContain('source');
    expect(types).toContain('block');
  });
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

describe('getStats', () => {
  it('returns correct totalNotes count (entries with type "source")', () => {
    const embeddings = buildTestEmbeddings();
    const stats = getStats(embeddings);

    // buildTestEmbeddings has 4 source entries and 1 block entry
    expect(stats.totalNotes).toBe(4);
  });

  it('returns correct totalBlocks count (entries with type "block")', () => {
    const embeddings = buildTestEmbeddings();
    const stats = getStats(embeddings);

    expect(stats.totalBlocks).toBe(1);
  });

  it('returns dimensions from the vec.length of the first entry', () => {
    const embeddings = buildTestEmbeddings();
    const stats = getStats(embeddings);

    // All test vectors are 3-dimensional
    expect(stats.dimensions).toBe(3);
  });

  it('returns 0 dimensions for an empty Map', () => {
    const stats = getStats(new Map());

    expect(stats.dimensions).toBe(0);
  });

  it('returns modelId as "TaylorAI/bge-micro-v2"', () => {
    const embeddings = buildTestEmbeddings();
    const stats = getStats(embeddings);

    expect(stats.modelId).toBe('TaylorAI/bge-micro-v2');
  });

  it('returns all four expected fields', () => {
    const stats = getStats(new Map());

    expect(stats).toHaveProperty('totalNotes');
    expect(stats).toHaveProperty('totalBlocks');
    expect(stats).toHaveProperty('dimensions');
    expect(stats).toHaveProperty('modelId');
  });

  it('counts correctly for an embeddings Map with only blocks', () => {
    const embeddings = new Map([
      ['notes/note.md#Heading 1', { vec: [1, 0], type: 'block' }],
      ['notes/note.md#Heading 2', { vec: [0, 1], type: 'block' }],
    ]);
    const stats = getStats(embeddings);

    expect(stats.totalNotes).toBe(0);
    expect(stats.totalBlocks).toBe(2);
  });

  it('counts correctly for an embeddings Map with only sources', () => {
    const embeddings = new Map([
      ['notes/a.md', { vec: [1, 0], type: 'source' }],
      ['notes/b.md', { vec: [0, 1], type: 'source' }],
      ['notes/c.md', { vec: [1, 1], type: 'source' }],
    ]);
    const stats = getStats(embeddings);

    expect(stats.totalNotes).toBe(3);
    expect(stats.totalBlocks).toBe(0);
  });
});
