/**
 * Design Generator — Greenfield Stage G2 (PREMIUM TIER)
 *
 * Produces an architecture specification from an IntegrationIntent BEFORE
 * generating workflow code. This two-step approach (Design → Build) prevents
 * wasted code generation when requirements are ambiguous.
 *
 * The design spec is intended to be:
 *   1. Shown to the user for review and approval
 *   2. Used as structured context when invoking the Build stage
 *   3. Included in the project documentation
 *
 * Design spec contents:
 *   - Architecture summary (plain English)
 *   - Workflow outline (hierarchical action tree)
 *   - Connector selection with reasoning
 *   - Required Azure resources + estimated costs
 *   - Recommended Logic Apps SKU (always Standard for enterprise)
 *   - Clarifying questions for ambiguous aspects
 *   - Risk flags (e.g., missing auth, unsupported pattern)
 */

import type { IntegrationIntent, IntegrationStep } from '../shared/integration-intent.js';
import { recommendConnectors }                     from './connector-recommender.js';
import type { ConnectorRecommendation }            from './connector-recommender.js';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface WorkflowDesign {
  /** Plain English summary of what will be built */
  summary:               string;
  /** Hierarchical outline of the workflow */
  workflowOutline:       WorkflowOutlineNode[];
  /** Connector recommendations for all external systems */
  connectorRecommendations: ConnectorRecommendation[];
  /** Azure resources needed */
  requiredResources:     DesignResource[];
  /** Estimated monthly cost range (very rough) */
  estimatedMonthlyCost:  CostEstimate;
  /** SKU recommendation */
  recommendedSku:        'standard' | 'consumption';
  /** Questions to ask user before generating code */
  clarifyingQuestions:   ClarifyingQuestion[];
  /** Risk flags */
  risks:                 DesignRisk[];
  /** Whether design has enough info to proceed to Build */
  readyToBuild:          boolean;
}

export interface WorkflowOutlineNode {
  order:    number;
  type:     string;
  name:     string;
  detail:   string;
  children?: WorkflowOutlineNode[];
}

export interface DesignResource {
  name:             string;
  sku:              string;
  purpose:          string;
  estimatedMonthlyCost?: string;
}

export interface CostEstimate {
  low:      string;
  high:     string;
  currency: 'USD';
  notes:    string;
}

export interface ClarifyingQuestion {
  aspect:       string;
  question:     string;
  impact:       'blocking' | 'important' | 'nice-to-have';
  defaultValue?: string;
}

