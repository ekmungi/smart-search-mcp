#!/usr/bin/env bash
# One-click setup: install deps, register MCP server with Claude Code, verify.
# Usage: ./setup.sh [vault_path]
#   vault_path: Obsidian vault root (default: auto-detect common locations)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ENTRY="$SCRIPT_DIR/src/server.js"

# -- Resolve vault path -------------------------------------------------------

resolve_vault_path() {
  local provided="$1"

  if [ -n "$provided" ]; then
    if [ -d "$provided/.smart-env/multi" ]; then
      echo "$provided"
      return 0
    fi
    echo "Error: No .smart-env/multi/ directory found in $provided" >&2
    echo "Run Smart Connections in Obsidian first to generate embeddings." >&2
    return 1
  fi

  # Auto-detect common vault locations
  local candidates=(
    "$HOME/Obsidian_Vault"
    "$HOME/OneDrive/Obsidian_Vault"
    "$HOME/Documents/Obsidian_Vault"
  )

  for candidate in "${candidates[@]}"; do
    if [ -d "$candidate/.smart-env/multi" ]; then
      echo "$candidate"
      return 0
    fi
  done

  echo "Error: Could not auto-detect vault path. Pass it as an argument:" >&2
  echo "  ./setup.sh /path/to/your/obsidian/vault" >&2
  return 1
}

# -- Main ----------------------------------------------------------------------

echo "Smart Search MCP Server - Setup"
echo "================================"

# 1. Check prerequisites
echo ""
echo "[1/4] Checking prerequisites..."
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is required. Install from https://nodejs.org/" >&2
  exit 1
fi
if ! command -v claude &>/dev/null; then
  echo "Error: Claude Code CLI is required. Install from https://claude.ai/claude-code" >&2
  exit 1
fi
echo "  Node.js $(node --version)"
echo "  npm $(npm --version)"
echo "  Claude Code CLI found"

# 2. Install dependencies
echo ""
echo "[2/4] Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --production 2>&1 | tail -1

# 3. Resolve vault path
echo ""
echo "[3/4] Locating Obsidian vault..."
VAULT_PATH=$(resolve_vault_path "${1:-}")
echo "  Vault: $VAULT_PATH"

# Convert to native path for env var (Windows needs backslashes in some contexts)
VAULT_PATH_NATIVE="$VAULT_PATH"

# 4. Register with Claude Code
echo ""
echo "[4/4] Registering MCP server with Claude Code..."

# Remove existing registration if present (idempotent)
claude mcp remove smart-search 2>/dev/null || true

claude mcp add -s user smart-search \
  -e OBSIDIAN_VAULT_PATH="$VAULT_PATH_NATIVE" \
  -- node "$SERVER_ENTRY"

echo ""
echo "================================"
echo "Setup complete!"
echo ""
echo "The 'smart-search' MCP server is now registered with Claude Code."
echo "Start a new Claude Code session to use these tools:"
echo "  - semantic_search: Find notes by meaning"
echo "  - find_related:    Find similar notes"
echo "  - vault_stats:     Check embedding health"
echo ""
echo "To verify: claude mcp list"
