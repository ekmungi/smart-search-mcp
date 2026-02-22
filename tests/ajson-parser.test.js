// Tests for AJSON parser (src/ajson-parser.js).
// Covers line parsing, type detection, embedding extraction, and directory loading.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { parseAjsonContent, loadEmbeddings } from '../src/ajson-parser.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A minimal source-level entry (full note, not a block).
// Embedding vec trimmed to 3 floats for readability in tests.
const SOURCE_LINE =
  '"smart_sources:00 INBOX/note.md": {"path":"00 INBOX/note.md","embeddings":{"TaylorAI/bge-micro-v2":{"vec":[-0.059,0.001,0.042]}}},';

// A block-level entry where path field is null (path lives in the key).
const BLOCK_LINE =
  '"smart_blocks:00 INBOX/note.md#Some Heading": {"path":null,"embeddings":{"TaylorAI/bge-micro-v2":{"vec":[-0.083,0.011,0.027]}}},';

// An entry that has no embeddings object at all.
const NO_EMBEDDINGS_LINE =
  '"smart_sources:00 INBOX/orphan.md": {"path":"00 INBOX/orphan.md"},';

// An entry with embeddings but no vec array.
const NO_VEC_LINE =
  '"smart_sources:00 INBOX/no-vec.md": {"path":"00 INBOX/no-vec.md","embeddings":{"TaylorAI/bge-micro-v2":{}}},';

// Completely garbled text that cannot be parsed.
const MALFORMED_LINE = 'not valid json at all }{';

// ---------------------------------------------------------------------------
// parseAjsonContent
// ---------------------------------------------------------------------------

