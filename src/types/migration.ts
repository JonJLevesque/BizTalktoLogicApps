/**
 * Migration analysis and planning type definitions.
 * These types represent the output of Stage 1 (Understand) and Stage 2 (Document).
 * They match the JSON Schema in schemas/migration-schema.json.
 */

import type { BizTalkApplication } from './biztalk.js';
import type { LogicAppsProject } from './logicapps.js';
import type { IntegrationIntent as _IntegrationIntent } from '../shared/integration-intent.js';

// ─── Migration Status ─────────────────────────────────────────────────────────

export type MigrationStatus = 'direct' | 'partial' | 'none';
export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';
export type EffortEstimate = 'trivial' | 'low' | 'medium' | 'high' | 'very-high';
export type ComplexityClass = 'simple' | 'moderate' | 'complex' | 'highly-complex';

// ─── Gap Analysis ─────────────────────────────────────────────────────────────

export interface MigrationGap {
  /** Short name for the gap, e.g. "MSDTC Distributed Transactions" */
  capability: string;
  severity: RiskSeverity;
  description: string;
  /** Recommended approach to bridge the gap */
  mitigation: string;
  estimatedEffortDays: number;
  /** Names of specific artifacts affected */
  affectedArtifacts: string[];
}

// ─── Component Mapping ────────────────────────────────────────────────────────

export type SourceComponentType = 'shape' | 'adapter' | 'pipeline-component' | 'functoid' | 'artifact';
export type TargetComponentType = 'trigger' | 'action' | 'connector' | 'expression' | 'azure-function' | 'pattern' | 'not-applicable';

export interface ComponentMigrationMapping {
  /** BizTalk component name, e.g. "Receive (activating)", "FILE adapter", "XML Disassembler" */
  sourceComponent: string;
  sourceType: SourceComponentType;
  migrationStatus: MigrationStatus;
  /** Logic Apps equivalent, e.g. "HTTP Request trigger", "Azure Blob Storage built-in" */
  targetComponent: string;
  targetType: TargetComponentType;
  configNotes?: string;
  effort: EffortEstimate;
  /** True if XLANG/s expressions in this component need translation */
  expressionTranslationRequired?: boolean;
  /** True if a .btm map in this component needs conversion */
  mapConversionRequired?: boolean;
}

// ─── Architecture Recommendation ─────────────────────────────────────────────

export type LogicAppsSku = 'standard' | 'consumption' | 'standard-hybrid';
export type IntegrationAccountTier = 'free' | 'basic' | 'standard';

export type RequiredAzureService =
  | 'logic-apps-standard'
  | 'service-bus'
  | 'event-hubs'
  | 'event-grid'
  | 'azure-functions'
  | 'cosmos-db'
  | 'blob-storage'
  | 'key-vault'
  | 'application-insights'
  | 'api-management'
  | 'azure-relay'
  | 'integration-account'
  | 'on-prem-data-gateway';

export interface ArchitectureRecommendation {
  targetSku: LogicAppsSku;
  /** Number of Logic Apps workflows the application will produce */
  workflowCount: number;
  requiresIntegrationAccount: boolean;
  integrationAccountTier?: IntegrationAccountTier;
  requiresOnPremGateway: boolean;
  requiresVnetIntegration: boolean;
  azureServicesRequired: RequiredAzureService[];
  estimatedMonthlyCost?: {
    currency: string;
    low: number;
    high: number;
  };
  rationale: string;
}

// ─── Migration Plan ───────────────────────────────────────────────────────────

export interface ManualInterventionPoint {
  description: string;
  severity: 'info' | 'warning' | 'required';
  /** Reference to specific artifact, shape ID, or adapter name */
  artifactRef?: string;
}

export interface MigrationPlan {
  /** Plain English summary of what this integration does and the migration approach */
  summary: string;
  componentMappings: ComponentMigrationMapping[];
  gapAnalysis: {
    gaps: MigrationGap[];
    overallRisk: RiskSeverity;
    estimatedEffortDays: number;
  };
  architectureRecommendation: ArchitectureRecommendation;
  manualInterventionPoints: ManualInterventionPoint[];
}

// ─── Migration Result (aggregate output of Stage 1 + Stage 2) ────────────────

export interface MigrationResult {
  schemaVersion: '1.0.0';
  analysisDate: string;
  biztalkApplication: BizTalkApplication;
  integrationIntent: _IntegrationIntent;
  migrationPlan: MigrationPlan;
  /** Populated after Stage 3 (Build) runs */
  generatedArtifacts?: LogicAppsProject;
}

// ─── IntegrationIntent — re-exported from shared ─────────────────────────────
// The canonical definition lives in src/shared/integration-intent.ts
// This re-export ensures migration.ts consumers don't need a separate import.
export type { IntegrationIntent, IntegrationStep } from '../shared/integration-intent.js';
