/**
 * Runner Types — Automated Migration Pipeline
 *
 * Types for the one-command migration runner and estate assessment runner.
 * The runner orchestrates the full 5-step pipeline without requiring
 * the consultant to understand prompts, chains, or MCP tools.
 */

import type { IntegrationIntent, IntegrationPattern } from '../shared/integration-intent.js';
import type { BuildResult } from '../stage3-build/package-builder.js';
import type { QualityReport } from '../validation/quality-scorer.js';
import type { WorkflowValidationResult } from '../validation/workflow-validator.js';
import type { BizTalkApplication } from '../types/biztalk.js';
import type {
  MigrationGap,
  ComplexityClass,
  ArchitectureRecommendation,
} from '../types/migration.js';
import type { ComplexityBreakdown } from '../stage1-understand/complexity-scorer.js';

// ─── Pipeline Steps ───────────────────────────────────────────────────────────

export type MigrationStep = 'parse' | 'reason' | 'scaffold' | 'validate' | 'review' | 'report';

export interface StepProgress {
  step: MigrationStep;
  message: string;
  detail?: string | undefined;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface MigrationRunOptions {
  /** Directory containing BizTalk artifacts (.odx, .btm, .btp, BindingInfo.xml) */
  artifactDir: string;
  /** Human-readable application name (used in output file names and report) */
  appName: string;
  /** Directory to write generated Logic Apps project files */
  outputDir: string;
  /** Progress callback — called at the start of each pipeline step */
  onProgress?: (progress: StepProgress) => void;
  /** Skip Claude enrichment — use partial IntegrationIntent as-is (dev/offline mode) */
  skipEnrichment?: boolean;
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface MigrationRunResult {
  /** Overall pipeline success. False only when zero artifacts are found. */
  success: boolean;
  /** Final validated build result (undefined if scaffold step failed) */
  buildResult?: BuildResult;
  /** Quality score and grade (undefined if validation step was skipped) */
  qualityReport?: QualityReport;
  /** Markdown migration report (always present on success) */
  migrationReport: string;
  /** Non-fatal errors accumulated during the run (parse failures, enrichment failures) */
  errors: string[];
  /** Warnings from build and validation steps */
  warnings: string[];
  /** Wall-clock timings per step in milliseconds */
  timings: Partial<Record<MigrationStep, number>>;
}

// ─── Claude Enrichment ────────────────────────────────────────────────────────

export interface EnrichmentRequest {
  /** Partial IntegrationIntent with TODO_CLAUDE markers */
  partialIntent: IntegrationIntent;
  /** Application name for context */
  appName: string;
  /** Detected integration patterns */
  patterns: string[];
  /** Gap analysis summary for enrichment context */
  gapSummary?: string;
}

export interface EnrichmentResponse {
  /** Fully enriched IntegrationIntent (no TODO_CLAUDE markers) */
  enrichedIntent: IntegrationIntent;
  /** Claude's notes on what was enriched */
  notes?: string;
}

// ─── Claude Review ────────────────────────────────────────────────────────────

export interface ReviewRequest {
  /** Workflow JSON string to review */
  workflowJson: string;
  /** Validation issues to fix */
  validationIssues: WorkflowValidationResult;
  /** Current quality grade (e.g. 'C', 'D') */
  currentGrade: string;
  /** Current quality score */
  currentScore: number;
}

export interface ReviewResponse {
  /** Fixed workflow JSON string */
  fixedWorkflowJson: string;
  /** List of changes made */
  changesApplied: string[];
}

// Re-export for convenience
export type { BuildResult, QualityReport, WorkflowValidationResult };

// ─── Estate Assessment ────────────────────────────────────────────────────────

export interface EstateRunOptions {
  /** Root directory — each subdirectory is treated as one BizTalk application */
  estateDir: string;
  /** Output path for the generated estate-report.md */
  outputPath: string;
  /** Progress callback called as each app is processed */
  onProgress?: (progress: EstateProgress) => void;
}

export interface EstateProgress {
  phase: 'scan' | 'analyze' | 'report';
  current: number;
  total: number;
  appName: string;
  message: string;
}

export interface AppAssessment {
  name: string;
  dirPath: string;
  app: BizTalkApplication;
  complexity: ComplexityBreakdown;
  gaps: MigrationGap[];
  patterns: IntegrationPattern[];
  architecture: ArchitectureRecommendation;
  estimatedEffortDays: number;
  wave: 1 | 2 | 3 | 4;
}

export interface EstateResult {
  assessments: AppAssessment[];
  failures: Array<{ name: string; dirPath: string; error: string }>;
  totals: EstateTotals;
  report: string;
}

export interface EstateTotals {
  applications: number;
  orchestrations: number;
  maps: number;
  pipelines: number;
  schemas: number;
  totalGaps: number;
  criticalGaps: number;
  highGaps: number;
  mediumGaps: number;
  totalEstimatedEffortDays: number;
  complexityDistribution: Record<ComplexityClass, number>;
  adapterInventory: Array<{ adapterType: string; appCount: number; hasKnownGaps: boolean }>;
  requiresIntegrationAccount: number;
  requiresOnPremGateway: number;
}