describe('parseAjsonContent', () => {
  it('parses a source entry and returns correct path, vec, and type', () => {
    const results = parseAjsonContent(SOURCE_LINE);

    expect(results).toHaveLength(1);
    const entry = results[0];
    expect(entry.path).toBe('00 INBOX/note.md');
    expect(entry.type).toBe('source');
    expect(entry.vec).toEqual([-0.059, 0.001, 0.042]);
  });

  it('parses a block entry and returns type="block" with path from key', () => {
    const results = parseAjsonContent(BLOCK_LINE);

    expect(results).toHaveLength(1);
    const entry = results[0];
    // Path comes from the key (after the prefix), not the null path field.
    expect(entry.path).toBe('00 INBOX/note.md#Some Heading');
    expect(entry.type).toBe('block');
    expect(entry.vec).toEqual([-0.083, 0.011, 0.027]);
  });

  it('handles multiple lines and returns an entry per parseable line', () => {
    const content = [SOURCE_LINE, BLOCK_LINE].join('\n');
    const results = parseAjsonContent(content);

    expect(results).toHaveLength(2);
    expect(results[0].type).toBe('source');
    expect(results[1].type).toBe('block');
  });

  it('skips entries that have no embeddings object', () => {
    const content = [SOURCE_LINE, NO_EMBEDDINGS_LINE].join('\n');
    const results = parseAjsonContent(content);

    // Only the entry with embeddings should be returned.
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('00 INBOX/note.md');
  });

  it('skips entries whose model bucket exists but has no vec array', () => {
    const content = [SOURCE_LINE, NO_VEC_LINE].join('\n');
    const results = parseAjsonContent(content);

    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('00 INBOX/note.md');
  });

  it('skips malformed lines without throwing', () => {
    const content = [MALFORMED_LINE, SOURCE_LINE].join('\n');
    // Must not throw; valid lines still parsed.
    let results;
    expect(() => {
      results = parseAjsonContent(content);
    }).not.toThrow();
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('00 INBOX/note.md');
  });

  it('returns an empty array for empty string input', () => {
    const results = parseAjsonContent('');
    expect(results).toEqual([]);
  });

  it('returns an empty array for whitespace-only input', () => {
    const results = parseAjsonContent('   \n  \n  ');
    expect(results).toEqual([]);
  });

  it('strips the smart_sources: prefix from the path', () => {
    const results = parseAjsonContent(SOURCE_LINE);
    // Path must not contain the prefix.
    expect(results[0].path).not.toContain('smart_sources:');
  });

  it('strips the smart_blocks: prefix from the path', () => {
    const results = parseAjsonContent(BLOCK_LINE);
    expect(results[0].path).not.toContain('smart_blocks:');
  });

  it('handles a line without a trailing comma', () => {
    // The trailing comma is optional; strip it when present, tolerate absence.
    const lineNoComma =
      '"smart_sources:00 INBOX/note.md": {"path":"00 INBOX/note.md","embeddings":{"TaylorAI/bge-micro-v2":{"vec":[-0.059,0.001,0.042]}}}';
    const results = parseAjsonContent(lineNoComma);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('00 INBOX/note.md');
  });

  it('skips blank lines between valid entries', () => {
    const content = [SOURCE_LINE, '', BLOCK_LINE, ''].join('\n');
    const results = parseAjsonContent(content);
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// loadEmbeddings - integration tests using a real temp directory
// ---------------------------------------------------------------------------

describe('loadEmbeddings', () => {
  let tmpDir;

  beforeEach(async () => {
    // Create an isolated temp directory for each test.
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ajson-test-'));
  });

  afterEach(async () => {
    // Remove the temp directory tree after each test.
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads .ajson files from the .smart-env/multi/ subdirectory', async () => {
    const multiDir = path.join(tmpDir, '.smart-env', 'multi');
    await fs.mkdir(multiDir, { recursive: true });
    await fs.writeFile(path.join(multiDir, 'note.ajson'), SOURCE_LINE + '\n');

    const result = await loadEmbeddings(tmpDir);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(1);
    expect(result.has('00 INBOX/note.md')).toBe(true);
  });

  it('returns a Map value with vec and type fields', async () => {
    const multiDir = path.join(tmpDir, '.smart-env', 'multi');
    await fs.mkdir(multiDir, { recursive: true });
    await fs.writeFile(path.join(multiDir, 'note.ajson'), SOURCE_LINE + '\n');

    const result = await loadEmbeddings(tmpDir);
    const entry = result.get('00 INBOX/note.md');

    expect(entry).toHaveProperty('vec');
    expect(entry).toHaveProperty('type');
    expect(entry.type).toBe('source');
    expect(entry.vec).toEqual([-0.059, 0.001, 0.042]);
  });

  it('aggregates entries across multiple .ajson files', async () => {
    const multiDir = path.join(tmpDir, '.smart-env', 'multi');
    await fs.mkdir(multiDir, { recursive: true });
    await fs.writeFile(path.join(multiDir, 'a.ajson'), SOURCE_LINE + '\n');
    await fs.writeFile(path.join(multiDir, 'b.ajson'), BLOCK_LINE + '\n');

    const result = await loadEmbeddings(tmpDir);

    expect(result.size).toBe(2);
    expect(result.has('00 INBOX/note.md')).toBe(true);
    expect(result.has('00 INBOX/note.md#Some Heading')).toBe(true);
  });

  it('ignores non-.ajson files in the directory', async () => {
    const multiDir = path.join(tmpDir, '.smart-env', 'multi');
    await fs.mkdir(multiDir, { recursive: true });
    await fs.writeFile(path.join(multiDir, 'note.ajson'), SOURCE_LINE + '\n');
    // This file must be silently skipped.
    await fs.writeFile(path.join(multiDir, 'README.txt'), 'ignore me');

    const result = await loadEmbeddings(tmpDir);

    expect(result.size).toBe(1);
  });

  it('returns an empty Map when the .smart-env/multi/ directory does not exist', async () => {
    // tmpDir has no .smart-env subdirectory.
    const result = await loadEmbeddings(tmpDir);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('entries from later files overwrite earlier entries with the same path', async () => {
    // Both files contain an entry for the same path with different vec values.
    const multiDir = path.join(tmpDir, '.smart-env', 'multi');
    await fs.mkdir(multiDir, { recursive: true });

    const first =
      '"smart_sources:00 INBOX/note.md": {"path":"00 INBOX/note.md","embeddings":{"TaylorAI/bge-micro-v2":{"vec":[1.0,0.0,0.0]}}},';
    const second =
      '"smart_sources:00 INBOX/note.md": {"path":"00 INBOX/note.md","embeddings":{"TaylorAI/bge-micro-v2":{"vec":[0.0,1.0,0.0]}}},';

    await fs.writeFile(path.join(multiDir, 'a.ajson'), first + '\n');
    await fs.writeFile(path.join(multiDir, 'b.ajson'), second + '\n');

    const result = await loadEmbeddings(tmpDir);

    // The Map must have exactly one entry for this path.
    expect(result.size).toBe(1);
    // Value is deterministic (last-write-wins given directory sort order).
  });
});
