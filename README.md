# Smart Search MCP Server

Semantic search over Obsidian vaults for [Claude Code](https://claude.ai/claude-code). Finds notes by meaning, not just keywords.

Built on pre-computed [Smart Connections](https://smartconnections.app/) embeddings -- does **not** require Obsidian to be running.

## How It Works

```
"What did we discuss in out last brainstorming session?"
        |
        v
  [bge-micro-v2]  Encode query -> 384-dim vector (ONNX, local)
        |
        v
  [AJSON Parser]  Load pre-computed note embeddings from .smart-env/
        |
        v
  [Cosine Sim]   Compare query vector vs. all stored vectors
        |
        v
  [Results]      Ranked note paths + similarity scores
```

The server reads `.smart-env/multi/*.ajson` files that Smart Connections generates inside your vault. Query encoding uses the same model (`TaylorAI/bge-micro-v2`) so vector spaces match.

## Prerequisites

- **Node.js** >= 18
- **Claude Code** CLI installed
- An **Obsidian vault** with the [Smart Connections](https://smartconnections.app/) plugin installed and embeddings generated (look for a `.smart-env/multi/` folder in your vault)

## Quick Start

```bash
git clone https://github.com/ekmungi/smart-search-mcp.git
cd smart-search-mcp
./setup.sh                        # auto-detects vault path
./setup.sh /path/to/your/vault    # or specify explicitly
```

The setup script installs dependencies, locates your vault, and registers the MCP server with Claude Code.

**Manual setup** (if you prefer):

```bash
npm install
claude mcp add -s user smart-search \
  -e OBSIDIAN_VAULT_PATH="/path/to/your/vault" \
  -- node /absolute/path/to/src/server.js
```

Verify with:

```bash
claude mcp list
# Should show: smart-search: ... - Connected
```

## MCP Tools

Once registered, three tools are available in Claude Code sessions:

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `semantic_search` | Find notes by meaning | `query` (string), `limit` (default 10), `threshold` (default 0.3) |
| `find_related` | Find notes similar to a given note | `note_path` (string), `limit` (default 10) |
| `vault_stats` | Check embedding health | none |

### Example Usage (in Claude Code)

```
> Search my vault for notes about project planning

Claude uses semantic_search("project planning") and returns:
  01 PROJECTS/App_Redesign/Planning_Notes.md  (score: 0.847)
  02 REFERENCE/Agile_Sprint_Templates.md      (score: 0.723)
  00 INBOX/Meeting_Notes_Q1_Kickoff.md        (score: 0.681)
```

### Score Interpretation

| Score Range | Meaning |
|-------------|---------|
| 0.7 -- 1.0 | Strong match |
| 0.5 -- 0.7 | Moderate match |
| 0.3 -- 0.5 | Weak match (included by default threshold) |
| Below 0.3 | Filtered out |

## Architecture

```
src/
  server.js          MCP server entry point, tool registration
  search.js          Orchestrator: semantic search, find related, stats
  ajson-parser.js    Parse Smart Connections .ajson embedding files
  embedder.js        Query encoding via @huggingface/transformers (ONNX)
  similarity.js      Cosine similarity computation
tests/
  server.test.js     13 tests
  search.test.js     24 tests
  ajson-parser.test.js  18 tests
  embedder.test.js   13 tests
  similarity.test.js 15 tests
```

83 tests total, 89% code coverage.

## Development

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

The embedder tests download the bge-micro-v2 model (~23 MB) on first run. Subsequent runs use the cached model.

## Dependencies

| Package | Purpose |
|---------|---------|
| [@huggingface/transformers](https://huggingface.co/docs/transformers.js) | ONNX model inference for query encoding |
| [@modelcontextprotocol/sdk](https://modelcontextprotocol.io/) | MCP server protocol |
| [zod](https://zod.dev/) | Schema validation for tool parameters |

## How Smart Connections Embeddings Work

The [Smart Connections](https://smartconnections.app/) Obsidian plugin pre-computes embeddings for every note and heading in your vault. It stores them as `.ajson` files in `.smart-env/multi/` (one file per note). Each file contains:

- **Source entries** (`smart_sources:`): One embedding for the entire note
- **Block entries** (`smart_blocks:`): One embedding per heading section

This server reads those files directly, so Obsidian does not need to be running. However, if you add or edit notes, you need to open Obsidian once so Smart Connections can re-index.

## Integration with Jeeves

This server is the Tier 1 search backend for the [Jeeves](https://github.com/ekmungi/jeeves) Claude Code plugin's `obsidian-knowledge` skill. When the MCP server is unavailable, the skill falls back to Tier 2 (filesystem Grep/Glob keyword search).

## License

MIT
