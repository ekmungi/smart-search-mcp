// Tests for the MCP server entry point (src/server.js).
// Focuses on wiring: tool registration, env validation, and graceful error handling.
// Uses mock embeddings and embedder -- no real vault or model loading.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/server.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Minimal mock embeddings -- two notes with 3-dimensional vectors.
const mockEmbeddings = new Map([
  ['note1.md', { vec: [1, 0, 0], type: 'source' }],
  ['note2.md', { vec: [0, 1, 0], type: 'source' }],
]);

// Mock embedder that returns a fixed Float32Array without loading any model.
const mockEmbedder = { encode: async () => new Float32Array([1, 0, 0]) };

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

describe('createServer', () => {
  it('returns an object (the McpServer instance)', () => {
    const server = createServer(mockEmbeddings, mockEmbedder);

    // McpServer exposes a .server property (the underlying low-level Server).
    expect(server).toBeDefined();
    expect(typeof server).toBe('object');
  });

  it('exposes a connect method (McpServer interface)', () => {
    const server = createServer(mockEmbeddings, mockEmbedder);

    expect(typeof server.connect).toBe('function');
  });

  it('registers semantic_search tool', () => {
    const server = createServer(mockEmbeddings, mockEmbedder);

    // _registeredTools is the internal registry on McpServer.
    expect(server._registeredTools).toHaveProperty('semantic_search');
  });

  it('registers find_related tool', () => {
    const server = createServer(mockEmbeddings, mockEmbedder);

    expect(server._registeredTools).toHaveProperty('find_related');
  });

  it('registers vault_stats tool', () => {
    const server = createServer(mockEmbeddings, mockEmbedder);

    expect(server._registeredTools).toHaveProperty('vault_stats');
  });

  it('does not throw when given an empty embeddings Map', () => {
    // Empty map means no embeddings yet -- server must still start.
    expect(() => createServer(new Map(), mockEmbedder)).not.toThrow();
  });

  it('creates an independent server on each call', () => {
    const serverA = createServer(mockEmbeddings, mockEmbedder);
    const serverB = createServer(mockEmbeddings, mockEmbedder);

    expect(serverA).not.toBe(serverB);
  });
});

// ---------------------------------------------------------------------------
// Tool handlers (via internal handler invocation)
// ---------------------------------------------------------------------------

describe('semantic_search tool handler', () => {
  it('returns text content with matched paths and scores', async () => {
    const server = createServer(mockEmbeddings, mockEmbedder);
    const handler = server._registeredTools['semantic_search'].handler;

    // The handler receives (args, extra) -- we only need args here.
    const result = await handler({ query: 'test query' }, {});

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    // At least one content item must be of type 'text'.
    const textItem = result.content.find((c) => c.type === 'text');
    expect(textItem).toBeDefined();
    expect(typeof textItem.text).toBe('string');
  });

  it('returns error text (not a thrown exception) when search fails', async () => {
    // Embedder that always rejects simulates a model failure.
    const brokenEmbedder = { encode: async () => { throw new Error('model crashed'); } };
    const server = createServer(mockEmbeddings, brokenEmbedder);
    const handler = server._registeredTools['semantic_search'].handler;

    const result = await handler({ query: 'test' }, {});

    // Must return error text content, not throw.
    expect(result).toHaveProperty('content');
    const textItem = result.content.find((c) => c.type === 'text');
    expect(textItem.text).toMatch(/error/i);
  });
});

describe('find_related tool handler', () => {
  it('returns text content listing related paths and scores', async () => {
    const server = createServer(mockEmbeddings, mockEmbedder);
    const handler = server._registeredTools['find_related'].handler;

    const result = await handler({ note_path: 'note1.md' }, {});

    expect(result).toHaveProperty('content');
    const textItem = result.content.find((c) => c.type === 'text');
    expect(textItem).toBeDefined();
    expect(typeof textItem.text).toBe('string');
  });

  it('returns error text when note_path is not in embeddings', async () => {
    const server = createServer(mockEmbeddings, mockEmbedder);
    const handler = server._registeredTools['find_related'].handler;

    const result = await handler({ note_path: 'nonexistent.md' }, {});

    const textItem = result.content.find((c) => c.type === 'text');
    // Either no results or error message -- must not throw.
    expect(typeof textItem.text).toBe('string');
  });
});

describe('vault_stats tool handler', () => {
  it('returns text content with stat lines', async () => {
    const server = createServer(mockEmbeddings, mockEmbedder);
    const handler = server._registeredTools['vault_stats'].handler;

    const result = await handler({}, {});

    expect(result).toHaveProperty('content');
    const textItem = result.content.find((c) => c.type === 'text');
    expect(textItem).toBeDefined();
    // Stats text must mention note count.
    expect(textItem.text).toMatch(/\d+/);
  });
});

// ---------------------------------------------------------------------------
// main() startup validation (env var check)
// ---------------------------------------------------------------------------

describe('main startup validation', () => {
  beforeEach(() => {
    // Ensure the env var is absent for these tests.
    delete process.env.OBSIDIAN_VAULT_PATH;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits with code 1 when OBSIDIAN_VAULT_PATH is not set', async () => {
    // Import main via dynamic import so we can control env and mock exit.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Dynamically import to get a fresh module reference.
    const { main } = await import('../src/server.js');

    await expect(main()).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
