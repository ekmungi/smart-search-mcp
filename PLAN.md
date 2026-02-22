# Implementation Plan: Smart Search MCP Server

## Context

Build a custom MCP server that provides semantic search over an Obsidian vault using pre-computed Smart Connections embeddings. Replaces dependency on community MCP servers (@yejianye, @msdanyg, @dan6684) with a self-maintained implementation.

Reference implementations studied:
- `@yejianye/ob-smart-connections-mcp` (JavaScript, @xenova/transformers, ~200 lines core)
- `@msdanyg/smart-connections-mcp` (TypeScript, knowledge graph features)
- `@dan6684/smart-connections-mcp` (Python, sentence-transformers)

Decision: DEC-019 in Jeeves project (tiered vault access architecture).

---

## Phase 1: Project Scaffolding

### 1.1 Initialize project
- [ ] `npm init` with project metadata
- [ ] Create `.gitignore` (node_modules, .cache, model cache)
- [ ] `git init` with initial commit
- [ ] Install dependencies:
  - `@xenova/transformers` ^2.17.2 (ONNX model inference for query encoding)
  - `@modelcontextprotocol/sdk` ^0.5.0 (MCP protocol layer)
- [ ] Install dev dependencies:
  - `vitest` (test framework)
  - `@vitest/coverage-v8` (coverage reporting)

### 1.2 Verify environment
- [ ] Confirm Node.js >= 18 available
- [ ] Confirm vault path accessible (set via `OBSIDIAN_VAULT_PATH` env var)
- [ ] Confirm `.smart-env/multi/` contains .ajson files
- [ ] Confirm `smart_env.json` readable and contains model config

---

## Phase 2: Core Implementation (TDD)

Build bottom-up: utilities first, then composition.

### 2.1 Cosine Similarity (`src/similarity.js`)

**Test first** (`tests/similarity.test.js`):
- Identical vectors return 1.0
- Orthogonal vectors return 0.0
- Opposite vectors return -1.0
- Mismatched lengths return 0
- Null/undefined inputs return 0
- Zero vectors return 0

**Implement**:
- `cosineSimilarity(vecA, vecB)` -> number (0 to 1, rounded to 3 decimals)
- Pure function, no dependencies

### 2.2 AJSON Parser (`src/ajson-parser.js`)

**Test first** (`tests/ajson-parser.test.js`):
- Parses single .ajson file with source entry
- Parses .ajson file with block entries (headings)
- Skips entries without embeddings
- Handles malformed .ajson gracefully (no throw)
- Extracts correct path from `smart_sources:` prefix
- Extracts correct vec array from nested embedding structure
- Loads all files from a multi/ directory

**Implement**:
- `parseAjsonFile(content)` -> Array<{path, vec, type}>
  - Wraps content in braces, strips trailing commas
  - Extracts path by removing `smart_sources:` or `smart_blocks:` prefix
  - Navigates to `embeddings["TaylorAI/bge-micro-v2"].vec`
  - Returns array of {path, vec, type: "source"|"block"}
- `loadEmbeddings(vaultPath)` -> Map<string, {vec, type}>
  - Reads all .ajson files from `.smart-env/multi/`
  - Calls `parseAjsonFile` for each
  - Returns a Map keyed by note path

**Data format reference** (from actual vault):
```
"smart_sources:00 INBOX/20260216 - Claude Code Setup.md": {
  "path": "00 INBOX/20260216 - Claude Code Setup.md",
  "embeddings": {
    "TaylorAI/bge-micro-v2": {
      "vec": [-0.059, 0.001, -0.042, ... ] // 384 floats
    }
  }
}
```

### 2.3 Embedder (`src/embedder.js`)

**Test first** (`tests/embedder.test.js`):
- Encodes a simple query string into a 384-dim vector
- Returns normalized vector (magnitude ~1.0)
- Handles empty string gracefully
- Validates output dimensions match expected (384)
- Model ID matches vault config (TaylorAI/bge-micro-v2)

**Implement**:
- `createEmbedder(modelId?)` -> Embedder instance
  - Defaults to "TaylorAI/bge-micro-v2"
  - Loads the model via `@xenova/transformers` pipeline('feature-extraction', modelId)
  - Uses quantized model for performance
  - Returns an object with `encode(text)` method
- `encode(text)` -> Float32Array (384 dimensions)
  - Validates input (non-empty, <= 2000 chars)
  - Runs the pipeline with mean pooling + normalization
  - Returns the embedding vector

