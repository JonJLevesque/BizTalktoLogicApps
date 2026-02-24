/**
 * License cache.
 * Stores the license validation result locally so the tool works offline
 * for up to 30 days after the last successful validation.
 *
 * Cache file is stored in the user's home directory:
 *   ~/.btla/.license-cache
 *
 * The cached data is AES-256-GCM encrypted using a key derived from the
 * machine ID — this prevents the cache file from being copied to another
 * machine to bypass the machine fingerprint check in the validator.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { CachedLicense } from './feature-gates.js';

const CACHE_DIR = join(homedir(), '.btla');
const CACHE_FILE = join(CACHE_DIR, '.license-cache');
const ENCRYPTION_SALT = 'btla-license-cache-v1';

export class LicenseCache {
  /**
   * Reads the cached license. Returns null if no cache exists or if the
   * cache is corrupt / cannot be decrypted.
   */
  async read(): Promise<CachedLicense | null> {
    if (!existsSync(CACHE_FILE)) {
      return null;
    }
    try {
      const raw = await readFile(CACHE_FILE);
      const decrypted = await this.decrypt(raw);
      const parsed = JSON.parse(decrypted) as unknown;
      if (!isValidCachedLicense(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      // Corrupt or unreadable cache — treat as missing
      return null;
    }
  }

  /**
   * Writes a license to the cache. Creates the cache directory if needed.
   */
  async write(license: CachedLicense): Promise<void> {
    if (!existsSync(CACHE_DIR)) {
      await mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
    }
    const json = JSON.stringify(license);
    const encrypted = await this.encrypt(json);
    await writeFile(CACHE_FILE, encrypted, { mode: 0o600 });
  }

  /**
   * Clears the license cache (e.g. on license key change or explicit logout).
   */
  async clear(): Promise<void> {
    if (existsSync(CACHE_FILE)) {
      const { unlink } = await import('node:fs/promises');
      await unlink(CACHE_FILE);
    }
  }

  // ─── Encryption ─────────────────────────────────────────────────────────────

  private async getEncryptionKey(): Promise<Buffer> {
    const machineId = await getMachineId();
    // scrypt KDF: deterministic key from machine ID + salt
    return scryptSync(machineId, ENCRYPTION_SALT, 32) as Buffer;
  }

  private async encrypt(plaintext: string): Promise<Buffer> {
    const key = await this.getEncryptionKey();
    const iv = randomBytes(12); // 96-bit IV for GCM
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // Layout: [iv (12 bytes)][authTag (16 bytes)][ciphertext]
    return Buffer.concat([iv, authTag, encrypted]);
  }

  private async decrypt(data: Buffer): Promise<string> {
    const key = await this.getEncryptionKey();
    const iv = data.subarray(0, 12);
    const authTag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getMachineId(): Promise<string> {
  try {
    const { machineIdSync } = await import('node-machine-id');
    return machineIdSync(true);
  } catch {
    return `${process.platform}-${process.arch}-${process.env['COMPUTERNAME'] ?? 'unknown'}`;
  }
}

function isValidCachedLicense(value: unknown): value is CachedLicense {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['keyHash'] === 'string' &&
    typeof obj['tier'] === 'string' &&
    typeof obj['expiresAt'] === 'string' &&
    typeof obj['email'] === 'string' &&
    typeof obj['token'] === 'string' &&
    typeof obj['lastValidated'] === 'string'
  );
}
