// Tests for the note reader module (src/reader.js).
// Covers path extraction, path safety validation, and file reading with truncation.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { extractNotePath, isPathSafe, readNote } from '../src/reader.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// extractNotePath
// ---------------------------------------------------------------------------

describe('extractNotePath', () => {
  it('returns the path unchanged when there is no fragment', () => {
    expect(extractNotePath('notes/alpha.md')).toBe('notes/alpha.md');
  });

  it('strips the fragment from a block path', () => {
    expect(extractNotePath('notes/alpha.md#Section')).toBe('notes/alpha.md');
  });

  it('strips only the first fragment when multiple # appear', () => {
    expect(extractNotePath('notes/alpha.md#Heading#Sub')).toBe('notes/alpha.md');
  });

  it('handles paths without a directory component', () => {
    expect(extractNotePath('README.md#Overview')).toBe('README.md');
  });
});

// ---------------------------------------------------------------------------
// isPathSafe
// ---------------------------------------------------------------------------

describe('isPathSafe', () => {
  // Use a stable vault path for safety checks.
  const vaultPath = '/home/user/vault';

  it('returns true for a simple path inside the vault', () => {
    expect(isPathSafe('notes/alpha.md', vaultPath)).toBe(true);
  });

  it('returns false for a path with ../ traversal', () => {
    expect(isPathSafe('../etc/passwd', vaultPath)).toBe(false);
  });

  it('returns false for a nested traversal attempt', () => {
    expect(isPathSafe('notes/../../etc/passwd', vaultPath)).toBe(false);
  });

  it('returns false for an absolute path outside the vault', () => {
    expect(isPathSafe('/etc/passwd', vaultPath)).toBe(false);
  });

  it('returns true for a deeply nested path inside the vault', () => {
    expect(isPathSafe('a/b/c/d/e/note.md', vaultPath)).toBe(true);
  });

  it('returns false for a Windows-style absolute path outside the vault', () => {
    // On any OS, an absolute path that doesn't resolve inside vault should fail.
    expect(isPathSafe('C:\\Windows\\System32\\config', vaultPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readNote (integration tests using temp directory)
// ---------------------------------------------------------------------------

describe('readNote', () => {
  let tmpVault;

  beforeAll(() => {
    // Create a temporary vault directory with test files.
    tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-search-reader-'));
    fs.mkdirSync(path.join(tmpVault, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(tmpVault, 'notes', 'hello.md'), 'Hello world!');
    fs.writeFileSync(path.join(tmpVault, 'notes', 'spaces in name.md'), 'Spaced content');
    // Large file for truncation tests (12,000 chars).
    fs.writeFileSync(path.join(tmpVault, 'notes', 'large.md'), 'x'.repeat(12000));
    // Exact boundary file (10,000 chars).
    fs.writeFileSync(path.join(tmpVault, 'notes', 'boundary.md'), 'y'.repeat(10000));
  });

  afterAll(() => {
    // Clean up the temp vault.
    fs.rmSync(tmpVault, { recursive: true, force: true });
  });

  it('reads note content successfully', async () => {
    const result = await readNote('notes/hello.md', tmpVault);

    expect(result.content).toBe('Hello world!');
    expect(result.truncated).toBe(false);
  });

  it('strips block fragment before reading', async () => {
    const result = await readNote('notes/hello.md#SomeHeading', tmpVault);

    expect(result.content).toBe('Hello world!');
    expect(result.truncated).toBe(false);
  });

  it('truncates files exceeding 10,000 characters', async () => {
    const result = await readNote('notes/large.md', tmpVault);

    expect(result.content).toHaveLength(10000);
    expect(result.truncated).toBe(true);
  });

  it('does not truncate files at exactly 10,000 characters', async () => {
    const result = await readNote('notes/boundary.md', tmpVault);

    expect(result.content).toHaveLength(10000);
    expect(result.truncated).toBe(false);
  });

  it('throws on path traversal attempts', async () => {
    await expect(readNote('../etc/passwd', tmpVault)).rejects.toThrow(
      /outside the vault/
    );
  });

  it('throws when file does not exist', async () => {
    await expect(readNote('notes/missing.md', tmpVault)).rejects.toThrow();
  });

  it('handles spaces in file paths', async () => {
    const result = await readNote('notes/spaces in name.md', tmpVault);

    expect(result.content).toBe('Spaced content');
    expect(result.truncated).toBe(false);
  });
});