**Note**: First call downloads the model (~23MB ONNX). Subsequent calls use local cache. The MCP server staying warm means this only happens once per session.

### 2.4 Search Orchestrator (`src/search.js`)

**Test first** (`tests/search.test.js`):
- `semanticSearch` returns results sorted by descending score
- `semanticSearch` respects limit parameter
- `semanticSearch` filters by threshold
- `findRelated` returns similar notes for a given path
- `findRelated` excludes the source note from results
- `getStats` returns correct counts

**Implement**:
- `semanticSearch(query, embeddings, embedder, options)` -> Array<{path, score}>
  - Encode query via embedder
  - Compute cosine similarity against all embeddings
  - Filter by threshold, sort by score, limit results
- `findRelated(notePath, embeddings, options)` -> Array<{path, score}>
  - Look up the note's embedding from the Map
  - Compute similarity against all other embeddings
  - Exclude self, filter, sort, limit
- `getStats(embeddings)` -> {totalNotes, totalBlocks, dimensions, modelId}

---

## Phase 3: MCP Server

### 3.1 Server Entry Point (`src/server.js`)

**Test first** (`tests/server.test.js`):
- Server initializes without error
- Reads OBSIDIAN_VAULT_PATH from environment
- Registers 3 tools: semantic_search, find_related, vault_stats
- semantic_search tool returns expected schema
- find_related tool returns expected schema
- vault_stats tool returns expected schema
- Graceful error when vault path not set
- Graceful error when .smart-env not found

**Implement**:
- Read `OBSIDIAN_VAULT_PATH` from env
- Load embeddings via `loadEmbeddings(vaultPath)` on startup
- Initialize embedder via `createEmbedder()`
- Register MCP tools:
  - `semantic_search`: calls `semanticSearch()`
  - `find_related`: calls `findRelated()`
  - `vault_stats`: calls `getStats()`
- Use MCP SDK's `Server` class with stdio transport
- Handle errors gracefully (return error messages, don't crash)

### 3.2 Registration and Smoke Test
- [ ] Register with Claude Code: `claude mcp add smart-search ...`
- [ ] Verify `claude mcp list` shows the server
- [ ] Test `semantic_search` with a real query
- [ ] Test `find_related` with a known note path
- [ ] Test `vault_stats` returns correct counts (~111 notes)

---

## Phase 4: Integration with Jeeves

### 4.1 Update obsidian-knowledge skill
- [ ] Update Tier 1 tool names in `skills/obsidian-knowledge/SKILL.md`
- [ ] Set primary tool names to: `semantic_search`, `find_related`, `vault_stats`
- [ ] Remove references to community server tool names (connection, lookup, get_similar_notes, etc.)
- [ ] Update troubleshooting table

### 4.2 Update Jeeves project documentation
- [ ] Update DEC-019 status in decisions.md
- [ ] Update plan.md Phase 3 milestone
- [ ] Update MEMORY.md with MCP server info

---

## Phase 5: Future Enhancements (Backlog)

Not in scope for initial build. Tracked here for reference:

- [ ] Tag-aware search (filter by #tags or frontmatter properties)
- [ ] Folder-scoped search (restrict to specific vault sections)
- [ ] Content retrieval tool (return note text, not just paths)
- [ ] Block-level search (search within headings, not just whole notes)
- [ ] Auto-reload embeddings when .ajson files change (file watcher)
- [ ] Embedding health check (detect stale/missing embeddings)
- [ ] Multiple vault support (personal + enterprise)

---

## Dependencies Summary

| Package | Version | Purpose | Maintained By |
|---------|---------|---------|---------------|
| @xenova/transformers | ^2.17.2 | ONNX model inference for query encoding | Hugging Face |
| @modelcontextprotocol/sdk | ^0.5.0 | MCP protocol layer | Anthropic |
| vitest | latest | Test framework | Community (very active) |
| @vitest/coverage-v8 | latest | Coverage reporting | Community |

---

## Success Criteria

- [ ] All 3 MCP tools functional (semantic_search, find_related, vault_stats)
- [ ] Test coverage >= 80%
- [ ] Cold start (first query with model download) < 30s
- [ ] Warm query response < 2s for 111-note vault
- [ ] Registered in Claude Code and accessible to agents
- [ ] Jeeves obsidian-knowledge skill uses it as Tier 1
- [ ] Graceful fallback when vault unavailable
