/**
 * IntegrationIntent validator.
 * Validates that an IntegrationIntent is complete and consistent
 * before passing it to the Build stage.
 */

import { z } from 'zod';
import type { IntegrationIntent } from './integration-intent.js';

// ─── Zod Schema ────────────────────────────────────────────────────────────────

const TriggerTypeSchema = z.enum(['polling', 'webhook', 'schedule', 'manual']);
const DataFormatSchema = z.enum(['xml', 'json', 'csv', 'flat-file', 'edi-x12', 'edi-edifact', 'as2', 'binary', 'text', 'unknown']);
const PatternSchema = z.enum([
  'content-based-routing', 'sequential-convoy', 'scatter-gather',
  'publish-subscribe', 'request-reply', 'message-aggregator',
  'message-enricher', 'dead-letter-queue', 'retry-idempotent',
  'claim-check', 'process-manager', 'message-filter', 'splitter',
  'wire-tap', 'fan-out', 'correlation',
]);

const StepSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.enum([
      'transform', 'route', 'enrich', 'validate', 'send', 'receive',
      'aggregate', 'split', 'delay', 'invoke-child', 'invoke-function',
      'set-variable', 'error-handler', 'condition', 'loop', 'parallel',
    ]),
    description: z.string().min(1),
    connector: z.string().optional(),
    actionType: z.string().optional(),
    config: z.record(z.unknown()),
    runAfter: z.array(z.string()),
  })
);

const IntentSchema = z.object({
  trigger: z.object({
    type: TriggerTypeSchema,
    source: z.string().min(1),
    connector: z.string().min(1),
    config: z.record(z.unknown()),
  }),
  steps: z.array(StepSchema),
  errorHandling: z.object({
    strategy: z.enum(['retry', 'dead-letter', 'compensate', 'terminate', 'notify', 'ignore']),
    retryPolicy: z.object({
      count: z.number().int().min(1).max(90),
      interval: z.string(),
      type: z.enum(['fixed', 'exponential']),
    }).optional(),
    deadLetterTarget: z.string().optional(),
    notificationTarget: z.string().optional(),
    compensationWorkflow: z.string().optional(),
  }),
  systems: z.array(z.object({
    name: z.string().min(1),
    protocol: z.string().min(1),
    role: z.enum(['source', 'destination', 'intermediate', 'error-handler']),
    authentication: z.enum(['managed-identity', 'api-key', 'basic', 'oauth', 'connection-string', 'certificate', 'none', 'unknown']),
    onPremises: z.boolean(),
    requiresGateway: z.boolean(),
    endpoint: z.string().optional(),
  })),
  dataFormats: z.object({
    input: DataFormatSchema,
    output: DataFormatSchema,
    schemas: z.record(z.record(z.unknown())).optional(),
  }),
  patterns: z.array(PatternSchema),
  metadata: z.object({
    source: z.enum(['biztalk-migration', 'nlp-greenfield']),
    complexity: z.enum(['simple', 'moderate', 'complex']),
    estimatedActions: z.number().int().min(0),
    requiresIntegrationAccount: z.boolean(),
    requiresOnPremGateway: z.boolean(),
    sourceOrchestrationName: z.string().optional(),
    nlpDescription: z.string().optional(),
  }),
});

// ─── Semantic Validation ───────────────────────────────────────────────────────

export interface ValidationWarning {
  field: string;
  message: string;
  severity: 'info' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: ValidationWarning[];
}

/**
 * Validates an IntegrationIntent for structural correctness (Zod schema)
 * and semantic consistency (cross-field rules).
 */
export function validateIntegrationIntent(intent: IntegrationIntent): ValidationResult {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];

  // Structural validation
  const parseResult = IntentSchema.safeParse(intent);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  // Semantic rule: polling trigger should have recurrence config
  if (intent.trigger.type === 'polling' && !intent.trigger.config['recurrence']) {
    warnings.push({
      field: 'trigger.config',
      message: 'Polling trigger has no recurrence config — default 1-minute interval will be used',
      severity: 'warning',
    });
  }

  // Semantic rule: retry strategy requires retryPolicy
  if (intent.errorHandling.strategy === 'retry' && !intent.errorHandling.retryPolicy) {
    warnings.push({
      field: 'errorHandling.retryPolicy',
      message: 'Error strategy is "retry" but no retryPolicy is configured — default (3 retries, fixed 30s) will be used',
      severity: 'warning',
    });
  }

  // Semantic rule: dead-letter strategy requires a target queue
  if (intent.errorHandling.strategy === 'dead-letter' && !intent.errorHandling.deadLetterTarget) {
    warnings.push({
      field: 'errorHandling.deadLetterTarget',
      message: 'Dead-letter strategy configured but no deadLetterTarget specified',
      severity: 'warning',
    });
  }

  // Semantic rule: EDI formats require Integration Account
  const isEdi = intent.dataFormats.input === 'edi-x12' ||
    intent.dataFormats.input === 'edi-edifact' ||
    intent.dataFormats.output === 'edi-x12' ||
    intent.dataFormats.output === 'edi-edifact';
  if (isEdi && !intent.metadata.requiresIntegrationAccount) {
    warnings.push({
      field: 'metadata.requiresIntegrationAccount',
      message: 'EDI format detected but requiresIntegrationAccount is false — should be true',
      severity: 'warning',
    });
  }

  // Semantic rule: on-premises system without gateway flag
  const onPremSystemWithoutGateway = intent.systems.find(
    s => s.onPremises && !s.requiresGateway && s.protocol !== 'HTTP' && s.protocol !== 'HTTPS'
  );
  if (onPremSystemWithoutGateway) {
    warnings.push({
      field: `systems[${onPremSystemWithoutGateway.name}].requiresGateway`,
      message: `On-premises system "${onPremSystemWithoutGateway.name}" uses protocol "${onPremSystemWithoutGateway.protocol}" but requiresGateway is false`,
      severity: 'warning',
    });
  }

  // Semantic rule: step runAfter references must exist
  const stepIds = new Set(intent.steps.map(s => s.id));
  for (const step of intent.steps) {
    for (const depId of step.runAfter) {
      if (!stepIds.has(depId)) {
        errors.push(`steps[${step.id}].runAfter: references unknown step ID "${depId}"`);
      }
    }
  }

  // Semantic rule: NLP greenfield should have a description
  if (intent.metadata.source === 'nlp-greenfield' && !intent.metadata.nlpDescription) {
    warnings.push({
      field: 'metadata.nlpDescription',
      message: 'Greenfield intent has no nlpDescription — consider adding the original natural language input for traceability',
      severity: 'info',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
