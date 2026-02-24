/**
 * Feature gates — controls which features are accessible at each license tier.
 *
 * Tier hierarchy: none < free < standard < premium
 *
 * Free:     Stage 1 (Understand) + Stage 2 (Document) only
 * Standard: Full migration pipeline + deployment tools
 * Premium:  Standard + NLP Greenfield Builder + template library
 */

// ─── License Tier ─────────────────────────────────────────────────────────────

export type LicenseTier = 'none' | 'free' | 'standard' | 'premium';

/** Numeric tier level for comparison (higher = more features) */
const TIER_LEVEL: Record<LicenseTier, number> = {
  none: 0,
  free: 1,
  standard: 2,
  premium: 3,
};

function hasAtLeast(actual: LicenseTier, required: LicenseTier): boolean {
  return TIER_LEVEL[actual] >= TIER_LEVEL[required];
}

// ─── Cached License (stored by LicenseCache) ─────────────────────────────────

export interface CachedLicense {
  /** SHA-256 hash of the raw license key (never store the key itself) */
  keyHash: string;
  tier: LicenseTier;
  expiresAt: string;
  email: string;
  /** Signed JWT from the license server for integrity verification */
  token: string;
  /** ISO 8601 timestamp of the last successful validation */
  lastValidated: string;
}

// ─── Feature Flags ────────────────────────────────────────────────────────────

export interface FeatureFlags {
  // Stage 1: Understand
  analyzeOrchestration: boolean;
  analyzeMap: boolean;
  analyzePipeline: boolean;
  analyzeBindings: boolean;
  detectPatterns: boolean;
  assessComplexity: boolean;

  // Stage 2: Document
  generateMigrationSpec: boolean;
  generateGapAnalysis: boolean;
  generateArchitectureRecommendation: boolean;

  // Stage 3: Build (migration) — Standard+
  generateWorkflow: boolean;
  convertMap: boolean;
  generateConnections: boolean;
  generateInfrastructure: boolean;
  generateTests: boolean;
  buildPackage: boolean;
  batchProcessing: boolean;
  deploymentTools: boolean;

  // Greenfield NLP — Premium only
  nlpCreateWorkflow: boolean;
  nlpRefineWorkflow: boolean;
  nlpInferSchema: boolean;
  nlpRecommendConnectors: boolean;
  nlpTemplateLibrary: boolean;
  nlpDesignArchitecture: boolean;
}

// ─── Gate Registry ────────────────────────────────────────────────────────────

const FEATURE_TIERS: Record<keyof FeatureFlags, LicenseTier> = {
  // Free tier
  analyzeOrchestration: 'free',
  analyzeMap: 'free',
  analyzePipeline: 'free',
  analyzeBindings: 'free',
  detectPatterns: 'free',
  assessComplexity: 'free',
  generateMigrationSpec: 'free',
  generateGapAnalysis: 'free',
  generateArchitectureRecommendation: 'free',

  // Standard tier
  generateWorkflow: 'standard',
  convertMap: 'standard',
  generateConnections: 'standard',
  generateInfrastructure: 'standard',
  generateTests: 'standard',
  buildPackage: 'standard',
  batchProcessing: 'standard',
  deploymentTools: 'standard',

  // Premium tier
  nlpCreateWorkflow: 'premium',
  nlpRefineWorkflow: 'premium',
  nlpInferSchema: 'premium',
  nlpRecommendConnectors: 'premium',
  nlpTemplateLibrary: 'premium',
  nlpDesignArchitecture: 'premium',
};

// ─── Feature Gates ────────────────────────────────────────────────────────────

export class FeatureGates {
  private readonly tier: LicenseTier;

  constructor(tier: LicenseTier) {
    this.tier = tier;
  }

  /** Returns true if the given feature is accessible at the current license tier */
  isEnabled(feature: keyof FeatureFlags): boolean {
    const requiredTier = FEATURE_TIERS[feature];
    return hasAtLeast(this.tier, requiredTier);
  }

  /**
   * Asserts that a feature is enabled.
   * Throws a descriptive FeatureGateError if the feature is not available.
   */
  require(feature: keyof FeatureFlags): void {
    if (!this.isEnabled(feature)) {
      const required = FEATURE_TIERS[feature];
      throw new FeatureGateError(feature, this.tier, required);
    }
  }

  /** Returns the full set of feature flags for the current tier */
  getFlags(): FeatureFlags {
    const flags = {} as FeatureFlags;
    for (const [feature, requiredTier] of Object.entries(FEATURE_TIERS)) {
      (flags as unknown as Record<string, boolean>)[feature] = hasAtLeast(this.tier, requiredTier);
    }
    return flags;
  }

  /** Returns the current license tier */
  getTier(): LicenseTier {
    return this.tier;
  }

  /** Creates a FeatureGates instance for testing with all features enabled */
  static allEnabled(): FeatureGates {
    return new FeatureGates('premium');
  }

  /** Creates a FeatureGates instance for the free tier */
  static freeOnly(): FeatureGates {
    return new FeatureGates('free');
  }
}

// ─── Error Type ───────────────────────────────────────────────────────────────

export class FeatureGateError extends Error {
  readonly feature: keyof FeatureFlags;
  readonly currentTier: LicenseTier;
  readonly requiredTier: LicenseTier;

  constructor(feature: keyof FeatureFlags, currentTier: LicenseTier, requiredTier: LicenseTier) {
    super(
      `Feature "${feature}" requires a ${requiredTier} license. ` +
      `Current license tier: ${currentTier === 'none' ? 'unlicensed' : currentTier}. ` +
      `Upgrade at https://biztalk-migrate.io/upgrade`
    );
    this.name = 'FeatureGateError';
    this.feature = feature;
    this.currentTier = currentTier;
    this.requiredTier = requiredTier;
  }
}
