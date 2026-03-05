/**
 * MSI Extractor — Extract BizTalk MSI packages for migration
 *
 * When customers only have deployed BizTalk MSI packages (no source control),
 * this module extracts the MSI to a temporary directory so the normal
 * migration pipeline can be run against the extracted contents.
 *
 * Requires 7-Zip to be installed:
 *   macOS/Linux: brew install p7zip | apt install p7zip-full
 *   Windows:     choco install 7zip | winget install 7zip.7zip
 */

import { execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface MsiExtractionResult {
  /** Absolute path to the directory containing extracted BizTalk artifacts */
  extractedDir: string;
  /** Call this when done to remove the temp directory */
  cleanup: () => void;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract a BizTalk MSI package to a temporary directory.
 *
 * @param msiPath - Absolute or relative path to the .msi file
 * @returns Extraction result with the temp dir path and a cleanup function
 * @throws If the file does not exist, 7z is not installed, or extraction fails
 */
export function extractMsi(msiPath: string): MsiExtractionResult {
  // Validate file exists
  if (!existsSync(msiPath)) {
    throw new Error(`MSI file not found: ${msiPath}`);
  }

  // Check 7z is available
  check7zInstalled();

  // Create a unique temp directory
  const tempDir = mkdtempSync(join(tmpdir(), 'btla-msi-'));

  try {
    // Extract the MSI — 7z treats MSI as a cabinet-format archive
    execSync(`7z x "${msiPath}" -o"${tempDir}" -y`, { stdio: 'pipe' });
  } catch (err) {
    // Clean up on extraction failure
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw new Error(
      `MSI extraction failed: ${err instanceof Error ? err.message : String(err)}\n` +
      `Ensure the file is a valid BizTalk MSI package and 7z has read access.`
    );
  }

  return {
    extractedDir: tempDir,
    cleanup: () => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Non-fatal — temp files will be cleaned up by OS eventually
      }
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Verify 7z is on PATH. Throws a descriptive install-instructions error if not.
 */
export function check7zInstalled(): void {
  try {
    execSync('7z --help', { stdio: 'pipe' });
  } catch {
    throw new Error(
      '7-Zip (7z) is required for MSI extraction but was not found on PATH.\n' +
      '\n' +
      'Install instructions:\n' +
      '  macOS:   brew install p7zip\n' +
      '  Ubuntu:  sudo apt install p7zip-full\n' +
      '  Windows: choco install 7zip\n' +
      '           — or —\n' +
      '           winget install 7zip.7zip\n' +
      '\n' +
      'After installing, restart your terminal and try again.'
    );
  }
}
