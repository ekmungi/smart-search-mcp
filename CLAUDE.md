# Smart Search MCP Server

## Project Overview

A lightweight MCP (Model Context Protocol) server that provides semantic search over Obsidian vaults using pre-computed Smart Connections embeddings. Reads the `.smart-env/` directory directly -- does not require Obsidian to be running.

Built for use with Claude Code. Registered via `claude mcp add` and consumed as a semantic search backend by any MCP-compatible client.

## Architecture

```
Query ("project kickoff meeting notes")
  |
  v
[Embedder] Encode query -> 384-dim vector via bge-micro-v2 (ONNX)
  |
  v
[AJSON Parser] Load pre-computed note embeddings from .smart-env/multi/*.ajson
  |
  v
[Similarity] Cosine similarity: query vector vs. all stored vectors
  |
  v
[Ranker] Sort by score, consolidate blocks to headings, return top-N
  |
  v
MCP Response (tool result with ranked note paths + scores)
```

## Key Design Decisions

- **Reads .smart-env directly**: No dependency on Obsidian running. Embeddings are pre-computed by the Smart Connections plugin.
- **Same model (bge-micro-v2)**: Query encoding uses the identical model that produced the stored embeddings. Vector spaces must match.
- **MCP over CLI**: Server stays warm, model loads once. CLI would cold-start (~1-2s) every invocation.
- **Standalone server**: This is a Node.js application with a clean MCP interface boundary. Any MCP client can consume it.

## Environment

- **Runtime**: Node.js >= 18
- **Package manager**: npm
- **Key dependencies**: `@huggingface/transformers` (ONNX model inference), `@modelcontextprotocol/sdk` (MCP protocol), `zod` (schema validation)
- **Target vault**: Set via `OBSIDIAN_VAULT_PATH` environment variable (any Obsidian vault with Smart Connections enabled)
- **Embedding model**: TaylorAI/bge-micro-v2 (384 dimensions, max 512 tokens)
- **Data format**: AJSON files in `.smart-env/multi/` (one per note, contains path + embedding vectors)

## MCP Tools Exposed

| Tool | Purpose | Parameters |
|------|---------|------------|
| `semantic_search` | Find notes by meaning | `query` (string), `limit` (number, default 10), `threshold` (number, default 0.3), `type` ("source" or "block", optional), `folder` (string, optional) |
| `find_related` | Find notes similar to a given note | `note_path` (string), `limit` (number, default 10), `type` ("source" or "block", optional) |
| `vault_stats` | Embedding health check | none |
| `read_note` | Read note content by path | `note_path` (string, max 500 chars) |

## File Structure

```
smart-search-mcp/
  CLAUDE.md              # This file (project instructions)
  package.json           # Dependencies and scripts
  src/
    server.js            # MCP server entry point (~200 lines)
    search.js            # Search orchestrator: semantic search, find related, stats (~130 lines)
    reader.js            # Note reader: path extraction, safety validation, file reading (~75 lines)
    ajson-parser.js      # Parse .smart-env/multi/*.ajson files (~170 lines)
    embedder.js          # Query encoding via @huggingface/transformers (~95 lines)
    similarity.js        # Cosine similarity computation (~45 lines)
  tests/
    server.test.js
    search.test.js
    reader.test.js
    ajson-parser.test.js
    embedder.test.js
    similarity.test.js
  .gitignore
```

## Conventions

- Target 200 lines per file, 400 hard max
- Every function gets a docstring
- Every file gets a header comment
- No emojis
- Immutable data patterns
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`
- TDD: write tests first
- 80%+ test coverage

## Installation

One-click setup on any machine:

```bash
# macOS / Linux
./setup.sh                    # auto-detects vault path
./setup.sh /path/to/vault     # or specify explicitly

# Windows
setup.bat                              REM auto-detects vault path
setup.bat C:\path\to\vault             REM or specify explicitly
```

Both scripts: install deps, locate the Obsidian vault, and register the MCP server with Claude Code at the user level.

**Manual registration** (if needed):

```bash
npm install
claude mcp add -s user smart-search -e OBSIDIAN_VAULT_PATH="/path/to/vault" -- node /path/to/src/server.js
```