export interface DesignRisk {
  severity:    'critical' | 'warning' | 'info';
  description: string;
  mitigation:  string;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Generate a design specification from an IntegrationIntent.
 * Returns the design for user review before code generation begins.
 */
export function generateDesign(intent: IntegrationIntent): WorkflowDesign {
  const connectorRecs       = recommendConnectors(intent.systems);
  const workflowOutline     = buildWorkflowOutline(intent);
  const requiredResources   = deriveRequiredResources(intent, connectorRecs);
  const clarifyingQuestions = buildClarifyingQuestions(intent);
  const risks               = assessDesignRisks(intent, connectorRecs);
  const summary             = buildSummary(intent, connectorRecs);
  const sku                 = recommendSku(intent);
  const cost                = estimateCost(intent, requiredResources, sku);
  const readyToBuild        = clarifyingQuestions.filter(q => q.impact === 'blocking').length === 0;

  return {
    summary,
    workflowOutline,
    connectorRecommendations: connectorRecs,
    requiredResources,
    estimatedMonthlyCost:     cost,
    recommendedSku:           sku,
    clarifyingQuestions,
    risks,
    readyToBuild,
  };
}

// ─── Workflow Outline ─────────────────────────────────────────────────────────

function buildWorkflowOutline(intent: IntegrationIntent): WorkflowOutlineNode[] {
  const nodes: WorkflowOutlineNode[] = [];
  let order = 1;

  // Trigger node
  nodes.push({
    order: order++,
    type:  'trigger',
    name:  `Trigger: ${intent.trigger.source}`,
    detail: buildTriggerDetail(intent.trigger),
  });

  // Steps
  for (const step of intent.steps) {
    nodes.push(buildStepNode(step, order++));
  }

  // Error handling scope
  if (intent.errorHandling.strategy !== 'ignore') {
    const errNode: WorkflowOutlineNode = {
      order: order++,
      type:  'error-handler',
      name:  `Error Handler (${intent.errorHandling.strategy})`,
      detail: buildErrorHandlerDetail(intent.errorHandling),
    };

    if (intent.errorHandling.deadLetterTarget) {
      errNode.children = [{
        order:  1,
        type:   'send',
        name:   `Dead-letter to ${intent.errorHandling.deadLetterTarget}`,
        detail: 'Route failed messages to dead-letter queue for manual review',
      }];
    }

    if (intent.errorHandling.notificationTarget) {
      errNode.children = errNode.children ?? [];
      errNode.children.push({
        order:  2,
        type:   'send',
        name:   `Notify ${intent.errorHandling.notificationTarget}`,
        detail: 'Send failure notification email',
      });
    }

    nodes.push(errNode);
  }

  return nodes;
}

function buildTriggerDetail(trigger: IntegrationIntent['trigger']): string {
  const parts: string[] = [`Connector: ${trigger.connector}`];

  if (trigger.config?.['frequency']) {
    parts.push(`Runs every ${trigger.config['interval'] ?? 1} ${trigger.config['frequency']}`);
  }
  if (trigger.config?.['queueName']) {
    parts.push(`Queue: ${trigger.config['queueName']}`);
  }
  if (trigger.config?.['method']) {
    parts.push(`HTTP ${trigger.config['method']}`);
  }

  return parts.join(' · ');
}

function buildStepNode(step: IntegrationStep, order: number): WorkflowOutlineNode {
  const node: WorkflowOutlineNode = {
    order,
    type:   step.type,
    name:   step.description,
    detail: buildStepDetail(step),
  };

  // Branches as children
  if (step.branches) {
    node.children = [];
    if (step.branches.trueBranch) {
      node.children.push({
        order:  1,
        type:   'branch',
        name:   'True branch',
        detail: `${step.branches.trueBranch.length} action(s)`,
      });
    }
    if (step.branches.falseBranch) {
      node.children.push({
        order:  2,
        type:   'branch',
        name:   'False / else branch',
        detail: `${step.branches.falseBranch.length} action(s)`,
      });
    }
    if (step.branches.cases) {
      for (const c of step.branches.cases) {
        node.children.push({
          order:  node.children.length + 1,
          type:   'case',
          name:   `Case: ${c.value}`,
          detail: `${c.steps.length} action(s)`,
        });
      }
    }
  }

  return node;
}

function buildStepDetail(step: IntegrationStep): string {
  const parts: string[] = [];
  if (step.connector)         parts.push(`Connector: ${step.connector}`);
  if (step.config?.['method']) parts.push(`${String(step.config['method'])}`);
  if (step.config?.['uri'])    parts.push(`→ ${String(step.config['uri'])}`);
  return parts.join(' ') || step.type;
}

function buildErrorHandlerDetail(errorHandling: IntegrationIntent['errorHandling']): string {
  const parts: string[] = [`Strategy: ${errorHandling.strategy}`];

  if (errorHandling.retryPolicy) {
    const rp = errorHandling.retryPolicy;
    parts.push(`Retry: ${rp.count}× (${rp.type}, interval ${rp.interval})`);
  }
  if (errorHandling.deadLetterTarget) {
    parts.push(`Dead-letter: ${errorHandling.deadLetterTarget}`);
  }
  if (errorHandling.notificationTarget) {
    parts.push(`Notify: ${errorHandling.notificationTarget}`);
  }

  return parts.join(' · ');
}

// ─── Resources ────────────────────────────────────────────────────────────────

function deriveRequiredResources(
  intent: IntegrationIntent,
  connectorRecs: ConnectorRecommendation[]
): DesignResource[] {
  const resources: DesignResource[] = [];
  const seen = new Set<string>();

  const add = (r: DesignResource) => {
    if (!seen.has(r.name)) {
      seen.add(r.name);
      resources.push(r);
    }
  };

  // Logic App itself
  add({
    name:    'Logic Apps Standard App',
    sku:     'WS1 (Workflow Standard 1)',
    purpose: 'Hosts the workflow runtime',
    estimatedMonthlyCost: '$140–$180',
  });

  add({
    name:    'App Service Plan',
    sku:     'WS1',
    purpose: 'Compute plan for Logic Apps Standard',
    estimatedMonthlyCost: 'Included with Logic App',
  });

  add({
    name:    'Azure Storage Account',
    sku:     'Standard_LRS',
    purpose: 'Workflow state, trigger checkpoints',
    estimatedMonthlyCost: '$5–$10',
  });

  add({
    name:    'Application Insights',
    sku:     'Pay-as-you-go',
    purpose: 'Workflow run monitoring and alerting',
    estimatedMonthlyCost: '$0–$20 (depends on volume)',
  });

  // From connector recommendations
  for (const rec of connectorRecs) {
    for (const res of rec.requiredResources) {
      if (!seen.has(res)) {
        seen.add(res);
        resources.push({
          name:    res,
          sku:     'Standard',
          purpose: `Required by ${rec.displayName} connector`,
        });
      }
    }
  }

  // Integration Account if EDI
  if (intent.metadata.requiresIntegrationAccount) {
    add({
      name:    'Integration Account',
      sku:     'Basic',
      purpose: 'EDI/B2B schemas, maps, and partners',
      estimatedMonthlyCost: '$30–$300 depending on tier',
    });
  }

  return resources;
}

// ─── SKU Recommendation ────────────────────────────────────────────────────────

function recommendSku(intent: IntegrationIntent): 'standard' | 'consumption' {
  // Standard is always recommended for:
  // - Production workloads with built-in connectors
  // - Patterns requiring stateful processing
  // - Private networking requirements
  // - SAP/SFTP built-in connectors (Standard-only)
  // - VNet integration
  const hasStandardOnlyFeatures =
    intent.systems.some(s => ['SAP', 'SFTP'].includes(s.protocol)) ||
    intent.metadata.complexity !== 'simple';

  return hasStandardOnlyFeatures ? 'standard' : 'standard'; // Always standard for BizTalk migration
}

// ─── Cost Estimation ──────────────────────────────────────────────────────────

function estimateCost(
  intent: IntegrationIntent,
  resources: DesignResource[],
  sku: 'standard' | 'consumption'
): CostEstimate {
  // Very rough estimate based on resource count and SKU
  const baseCost = sku === 'standard' ? 150 : 20;
  const extras   = resources.length * 10;
  const low      = baseCost + extras;
  const high     = Math.round((baseCost + extras) * 1.5);

  return {
    low:      `$${low}`,
    high:     `$${high}`,
    currency: 'USD',
    notes:    'Estimate based on resource types. Actual cost depends on execution volume, storage, and network egress. Run Azure Pricing Calculator for accurate estimates.',
  };
}

// ─── Clarifying Questions ─────────────────────────────────────────────────────

function buildClarifyingQuestions(intent: IntegrationIntent): ClarifyingQuestion[] {
  const questions: ClarifyingQuestion[] = [];

  // Authentication for each system
  for (const sys of intent.systems) {
    if (sys.authentication === 'unknown') {
      questions.push({
        aspect:       `Authentication: ${sys.name}`,
        question:     `How does ${sys.name} authenticate? (managed identity, API key, OAuth 2.0, username/password, connection string)`,
        impact:       'blocking',
        defaultValue: 'managed-identity',
      });
    }
  }

  // Missing trigger config
  if (intent.trigger.type === 'polling' && !intent.trigger.config?.['interval']) {
    questions.push({
      aspect:       'Polling interval',
      question:     'How frequently should the workflow poll for new data?',
      impact:       'important',
      defaultValue: 'Every 5 minutes',
    });
  }

  // Transform schema
  const hasTransform = intent.steps.some(s => s.type === 'transform');
  if (hasTransform) {
    questions.push({
      aspect:   'Transformation schema',
      question: 'Can you provide a sample input payload and describe the desired output structure?',
      impact:   'important',
    });
  }

  // Dead-letter queue name
  if (intent.errorHandling.deadLetterTarget === 'dead-letter-queue') {
    questions.push({
      aspect:       'Dead-letter queue name',
      question:     'What is the name of the dead-letter Service Bus queue?',
      impact:       'important',
      defaultValue: 'dlq',
    });
  }

  // Retry interval
  if (intent.errorHandling.retryPolicy && !intent.errorHandling.retryPolicy.interval) {
    questions.push({
      aspect:       'Retry interval',
      question:     'How long should the workflow wait between retry attempts?',
      impact:       'nice-to-have',
      defaultValue: '30 seconds',
    });
  }

  return questions;
}

// ─── Risk Assessment ──────────────────────────────────────────────────────────

function assessDesignRisks(
  intent: IntegrationIntent,
  connectorRecs: ConnectorRecommendation[]
): DesignRisk[] {
  const risks: DesignRisk[] = [];

  // Unknown auth
  if (intent.systems.some(s => s.authentication === 'unknown')) {
    risks.push({
      severity:    'critical',
      description: 'One or more external systems have unknown authentication method.',
      mitigation:  'Clarify authentication before generating connection configurations.',
    });
  }

  // No steps
  if (intent.steps.length === 0) {
    risks.push({
      severity:    'warning',
      description: 'No processing steps were identified from the description.',
      mitigation:  'Provide more detail about data transformations, validations, and routing logic.',
    });
  }

  // High complexity
  if (intent.metadata.complexity === 'complex') {
    risks.push({
      severity:    'warning',
      description: 'High complexity detected. Generated workflow may need manual refinement.',
      mitigation:  'Review the generated workflow carefully and use the /refine command for adjustments.',
    });
  }

  // Managed connectors with OAuth
  const oauthConnectors = connectorRecs.filter(r => r.authMethod === 'oauth');
  if (oauthConnectors.length > 0) {
    risks.push({
      severity:    'info',
      description: `${oauthConnectors.map(r => r.displayName).join(', ')} require OAuth consent. Set up a service account with appropriate permissions before deploying.`,
      mitigation:  'Create a dedicated service account for each OAuth connection. Avoid personal accounts.',
    });
  }

  // SAP caveats
  const sapRec = connectorRecs.find(r => r.connectorName === 'sap');
  if (sapRec) {
    risks.push({
      severity:    'warning',
      description: 'SAP connector requires SAP NCo license and On-Premises Data Gateway configuration.',
      mitigation:  'Ensure SAP NCo is licensed and On-Premises Data Gateway VM is provisioned before deployment.',
    });
  }

  return risks;
}

// ─── Summary Builder ──────────────────────────────────────────────────────────

function buildSummary(
  intent: IntegrationIntent,
  connectorRecs: ConnectorRecommendation[]
): string {
  const triggerDesc = `triggered by ${intent.trigger.source}`;
  const stepCount   = intent.steps.length;
  const systems     = intent.systems.length;
  const patternDesc = intent.patterns.length > 0
    ? ` It implements ${intent.patterns.join(', ')} pattern${intent.patterns.length > 1 ? 's' : ''}.`
    : '';
  const errorDesc   = intent.errorHandling.strategy !== 'ignore'
    ? ` Error handling uses the ${intent.errorHandling.strategy} strategy.`
    : '';
  const builtInCount = connectorRecs.filter(r => r.connectorType === 'built-in').length;

  return (
    `This workflow is ${triggerDesc}, performs ${stepCount} processing step${stepCount !== 1 ? 's' : ''}, ` +
    `and integrates with ${systems} external system${systems !== 1 ? 's' : ''}.` +
    patternDesc +
    errorDesc +
    ` ${builtInCount} of ${connectorRecs.length} connector${connectorRecs.length !== 1 ? 's' : ''} are built-in (lower latency, no managed connector overhead).`
  );
}
