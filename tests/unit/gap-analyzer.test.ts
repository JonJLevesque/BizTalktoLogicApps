/**
 * Unit tests for Stage 2 — Gap Analyzer
 * Uses synthetic BizTalkApplication objects
 */

import { analyzeGaps } from '../../src/stage2-document/gap-analyzer.js';
import type { BizTalkApplication } from '../../src/types/biztalk.js';

function makeApp(overrides: Partial<BizTalkApplication> = {}): BizTalkApplication {
  return {
    name:                    'TestApp',
    biztalkVersion:          'unknown',
    orchestrations:          [],
    maps:                    [],
    pipelines:               [],
    schemas:                 [],
    bindingFiles:            [],
    complexityScore:         0,
    complexityClassification: 'simple',
    ...overrides,
  };
}

describe('analyzeGaps — clean application', () => {
  it('returns an array for clean app', () => {
    const result = analyzeGaps(makeApp());
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns no gaps for empty app', () => {
    const result = analyzeGaps(makeApp());
    expect(result.length).toBe(0);
  });
});

describe('analyzeGaps — application with atomic transactions', () => {
  const app = makeApp({
    orchestrations: [{
      name: 'Orch1', namespace: 'Test', filePath: '',
      shapes: [],
      ports: [],
      correlationSets: [],
      messages: [],
      variables: [],
      hasAtomicTransactions: true,
      hasLongRunningTransactions: false,
      hasCompensation: false,
      hasBRECalls: false,
      hasSuspend: false,
      activatingReceiveCount: 0,
    }],
  });

  it('detects MSDTC / distributed transaction gap', () => {
    const gaps = analyzeGaps(app);
    const txGap = gaps.find(g =>
      g.capability.toLowerCase().includes('transaction') ||
      g.capability.toLowerCase().includes('msdtc') ||
      g.capability.toLowerCase().includes('atomic')
    );
    expect(txGap).toBeDefined();
  });
});

describe('analyzeGaps — application with custom pipeline components', () => {
  const app = makeApp({
    pipelines: [{
      name: 'CustomPipeline',
      className: 'Corp.CustomPipeline',
      filePath: '',
      direction: 'receive',
      components: [{
        componentType: 'Decoder',
        fullTypeName: 'Corp.CustomDecoder',
        stage: 'Decode',
        isCustom: true,
        properties: {},
      }],
      hasCustomComponents: true,
      isDefault: false,
    }],
  });

  it('identifies custom pipeline component gap', () => {
    const gaps = analyzeGaps(app);
    const pipelineGap = gaps.find(g =>
      g.capability.toLowerCase().includes('pipeline') ||
      g.capability.toLowerCase().includes('custom')
    );
    expect(pipelineGap).toBeDefined();
  });
});

describe('analyzeGaps — gap structure', () => {
  const app = makeApp({
    orchestrations: [{
      name: 'O1', namespace: '', filePath: '', shapes: [],
      ports: [], correlationSets: [], messages: [], variables: [],
      hasAtomicTransactions: true,
      hasLongRunningTransactions: true,
      hasCompensation: true,
      hasBRECalls: false,
      hasSuspend: true,
      activatingReceiveCount: 0,
    }],
  });

  it('each gap has required fields', () => {
    const gaps = analyzeGaps(app);
    for (const gap of gaps) {
      expect(typeof gap.capability).toBe('string');
      expect(['low', 'medium', 'high', 'critical']).toContain(gap.severity);
      expect(typeof gap.description).toBe('string');
      expect(typeof gap.mitigation).toBe('string');
      expect(typeof gap.estimatedEffortDays).toBe('number');
      expect(Array.isArray(gap.affectedArtifacts)).toBe(true);
    }
  });
});
