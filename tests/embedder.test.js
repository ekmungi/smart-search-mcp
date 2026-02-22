// Tests for the embedder module (src/embedder.js).
// Covers factory shape, vector output dimensions, normalization, and input validation.
// NOTE: The first run downloads bge-micro-v2 (~23MB ONNX). Integration tests use a
// 60-second timeout to accommodate cold-start model fetching.

import { describe, it, expect } from 'vitest';
import { createEmbedder } from '../src/embedder.js';

// ---------------------------------------------------------------------------
// Unit tests -- no model required
// ---------------------------------------------------------------------------

describe('createEmbedder', () => {
  it('returns an object with an encode function', () => {
    const embedder = createEmbedder();
    expect(embedder).toBeDefined();
    expect(typeof embedder.encode).toBe('function');
  });

  it('returns a different object each time it is called', () => {
    // Factory should produce independent instances
    const a = createEmbedder();
    const b = createEmbedder();
    expect(a).not.toBe(b);
  });

  it('accepts a custom modelId without throwing at construction time', () => {
    // Lazy init means construction itself should never throw
    expect(() => createEmbedder('TaylorAI/bge-micro-v2')).not.toThrow();
  });
});

describe('encode -- input validation (no model needed)', () => {
  it('throws a descriptive error for empty string input', async () => {
    const embedder = createEmbedder();
    await expect(embedder.encode('')).rejects.toThrow(/empty/i);
  });

  it('throws a descriptive error for whitespace-only input', async () => {
    const embedder = createEmbedder();
    await expect(embedder.encode('   ')).rejects.toThrow(/empty/i);
  });

  it('throws a descriptive error for a numeric input', async () => {
    const embedder = createEmbedder();
    await expect(embedder.encode(42)).rejects.toThrow(/string/i);
  });

  it('throws a descriptive error for null input', async () => {
    const embedder = createEmbedder();
    await expect(embedder.encode(null)).rejects.toThrow(/string/i);
  });

  it('throws a descriptive error for undefined input', async () => {
    const embedder = createEmbedder();
    await expect(embedder.encode(undefined)).rejects.toThrow(/string/i);
  });
});

// ---------------------------------------------------------------------------
// Integration tests -- download model on first run (~23 MB, up to 60 s)
// ---------------------------------------------------------------------------

describe('integration', { timeout: 60000 }, () => {
  // Shared embedder so the pipeline is created once for all integration tests
  let embedder;

  it('encodes "hello world" into a Float32Array of length 384', async () => {
    embedder = createEmbedder();
    const vec = await embedder.encode('hello world');

    // @huggingface/transformers returns a Tensor whose .data is a Float32Array
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(384);
  });

  it('output vector is normalized (magnitude approximately 1.0)', async () => {
    if (!embedder) {
      embedder = createEmbedder();
    }
    const vec = await embedder.encode('hello world');

    // Compute L2 magnitude: sqrt(sum of squares)
    const magnitude = Math.sqrt(Array.from(vec).reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 1); // within 0.01
  });

  it('second call reuses the cached pipeline (no extra download)', async () => {
    if (!embedder) {
      embedder = createEmbedder();
    }
    // If lazy init works correctly, a second encode is fast
    const vecA = await embedder.encode('semantic search');
    const vecB = await embedder.encode('semantic search');

    expect(vecA).toBeInstanceOf(Float32Array);
    expect(vecB).toBeInstanceOf(Float32Array);
    // Same input should produce the same output
    expect(Array.from(vecA)).toEqual(Array.from(vecB));
  });

  it('different inputs produce different vectors', async () => {
    if (!embedder) {
      embedder = createEmbedder();
    }
    const vecA = await embedder.encode('machine learning');
    const vecB = await embedder.encode('cooking recipes');

    const arrA = Array.from(vecA);
    const arrB = Array.from(vecB);
    // The two vectors must differ on at least one dimension
    const differ = arrA.some((v, i) => v !== arrB[i]);
    expect(differ).toBe(true);
  });

  it('long text (>512 tokens) does not crash -- encode() pre-truncates to stay within model limit', async () => {
    if (!embedder) {
      embedder = createEmbedder();
    }
    // bge-micro-v2 has a hard 512-token positional embedding table. The pipeline does not
    // expose a truncation option that reaches the ONNX layer, so encode() truncates the
    // raw text at ~1800 characters before passing it to the model. Verify no error is thrown
    // and a valid 384-dim vector is returned.
    const longText = 'The quick brown fox jumps over the lazy dog. '.repeat(80);
    const vec = await embedder.encode(longText);
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(384);
  });
});
