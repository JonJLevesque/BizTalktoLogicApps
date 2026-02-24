/**
 * Unit tests for Stage 2 — Migration Spec Generator
 * Validates the shape and content of generated migration specs
 */

import { generateMigrationSpec } from '../../src/stage2-document/migration-spec-generator.js';
import type { BizTalkApplication } from '../../src/types/biztalk.js';
import type { IntegrationIntent } from '../../src/shared/integration-intent.js';

function makeApp(overrides: Partial<BizTalkApplication> = {}): BizTalkApplication {
  return {
    name: 'TestApp',
    biztalkVersion: 'unknown',
    orchestrations: [],
    maps: [],
    pipelines: [],
    schemas: [],
    bindingFiles: [],
    complexityScore: 20,
    complexityClassification: 'moderate',
    ...overrides,
  };
}

function makeIntent(overrides: Partial<IntegrationIntent> = {}): IntegrationIntent {
  return {
    trigger: { type: 'polling', source: 'Service Bus', connector: 'serviceBus', config: {} },
    steps: [],
    errorHandling: { strategy: 'retry' },
    systems: [],
    dataFormats: { input: 'xml', output: 'xml' },
    patterns: [],
    metadata: {
      source: 'biztalk-migration',
      complexity: 'moderate',
      estimatedActions: 5,
      requiresIntegrationAccount: false,
      requiresOnPremGateway: false,
    },
    ...overrides,
  };
}

// ─── Basic Structure ──────────────────────────────────────────────────────────

describe('generateMigrationSpec — basic structure', () => {
  const plan = generateMigrationSpec(makeApp(), makeIntent());

  it('generates a migration plan', () => {
    expect(plan).toBeDefined();
  });

  it('has componentMappings array', () => {
    expect(Array.isArray(plan.componentMappings)).toBe(true);
  });

  it('has gapAnalysis', () => {
    expect(plan.gapAnalysis).toBeDefined();
  });

  it('has architectureRecommendation', () => {
    expect(plan.architectureRecommendation).toBeDefined();
  });

  it('has estimatedEffortDays in gapAnalysis', () => {
    expect(typeof plan.gapAnalysis.estimatedEffortDays).toBe('number');
  });
});

// ─── With Orchestrations ──────────────────────────────────────────────────────

describe('generateMigrationSpec — with orchestrations', () => {
  const app = makeApp({
    orchestrations: [{
      name: 'OrderOrch', namespace: 'NS', filePath: '',
      shapes: [
        { shapeType: 'ReceiveShape', shapeId: '1', isActivating: true },
        { shapeType: 'TransformShape', shapeId: '2', mapClass: 'OrderMap' },
        { shapeType: 'SendShape', shapeId: '3' },
      ],
      ports: [],
      correlationSets: [],
      messages: [],
      variables: [],
      hasAtomicTransactions: false,
      hasLongRunningTransactions: false,
      hasCompensation: false,
      hasBRECalls: false,
      hasSuspend: false,
      activatingReceiveCount: 1,
    }],
  });

  const plan = generateMigrationSpec(app, makeIntent());

  it('produces component mappings for orchestration shapes', () => {
    expect(plan.componentMappings.length).toBeGreaterThan(0);
  });

  it('each mapping has required fields', () => {
    for (const m of plan.componentMappings) {
      expect(typeof m.sourceComponent).toBe('string');
      expect(typeof m.targetComponent).toBe('string');
      expect(['direct', 'partial', 'none']).toContain(m.migrationStatus);
      expect(['trivial', 'low', 'medium', 'high', 'very-high']).toContain(m.effort);
    }
  });
});

// ─── Adapter Mappings ─────────────────────────────────────────────────────────

describe('generateMigrationSpec — adapter mappings', () => {
  const app = makeApp({
    bindingFiles: [{
      applicationName: 'TestApp',
      filePath: '',
      receiveLocations: [{
        name: 'RL_FILE',
        receivePortName: 'RP_ReceiveOrder',
        adapterType: 'FILE',
        address: 'C:\\Input\\*.xml',
        pipelineName: 'XMLReceive',
        adapterProperties: {},
        isEnabled: true,
      }],
      sendPorts: [],
    }],
  });

  const plan = generateMigrationSpec(app, makeIntent());

  it('maps FILE adapter to connector', () => {
    const fileMapping = plan.componentMappings.find(m =>
      m.sourceComponent.toLowerCase().includes('file') ||
      m.sourceComponent.toLowerCase().includes('rl_')
    );
    expect(fileMapping).toBeDefined();
  });
});
