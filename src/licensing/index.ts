/**
 * Licensing module barrel + convenience wrappers.
 *
 * handler.ts, server.ts, and cli/index.ts use free functions:
 *   validateLicense(key)   — validate and update current tier
 *   getLicenseTier()       — read the current tier
 *   isFeatureAvailable(f)  — check if a feature is accessible
 *
 * The underlying implementation uses classes (LicenseValidator, FeatureGates).
 * This module bridges the two by holding module-level tier state and
 * mapping short-form feature names to canonical FeatureFlags keys.
 */

import { LicenseValidator }      from './license-validator.js';
import { LicenseCache }          from './license-cache.js';
import { FeatureGates }          from './feature-gates.js';
import type { LicenseTier, FeatureFlags } from './feature-gates.js';

export { LicenseValidator, LicenseCache, FeatureGates };
export type { LicenseTier, FeatureFlags };
export type { LicenseValidationResult } from './license-validator.js';
export type { CachedLicense } from './feature-gates.js';
export { FeatureGateError } from './feature-gates.js';

// ─── Module-Level Tier State ──────────────────────────────────────────────────

/** Current license tier, updated by validateLicense() on startup */
let _currentTier: LicenseTier = 'free';

/** Returns the current license tier (set after validateLicense resolves). */
export function getLicenseTier(): LicenseTier {
  return _currentTier;
}

/** Manually override the current tier (used in tests and extension startup). */
export function setCurrentTier(tier: LicenseTier): void {
  _currentTier = tier;
}

// ─── Convenience Wrappers ─────────────────────────────────────────────────────

/**
 * Validates a license key, updates the module-level tier, and returns the result.
 * This is the ONLY network call in the entire codebase.
 */
export async function validateLicense(key: string) {
  const cache     = new LicenseCache();
  const validator = new LicenseValidator(cache);
  const result    = await validator.validate(key);
  if (result.valid) {
    _currentTier = result.tier;
  }
  return result;
}

// ─── Feature Gate Convenience ─────────────────────────────────────────────────

/**
 * Short-form → canonical FeatureFlags key mapping.
 * handler.ts uses 'build' and 'greenfield' as short-form names.
 */
const FEATURE_ALIASES: Record<string, keyof FeatureFlags> = {
  build:      'buildPackage',
  greenfield: 'nlpCreateWorkflow',
};

/**
 * Returns true if the given feature is available at the current license tier.
 * Accepts either a full FeatureFlags key name or a short alias ('build', 'greenfield').
 */
export function isFeatureAvailable(feature: string): boolean {
  const gates = new FeatureGates(_currentTier);
  const key   = (FEATURE_ALIASES[feature] ?? feature) as keyof FeatureFlags;
  try {
    return gates.isEnabled(key);
  } catch {
    return false;
  }
}
