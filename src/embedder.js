// Embedder module: wraps @huggingface/transformers pipeline for text-to-vector encoding.
// Uses lazy initialization so the ~23 MB ONNX model is only downloaded on first encode().

import { pipeline } from '@huggingface/transformers';

// Default model: bge-micro-v2 produces 384-dimensional normalized vectors and is
// small enough (~23 MB) to be practical in a local MCP server context.
const DEFAULT_MODEL_ID = 'TaylorAI/bge-micro-v2';

// bge-micro-v2 has a hard 512-token positional embedding table. The @huggingface/transformers
// pipeline does not automatically truncate before the ONNX forward pass, so inputs that
// tokenize to >512 tokens crash with an ONNX shape mismatch. At ~3.5 chars/token average,
// 1800 characters stays safely under 512 tokens including the 2 special tokens ([CLS]/[SEP]).
const MAX_CHARS = 1800;

/**
 * Validate that input is a non-empty, non-whitespace string.
 *
 * @param {unknown} text - The value to validate.
 * @throws {Error} If text is not a string, or is empty / whitespace-only.
 */
function validateText(text) {
  if (typeof text !== 'string') {
    throw new Error(
      `encode() expects a string, but received ${text === null ? 'null' : typeof text}`
    );
  }
  if (text.trim().length === 0) {
    throw new Error(
      'encode() received an empty or whitespace-only string -- provide meaningful text to embed'
    );
  }
}

/**
 * Factory that creates an embedder backed by a HuggingFace feature-extraction pipeline.
 *
 * The pipeline is created lazily: no network or disk I/O happens until the first
 * call to encode(). Subsequent calls reuse the already-loaded pipeline.
 *
 * @param {string} [modelId] - HuggingFace model identifier. Defaults to bge-micro-v2.
 * @returns {{ encode: (text: string) => Promise<Float32Array> }}
 */
function createEmbedder(modelId = DEFAULT_MODEL_ID) {
  // Holds the pipeline instance once initialized; null until first encode() call.
  let pipe = null;

  /**
   * Lazily initialize the feature-extraction pipeline on first call.
   * Reuses the cached instance on subsequent calls.
   *
   * @returns {Promise<Function>} The loaded pipeline function.
   */
  async function getPipeline() {
    if (pipe === null) {
      // 'feature-extraction' produces per-token embeddings that we pool into one vector.
      pipe = await pipeline('feature-extraction', modelId);
    }
    return pipe;
  }

  /**
   * Encode text into a normalized 384-dimensional embedding vector.
   *
   * Pooling strategy: mean pooling over token embeddings, then L2 normalization.
   * Inputs longer than MAX_CHARS are silently truncated at a word boundary to
   * stay within the model's 512-token positional embedding limit. The pipeline
   * does not expose a truncation option that reaches the ONNX layer, so we
   * truncate the raw text before tokenization.
   *
   * @param {string} text - The text to embed. Must be a non-empty string.
   * @returns {Promise<Float32Array>} A 384-element normalized Float32Array.
   * @throws {Error} If text is not a string or is empty/whitespace.
   */
  async function encode(text) {
    validateText(text);

    // Truncate at MAX_CHARS to prevent the ONNX positional-embedding shape error.
    // We slice at a space boundary to avoid cutting mid-word where possible.
    const safeText = text.length <= MAX_CHARS
      ? text
      : text.slice(0, MAX_CHARS).replace(/\s+\S*$/, '');

    const activePipe = await getPipeline();
    // mean pooling + normalize=true gives a unit-length vector suitable for
    // cosine similarity comparisons without additional normalization.
    const result = await activePipe(safeText, { pooling: 'mean', normalize: true });

    // result.data is already a Float32Array from the Tensor object.
    return result.data;
  }

  return { encode };
}

export { createEmbedder };
