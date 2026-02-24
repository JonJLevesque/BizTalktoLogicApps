/**
 * Stage 2: Document
 * Exports all analysis and specification functions for generating migration plans.
 */

export { analyzeGaps } from './gap-analyzer.js';
export { assessRisk } from './risk-assessor.js';
export type { RiskAssessment } from './risk-assessor.js';
export { recommendArchitecture } from './architecture-recommender.js';
export { generateMigrationSpec, generateMigrationResult } from './migration-spec-generator.js';
