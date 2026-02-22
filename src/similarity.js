// Cosine similarity computation for comparing embedding vectors.
// Used by the semantic search pipeline to rank notes against a query vector.

/**
 * Compute the cosine similarity between two numeric vectors.
 *
 * Cosine similarity measures the angle between two vectors in n-dimensional
 * space, returning a value in [-1, 1]. A result of 1.0 means identical
 * direction, 0.0 means orthogonal, -1.0 means opposite direction.
 *
 * @param {number[]|null|undefined} vecA - First vector.
 * @param {number[]|null|undefined} vecB - Second vector.
 * @returns {number} Cosine similarity rounded to 3 decimal places.
 *   Returns 0 for null/undefined inputs, mismatched lengths, or zero vectors.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) {
    return 0;
  }

  if (vecA.length !== vecB.length) {
    return 0;
  }

  // Compute dot product and magnitudes in a single pass for efficiency.
  // Using reduce with an immutable accumulator tuple avoids mutation.
  const [dotProduct, magA, magB] = vecA.reduce(
    ([dot, sumA, sumB], a, i) => [
      dot + a * vecB[i],
      sumA + a * a,
      sumB + vecB[i] * vecB[i],
    ],
    [0, 0, 0]
  );

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);

  // Guard against division by zero when either vector is all zeros.
  if (magnitude === 0) {
    return 0;
  }

  return Math.round((dotProduct / magnitude) * 1000) / 1000;
}
