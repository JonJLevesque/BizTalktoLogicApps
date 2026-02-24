/**
 * Unit tests for Stage 1 — Complexity Scorer
 * Uses synthetic BizTalkApplication objects
 */

import { scoreApplication } from '../../src/stage1-understand/complexity-scorer.js';
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

describe('scoreApplication — empty application', () => {
  it('scores zero for empty app', () => {
    const result = scoreApplication(makeApp());
    expect(result.totalScore).toBe(0);
  });

  it('classifies empty app as simple', () => {
    const result = scoreApplication(makeApp());
    expect(result.classification).toBe('simple');
  });

  it('returns a valid classification', () => {
    const result = scoreApplication(makeApp());
    expect(['simple', 'moderate', 'complex', 'highly-complex']).toContain(result.classification);
  });
});

describe('scoreApplication — moderate application', () => {
  const app = makeApp({
    orchestrations: [
      {
        name: 'Orch1', namespace: 'Test', filePath: '', shapes: Array(10).fill({
          shapeType: 'ReceiveShape' as const,
          shapeId: '1',
        }),
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
      },
    ],
  });

  it('scores higher than empty app', () => {
    const emptyScore = scoreApplication(makeApp()).totalScore;
    const result = scoreApplication(app);
    expect(result.totalScore).toBeGreaterThan(emptyScore);
  });

  it('returns a classification', () => {
    const result = scoreApplication(app);
    expect(result.classification).toBeDefined();
  });
});

describe('scoreApplication — complex application', () => {
  const complexShape = {
    shapeType: 'ScopeShape' as const,
    shapeId: '1',
    transactionType: 'Atomic' as const,
  };

  const app = makeApp({
    orchestrations: [
      {
        name: 'ComplexOrch', namespace: 'Test', filePath: '',
        shapes: Array(30).fill(complexShape),
        ports: [],
        correlationSets: [{ name: 'cs1', correlationTypeRef: 'x', correlationProperties: ['a'] }],
        messages: [],
        variables: [],
        hasAtomicTransactions: true,
        hasLongRunningTransactions: true,
        hasCompensation: true,
        hasBRECalls: true,
        hasSuspend: false,
        activatingReceiveCount: 1,
      },
    ],
    maps: Array(5).fill({
      name: 'Map', className: 'M', filePath: '', sourceSchemaRef: '', destinationSchemaRef: '',
      functoids: [], links: [], linkCount: 0, hasScriptingFunctoids: true, hasLooping: true,
      hasDatabaseFunctoids: true, functoidCategories: [],
    }),
  });

  it('produces a high score for complex app', () => {
    const result = scoreApplication(app);
    expect(result.totalScore).toBeGreaterThan(10);
  });

  it('classifies as complex or highly-complex', () => {
    const result = scoreApplication(app);
    expect(['complex', 'highly-complex']).toContain(result.classification);
  });
});

describe('scoreApplication — return shape', () => {
  it('includes contributors array', () => {
    const result = scoreApplication(makeApp());
    expect(Array.isArray(result.contributors)).toBe(true);
  });

  it('includes summary string', () => {
    const result = scoreApplication(makeApp());
    expect(typeof result.summary).toBe('string');
  });

  it('totalScore is non-negative', () => {
    const result = scoreApplication(makeApp());
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });
});
