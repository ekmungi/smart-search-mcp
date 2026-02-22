// Note reader: extracts file paths from block references, validates path safety,
// and reads note content from the vault with truncation for large files.

import fs from 'fs/promises';
import path from 'path';

// Maximum characters returned from a note. Files exceeding this are truncated.
const MAX_CONTENT_LENGTH = 10000;

/**
 * Extract the file path from a Smart Connections entry path.
 *
 * Block paths include a '#' fragment (e.g. "notes/alpha.md#Heading").
 * This function strips the fragment to yield the underlying file path.
 *
 * @param {string} notePath - Vault-relative note or block path.
 * @returns {string} The file path without any '#' fragment.
 */
export function extractNotePath(notePath) {
  const hashIndex = notePath.indexOf('#');
  if (hashIndex === -1) {
    return notePath;
  }
  return notePath.slice(0, hashIndex);
}

/**
 * Check whether a vault-relative note path resolves to a location inside the vault.
 *
 * Prevents path traversal attacks (e.g. "../../etc/passwd") by resolving the
 * full path and verifying it starts with the vault directory.
 *
 * @param {string} notePath - Vault-relative note path to validate.
 * @param {string} vaultPath - Absolute path to the vault root.
 * @returns {boolean} True if the resolved path is inside the vault.
 */
export function isPathSafe(notePath, vaultPath) {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedNote = path.resolve(vaultPath, notePath);
  // Append separator to prevent prefix false positives (e.g. "/vault-backup" matching "/vault").
  return resolvedNote.startsWith(resolvedVault + path.sep) || resolvedNote === resolvedVault;
}

/**
 * Read the content of a vault note, with path safety checks and truncation.
 *
 * Strips any block fragment from the path, validates that the resolved path
 * stays inside the vault, reads the file, and truncates content exceeding
 * MAX_CONTENT_LENGTH characters.
 *
 * @param {string} notePath - Vault-relative note or block path.
 * @param {string} vaultPath - Absolute path to the vault root.
 * @returns {Promise<{content: string, truncated: boolean}>} File content and truncation flag.
 * @throws {Error} If the path is outside the vault or the file cannot be read.
 */
export async function readNote(notePath, vaultPath) {
  const filePath = extractNotePath(notePath);

  if (!isPathSafe(filePath, vaultPath)) {
    throw new Error(`Path "${filePath}" resolves outside the vault`);
  }

  const fullPath = path.resolve(vaultPath, filePath);
  const raw = await fs.readFile(fullPath, 'utf-8');

  if (raw.length > MAX_CONTENT_LENGTH) {
    return { content: raw.slice(0, MAX_CONTENT_LENGTH), truncated: true };
  }

  return { content: raw, truncated: false };
}
