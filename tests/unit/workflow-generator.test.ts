/**
 * Unit tests for Stage 3 — Workflow Generator
 * Validates WDL JSON structure of generated Logic Apps workflows.
 *
 * generateWorkflow() returns WorkflowJson = { definition: WorkflowDefinition, kind: ... }
 * Access triggers via wf.definition.triggers, not wf.workflow.definition.triggers.
 */

import { generateWorkflow } from '../../src/stage3-build/workflow-generator.js';
import type { IntegrationIntent } from '../../src/shared/integration-intent.js';

function makeIntent(overrides: Partial<IntegrationIntent> = {}): IntegrationIntent {
  return {
    trigger: {
      type:      'polling',
      source:    'Service Bus queue',
      connector: 'serviceBus',
      config:    {},
    },
    steps: [],
    errorHandling: { strategy: 'retry' },
    systems: [],
    dataFormats: { input: 'xml', output: 'xml' },
    patterns: [],
    metadata: {
      source:                    'biztalk-migration',
      complexity:                'simple',
      estimatedActions:          0,
      requiresIntegrationAccount: false,
      requiresOnPremGateway:     false,
    },
    ...overrides,
  };
}

// ─── Basic Generation ─────────────────────────────────────────────────────────

describe('generateWorkflow — basic structure', () => {
  const wf = generateWorkflow(makeIntent());

  it('returns a workflow object', () => {
    expect(wf).toBeDefined();
  });

  it('has a workflow definition', () => {
    expect(wf.definition).toBeDefined();
  });

  it('has at least one trigger', () => {
    const triggers = Object.keys(wf.definition.triggers);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('actions is a record', () => {
    expect(typeof wf.definition.actions).toBe('object');
  });

  it('has the correct WDL $schema', () => {
    expect(wf.definition.$schema).toContain('workflowdefinition');
  });
});

// ─── Trigger Types ────────────────────────────────────────────────────────────

describe('generateWorkflow — webhook trigger', () => {
  const intent = makeIntent({
    trigger: { type: 'webhook', source: 'REST API', connector: 'request', config: {} },
  });
  const wf = generateWorkflow(intent);

  it('produces a Request trigger for webhook type', () => {
    const trigger = Object.values(wf.definition.triggers)[0];
    expect(trigger?.type).toBe('Request');
  });
});

describe('generateWorkflow — schedule trigger', () => {
  const intent = makeIntent({
    trigger: { type: 'schedule', source: 'timer', connector: 'recurrence', config: { frequency: 'Hour', interval: 1 } },
  });
  const wf = generateWorkflow(intent);

  it('produces a Recurrence trigger for schedule type', () => {
    const trigger = Object.values(wf.definition.triggers)[0];
    expect(trigger?.type).toBe('Recurrence');
  });
});

// ─── Steps → Actions ──────────────────────────────────────────────────────────

describe('generateWorkflow — with steps', () => {
  const intent = makeIntent({
    steps: [
      {
        id: 'step1',
        type: 'transform',
        description: 'Transform message',
        connector: 'xml',
        config: {},
        runAfter: [],
      },
      {
        id: 'step2',
        type: 'send',
        description: 'Send to Service Bus',
        connector: 'serviceBus',
        config: { queueOrTopicName: 'orders' },
        runAfter: ['step1'],
      },
    ],
  });
  const wf = generateWorkflow(intent);

  it('generates actions from steps', () => {
    const actionCount = Object.keys(wf.definition.actions).length;
    expect(actionCount).toBeGreaterThan(0);
  });
});

// ─── Options ──────────────────────────────────────────────────────────────────

describe('generateWorkflow — options', () => {
  it('generates Stateless kind when specified', () => {
    const wf = generateWorkflow(makeIntent(), { kind: 'Stateless' });
    expect(wf.kind).toBe('Stateless');
  });

  it('generates Stateful kind by default', () => {
    const wf = generateWorkflow(makeIntent());
    expect(wf.kind).toBe('Stateful');
  });
});
