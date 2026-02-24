/**
 * License validator.
 * Makes a single lightweight HTTP call to the license server to validate
 * a license key and return the license tier + expiry.
 *
 * This is the ONLY place in the entire codebase that makes a network call
 * to external infrastructure. All artifact processing is 100% local.
 */

import { createHash } from 'node:crypto';
import { LicenseCache } from './license-cache.js';
import type { CachedLicense, LicenseTier } from './feature-gates.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LicenseValidationResult {
  valid: boolean;
  tier: LicenseTier;
  /** ISO 8601 expiry date */
  expiresAt: string;
  /** Consultant email associated with the license */
  email: string;
  /** Error message if validation failed */
  error?: string;
  /** True if validation used cached data (offline mode) */
  fromCache: boolean;
}

interface LicenseServerResponse {
  valid: boolean;
  tier: LicenseTier;
  expiresAt: string;
  email: string;
  /** JWT token containing signed license claims, stored in cache */
  token: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** License server base URL — replace with actual endpoint before distribution */
const LICENSE_SERVER_URL = process.env['BTLA_LICENSE_SERVER'] ?? 'https://license.biztalk-migrate.io';

/** How often to refresh the cached license (days) */
const REFRESH_INTERVAL_DAYS = 7;

/** Grace period for offline use after last successful validation (days) */
const OFFLINE_GRACE_DAYS = 30;

// ─── Validator ────────────────────────────────────────────────────────────────

export class LicenseValidator {
  private readonly cache: LicenseCache;

  constructor(cache: LicenseCache) {
    this.cache = cache;
  }

  /**
   * Validates a license key.
   * Order of operations:
   *   1. Check cache — if fresh (< REFRESH_INTERVAL_DAYS), return cached result.
   *   2. Attempt network validation — if successful, update cache.
   *   3. If network fails and cache is within grace period, use cached data.
   *   4. If cache is expired and network fails, deny access.
   */
  async validate(licenseKey: string): Promise<LicenseValidationResult> {
    const cached = await this.cache.read();

    // If we have a fresh cache for this key, use it without a network call
    if (cached && this.isCacheFresh(cached) && cached.keyHash === hashKey(licenseKey)) {
      return {
        valid: true,
        tier: cached.tier,
        expiresAt: cached.expiresAt,
        email: cached.email,
        fromCache: true,
      };
    }

    // Attempt network validation
    const networkResult = await this.validateWithServer(licenseKey);

    if (networkResult.success) {
      const { response } = networkResult;
      await this.cache.write({
        keyHash: hashKey(licenseKey),
        tier: response.tier,
        expiresAt: response.expiresAt,
        email: response.email,
        token: response.token,
        lastValidated: new Date().toISOString(),
      });
      return {
        valid: response.valid,
        tier: response.tier,
        expiresAt: response.expiresAt,
        email: response.email,
        fromCache: false,
      };
    }

    // Network failed — check if we can fall back to cache within grace period
    if (cached && cached.keyHash === hashKey(licenseKey) && this.isWithinGracePeriod(cached)) {
      return {
        valid: true,
        tier: cached.tier,
        expiresAt: cached.expiresAt,
        email: cached.email,
        fromCache: true,
        error: `Offline mode — last validated ${this.daysSince(cached.lastValidated)} day(s) ago`,
      };
    }

    // No valid cache and no network — deny
    return {
      valid: false,
      tier: 'none',
      expiresAt: '',
      email: '',
      fromCache: false,
      error: networkResult.error ?? 'License validation failed and no valid cached license found',
    };
  }

  private async validateWithServer(
    licenseKey: string
  ): Promise<{ success: true; response: LicenseServerResponse } | { success: false; error: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${LICENSE_SERVER_URL}/v1/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'biztalk-to-logicapps/0.1.0',
        },
        body: JSON.stringify({
          key: licenseKey,
          // Machine fingerprint helps detect key sharing — not PII, just entropy
          machineId: await getMachineFingerprint(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text();
        return { success: false, error: `License server returned ${response.status}: ${body}` };
      }

      const data = await response.json() as LicenseServerResponse;
      return { success: true, response: data };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, error: 'License server request timed out' };
      }
      return { success: false, error: `Network error during license validation: ${String(err)}` };
    }
  }

  private isCacheFresh(cached: CachedLicense): boolean {
    return this.daysSince(cached.lastValidated) < REFRESH_INTERVAL_DAYS;
  }

  private isWithinGracePeriod(cached: CachedLicense): boolean {
    return this.daysSince(cached.lastValidated) < OFFLINE_GRACE_DAYS;
  }

  private daysSince(isoDate: string): number {
    const diffMs = Date.now() - new Date(isoDate).getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** One-way hash of the license key for cache storage (never store the raw key) */
function hashKey(licenseKey: string): string {
  return createHash('sha256').update(licenseKey).digest('hex');
}

/**
 * Derives a stable machine fingerprint from OS properties.
 * Used only to detect license key sharing — not used for tracking.
 * Returns a consistent hash for the same machine.
 */
async function getMachineFingerprint(): Promise<string> {
  try {
    // Dynamic import — only runs during license validation network call
    const { machineIdSync } = await import('node-machine-id');
    const id = machineIdSync(true);
    return createHash('sha256').update(id).digest('hex').substring(0, 16);
  } catch {
    // If machine-id fails (e.g. CI environment), use a stable fallback
    return createHash('sha256').update(process.platform + process.arch).digest('hex').substring(0, 16);
  }
}
