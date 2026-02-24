/**
 * IntegrationIntent — the shared intermediate representation.
 *
 * This is the convergence point of the dual-mode architecture:
 *   Mode A (Migration): BizTalk XML → Stage 1 Understand → IntegrationIntent
 *   Mode B (Greenfield): Natural language → NLP Interpret → IntegrationIntent
 *
 * The Build stage (Stage 3) accepts only IntegrationIntent — it does not
 * care whether the intent came from BizTalk analysis or NLP parsing.
 */

// ─── Step Types ───────────────────────────────────────────────────────────────

export type StepType =
  | 'transform'
  | 'route'
  | 'enrich'
  | 'validate'
  | 'send'
  | 'receive'
  | 'aggregate'
  | 'split'
  | 'delay'
  | 'invoke-child'
  | 'invoke-function'
  | 'set-variable'
  | 'error-handler'
  | 'condition'
  | 'loop'
  | 'parallel';

export interface IntegrationStep {
  /** Unique ID within the intent, used for runAfter references */
  id: string;
  type: StepType;
  description: string;
  /** Logic Apps connector ID if this step uses a specific connector */
  connector?: string;
  /** Logic Apps action type, e.g. "Http", "ServiceProvider", "If", "Foreach" */
  actionType?: string;
  /** Connector / action configuration parameters */
  config: Record<string, unknown>;
  /** IDs of steps that must complete before this one starts */
  runAfter: string[];
  /** For condition/route steps: the branch steps */
  branches?: {
    condition?: string;
    trueBranch?: IntegrationStep[];
    falseBranch?: IntegrationStep[];
    /** For switch-style routing: array of case branches */
    cases?: Array<{
      value: string;
      steps: IntegrationStep[];
    }>;
    defaultSteps?: IntegrationStep[];
  };
  /** For loop steps */
  loopConfig?: {
    iterateOver?: string;
    untilExpression?: string;
    concurrency?: number;
  };
  /** For error-handler steps: what error scenario this handles */
  handlesErrorFrom?: string;
}

// ─── Trigger ──────────────────────────────────────────────────────────────────

export type TriggerType = 'polling' | 'webhook' | 'schedule' | 'manual';

export interface IntegrationTrigger {
  type: TriggerType;
  /** Human-readable source description, e.g. "SFTP server", "Service Bus queue orders-in" */
  source: string;
  /** Logic Apps connector ID, e.g. "sftp", "serviceBus", "request", "recurrence" */
  connector: string;
  /** Connector-specific config: frequency, path, queue name, etc. */
  config: Record<string, unknown>;
}

// ─── Error Handling ───────────────────────────────────────────────────────────

export type ErrorStrategy = 'retry' | 'dead-letter' | 'compensate' | 'terminate' | 'notify' | 'ignore';

export interface RetryPolicyConfig {
  count: number;
  /** ISO 8601 duration, e.g. "PT10S" */
  interval: string;
  type: 'fixed' | 'exponential';
}

export interface ErrorHandlingConfig {
  strategy: ErrorStrategy;
  retryPolicy?: RetryPolicyConfig;
  /** Service Bus queue or topic for dead-lettering */
  deadLetterTarget?: string;
  /** Email, Teams webhook, or Service Bus for notification */
  notificationTarget?: string;
  /** Name of a compensation workflow to invoke */
  compensationWorkflow?: string;
}

// ─── External Systems ─────────────────────────────────────────────────────────

export type SystemRole = 'source' | 'destination' | 'intermediate' | 'error-handler';
export type AuthMethod = 'managed-identity' | 'api-key' | 'basic' | 'oauth' | 'connection-string' | 'certificate' | 'none' | 'unknown';

export interface ExternalSystem {
  name: string;
  protocol: string;
  role: SystemRole;
  authentication: AuthMethod;
  onPremises: boolean;
  requiresGateway: boolean;
  /** Endpoint URL or address — sanitized (no credentials) */
  endpoint?: string;
}

// ─── Data Formats ─────────────────────────────────────────────────────────────

export type DataFormat = 'xml' | 'json' | 'csv' | 'flat-file' | 'edi-x12' | 'edi-edifact' | 'as2' | 'binary' | 'text' | 'unknown';

export interface DataFormatConfig {
  input: DataFormat;
  output: DataFormat;
  /** Named JSON schemas for specific message types (if known) */
  schemas?: Record<string, Record<string, unknown>>;
}

// ─── Integration Patterns ─────────────────────────────────────────────────────

export type IntegrationPattern =
  | 'content-based-routing'
  | 'sequential-convoy'
  | 'scatter-gather'
  | 'publish-subscribe'
  | 'request-reply'
  | 'message-aggregator'
  | 'message-enricher'
  | 'dead-letter-queue'
  | 'retry-idempotent'
  | 'claim-check'
  | 'process-manager'
  | 'message-filter'
  | 'splitter'
  | 'wire-tap'
  | 'fan-out'
  | 'correlation';

// ─── IntegrationIntent ────────────────────────────────────────────────────────

export interface IntegrationIntent {
  /** What starts the workflow */
  trigger: IntegrationTrigger;

  /** Ordered sequence of processing steps (may have branches/loops) */
  steps: IntegrationStep[];

  /** How failures are handled */
  errorHandling: ErrorHandlingConfig;

  /** External systems this integration touches */
  systems: ExternalSystem[];

  /** Input and output data formats + schemas */
  dataFormats: DataFormatConfig;

  /** Detected enterprise integration patterns */
  patterns: IntegrationPattern[];

  /** Metadata about this intent */
  metadata: {
    /** Where this intent came from */
    source: 'biztalk-migration' | 'nlp-greenfield';
    complexity: 'simple' | 'moderate' | 'complex';
    estimatedActions: number;
    requiresIntegrationAccount: boolean;
    requiresOnPremGateway: boolean;
    /** Name of the source BizTalk orchestration (migration mode only) */
    sourceOrchestrationName?: string;
    /** Human-provided description of intent (NLP mode only) */
    nlpDescription?: string;
  };
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Creates a minimal valid IntegrationIntent with sensible defaults.
 * Stage 1 and NLP Interpret stages use this as a starting point.
 */
export function createIntegrationIntent(
  source: IntegrationIntent['metadata']['source'],
  partial: Partial<IntegrationIntent> = {}
): IntegrationIntent {
  return {
    trigger: partial.trigger ?? {
      type: 'webhook',
      source: 'unknown',
      connector: 'request',
      config: {},
    },
    steps: partial.steps ?? [],
    errorHandling: partial.errorHandling ?? {
      strategy: 'terminate',
    },
    systems: partial.systems ?? [],
    dataFormats: partial.dataFormats ?? {
      input: 'unknown',
      output: 'unknown',
    },
    patterns: partial.patterns ?? [],
    metadata: {
      source,
      complexity: 'simple',
      estimatedActions: 0,
      requiresIntegrationAccount: false,
      requiresOnPremGateway: false,
      ...partial.metadata,
    },
  };
}

/**
 * Creates a step with a unique ID if not provided.
 */
export function createStep(
  type: StepType,
  description: string,
  config: Record<string, unknown> = {},
  runAfter: string[] = []
): IntegrationStep {
  return {
    id: `step_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    description,
    config,
    runAfter,
  };
}
