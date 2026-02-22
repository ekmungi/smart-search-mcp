// MCP server entry point for smart-search.
// Registers semantic_search, find_related, and vault_stats tools over stdio transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadEmbeddings } from './ajson-parser.js';
import { createEmbedder } from './embedder.js';
import { semanticSearch, findRelated, getStats } from './search.js';

// ---------------------------------------------------------------------------
// Result formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format an array of search results as a human-readable text string.
 *
 * Each result is rendered on its own line: "path (score: X.XXX)".
 * Returns a fallback message when the results array is empty.
 *
 * @param {Array<{path: string, score: number}>} results - Sorted search results.
 * @returns {string} Formatted multi-line text ready for MCP content.
 */
function formatResults(results) {
  if (results.length === 0) {
    return 'No results found.';
  }
  return results
    .map((r) => `${r.path} (score: ${r.score.toFixed(3)})`)
    .join('\n');
}

/**
 * Wrap a string in an MCP text content envelope.
 *
 * @param {string} text - The text to wrap.
 * @returns {{ content: Array<{type: string, text: string}> }}
 */
function textContent(text) {
  return { content: [{ type: 'text', text }] };
}

// ---------------------------------------------------------------------------
// Server factory (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Create and configure a McpServer instance with all tools registered.
 *
 * Does NOT connect to a transport -- callers must call server.connect()
 * themselves. This separation lets tests exercise tool registration without
 * starting stdio.
 *
 * @param {Map<string, {vec: number[], type: string}>} embeddings - Preloaded vault embeddings.
 * @param {{ encode: (text: string) => Promise<Float32Array> }} embedder - Text encoder instance.
 * @returns {McpServer} Configured server with semantic_search, find_related, vault_stats tools.
 */
export function createServer(embeddings, embedder) {
  const server = new McpServer({
    name: 'smart-search',
    version: '1.0.0',
  });

  // Tool: semantic_search
  // Encodes a natural-language query and returns the most similar vault notes.
  server.tool(
    'semantic_search',
    'Search vault notes semantically using a natural-language query.',
    {
      query: z.string().min(1).max(2000),
      limit: z.number().optional(),
      threshold: z.number().optional(),
    },
    async ({ query, limit, threshold }) => {
      try {
        const results = await semanticSearch(query, embeddings, embedder, {
          limit,
          threshold,
        });
        return textContent(formatResults(results));
      } catch (err) {
        // Return error as text so the client receives a readable message
        // rather than an MCP protocol error that would crash the call.
        return textContent(`Error running semantic_search: ${err.message}`);
      }
    }
  );

  // Tool: find_related
  // Finds notes similar to a known note by comparing their stored embeddings.
  server.tool(
    'find_related',
    'Find notes related to a specific note by path.',
    {
      note_path: z.string().min(1).max(500),
      limit: z.number().optional(),
    },
    async ({ note_path, limit }) => {
      try {
        const results = findRelated(note_path, embeddings, { limit });
        return textContent(formatResults(results));
      } catch (err) {
        return textContent(`Error running find_related: ${err.message}`);
      }
    }
  );

  // Tool: vault_stats
  // Returns summary statistics about the loaded embeddings.
  server.tool(
    'vault_stats',
    'Return summary statistics about the loaded vault embeddings.',
    {},
    () => {
      try {
        const stats = getStats(embeddings);
        const lines = [
          `Total notes: ${stats.totalNotes}`,
          `Total blocks: ${stats.totalBlocks}`,
          `Dimensions: ${stats.dimensions}`,
          `Model: ${stats.modelId}`,
        ];
        return textContent(lines.join('\n'));
      } catch (err) {
        return textContent(`Error running vault_stats: ${err.message}`);
      }
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * Main entry point: read env, load embeddings, create server, connect transport.
 *
 * Writes to stderr on configuration errors and calls process.exit(1) when the
 * OBSIDIAN_VAULT_PATH environment variable is missing. A missing or empty
 * embeddings directory is treated as a warning (not a fatal error) so the
 * server can still serve vault_stats indicating zero notes.
 *
 * @returns {Promise<void>}
 */
export async function main() {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
  if (!vaultPath) {
    process.stderr.write(
      'Error: OBSIDIAN_VAULT_PATH environment variable is not set.\n'
    );
    process.exit(1);
  }

  const embeddings = await loadEmbeddings(vaultPath);
  if (embeddings.size === 0) {
    process.stderr.write(
      `Warning: No embeddings found in ${vaultPath}/.smart-env/multi/. ` +
        'Run Smart Connections in Obsidian to generate embeddings.\n'
    );
  }

  const embedder = createEmbedder();
  const server = createServer(embeddings, embedder);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-run main() when this file is executed directly (not when imported).
// Uses pathToFileURL for robust comparison across Windows/Unix path formats.
import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  });
}
