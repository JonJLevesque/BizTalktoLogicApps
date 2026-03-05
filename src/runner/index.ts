/**
 * Runner module — barrel exports
 *
 * The runner orchestrates the full BizTalk → Logic Apps migration pipeline
 * in a single `runMigration()` function call.
 *
 * Also exports the estate assessment runner for multi-application analysis.
 */

export { runMigration }                from './migration-runner.js';
export { runEstateAssessment }         from './estate-runner.js';
export { generateEstateReport }        from './estate-report-generator.js';
export { parseArtifacts }              from './artifact-parser.js';
export { extractMsi, check7zInstalled } from './msi-extractor.js';
export { ClaudeClient }                from './claude-client.js';
export { generateMigrationReport }     from './report-generator.js';
export { writeOutput }                 from './output-writer.js';
export type {
  MigrationRunOptions,
  MigrationRunResult,
  MigrationStep,
  StepProgress,
  EnrichmentRequest,
  EnrichmentResponse,
  ReviewRequest,
  ReviewResponse,
  EstateRunOptions,
  EstateProgress,
  EstateResult,
  AppAssessment,
  EstateTotals,
} from './types.js';
export type { ReportInput } from './report-generator.js';
export type { WriteOptions } from './output-writer.js';
export type { MsiExtractionResult } from './msi-extractor.js';
