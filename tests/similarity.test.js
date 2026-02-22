// Tests for cosine similarity computation (src/similarity.js).
// Covers happy paths, edge cases, and known-angle assertions.

import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../src/similarity.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const vec = [1, 2, 3];
    expect(cosineSimilarity(vec, vec)).toBe(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    // [1, 0] and [0, 1] are perpendicular -- dot product is zero
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    // [1, 0] and [-1, 0] point in exactly opposite directions
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1.0);
  });

  it('returns 0 for mismatched vector lengths', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 for null first argument', () => {
    expect(cosineSimilarity(null, [1, 2, 3])).toBe(0);
  });

  it('returns 0 for undefined first argument', () => {
    expect(cosineSimilarity(undefined, [1, 2, 3])).toBe(0);
  });

  it('returns 0 for null second argument', () => {
    expect(cosineSimilarity([1, 2, 3], null)).toBe(0);
  });

  it('returns 0 for undefined second argument', () => {
    expect(cosineSimilarity([1, 2, 3], undefined)).toBe(0);
  });

  it('returns 0 for both arguments null', () => {
    expect(cosineSimilarity(null, null)).toBe(0);
  });

  it('returns 0 when vecA is a zero vector', () => {
    // Division by zero magnitude must not produce NaN
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('returns 0 when vecB is a zero vector', () => {
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('returns 0 when both are zero vectors', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('returns ~0.707 for [1,0] vs [1,1] (45-degree angle)', () => {
    // cos(45 degrees) = 1/sqrt(2) ~= 0.707
    const result = cosineSimilarity([1, 0], [1, 1]);
    expect(result).toBe(0.707);
  });

  it('returns ~0.816 for [1,1,0] vs [1,1,1] (known angle)', () => {
    // dot = 2, |a| = sqrt(2), |b| = sqrt(3), cos = 2/sqrt(6) ~= 0.8165
    const result = cosineSimilarity([1, 1, 0], [1, 1, 1]);
    expect(result).toBe(0.816);
  });

  it('rounds result to 3 decimal places', () => {
    // cos between [1,2] and [2,3] = (2+6)/(sqrt(5)*sqrt(13)) = 8/sqrt(65)
    // = 8/8.0623 ~= 0.99228 -> rounds to 0.992
    const result = cosineSimilarity([1, 2], [2, 3]);
    expect(result).toBe(0.992);
  });
});
