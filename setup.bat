@echo off
REM One-click setup: install deps, register MCP server with Claude Code, verify.
REM Usage: setup.bat [vault_path]
REM   vault_path: Obsidian vault root (default: auto-detect common locations)

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
REM Remove trailing backslash
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "SERVER_ENTRY=%SCRIPT_DIR%\src\server.js"

echo Smart Search MCP Server - Setup
echo ================================

REM -- 1. Check prerequisites ---------------------------------------------------

echo.
echo [1/4] Checking prerequisites...

where node >nul 2>&1
if errorlevel 1 (
    echo Error: Node.js is required. Install from https://nodejs.org/
    exit /b 1
)

where claude >nul 2>&1
if errorlevel 1 (
    echo Error: Claude Code CLI is required. Install from https://claude.ai/claude-code
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do echo   Node.js %%v
for /f "tokens=*" %%v in ('npm --version') do echo   npm %%v
echo   Claude Code CLI found

REM -- 2. Install dependencies --------------------------------------------------

echo.
echo [2/4] Installing dependencies...
cd /d "%SCRIPT_DIR%"
npm install --production
if errorlevel 1 (
    echo Error: npm install failed.
    exit /b 1
)

REM -- 3. Resolve vault path ----------------------------------------------------

echo.
echo [3/4] Locating Obsidian vault...

set "VAULT_PATH="

REM Use provided argument if given
if not "%~1"=="" (
    if exist "%~1\.smart-env\multi" (
        set "VAULT_PATH=%~1"
    ) else (
        echo Error: No .smart-env\multi\ directory found in %~1
        echo Run Smart Connections in Obsidian first to generate embeddings.
        exit /b 1
    )
)

REM Auto-detect common vault locations
if not defined VAULT_PATH (
    if exist "%USERPROFILE%\Obsidian_Vault\.smart-env\multi" (
        set "VAULT_PATH=%USERPROFILE%\Obsidian_Vault"
    )
)
if not defined VAULT_PATH (
    if exist "%USERPROFILE%\OneDrive\Obsidian_Vault\.smart-env\multi" (
        set "VAULT_PATH=%USERPROFILE%\OneDrive\Obsidian_Vault"
    )
)
if not defined VAULT_PATH (
    if exist "%USERPROFILE%\Documents\Obsidian_Vault\.smart-env\multi" (
        set "VAULT_PATH=%USERPROFILE%\Documents\Obsidian_Vault"
    )
)

if not defined VAULT_PATH (
    echo Error: Could not auto-detect vault path. Pass it as an argument:
    echo   setup.bat C:\path\to\your\obsidian\vault
    exit /b 1
)

echo   Vault: %VAULT_PATH%

REM -- 4. Register with Claude Code ---------------------------------------------

echo.
echo [4/4] Registering MCP server with Claude Code...

REM Remove existing registration if present (idempotent)
claude mcp remove smart-search >nul 2>&1

claude mcp add -s user smart-search -e OBSIDIAN_VAULT_PATH="%VAULT_PATH%" -- node "%SERVER_ENTRY%"
if errorlevel 1 (
    echo Error: Failed to register MCP server with Claude Code.
    exit /b 1
)

echo.
echo ================================
echo Setup complete!
echo.
echo The 'smart-search' MCP server is now registered with Claude Code.
echo Start a new Claude Code session to use these tools:
echo   - semantic_search: Find notes by meaning
echo   - find_related:    Find similar notes
echo   - vault_stats:     Check embedding health
echo   - read_note:       Read note content
echo.
echo To verify: claude mcp list

endlocal
