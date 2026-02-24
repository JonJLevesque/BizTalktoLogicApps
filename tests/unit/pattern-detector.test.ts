/**
 * Unit tests for Stage 1 — Pattern Detector
 * Uses synthetic BizTalkApplication objects
 *
 * Note: detectPatterns() returns IntegrationPattern[] which is a string union array.
 * Pattern values look like 'content-based-routing', 'sequential-convoy', etc.
 */

import { detectPatterns } from '../../src/stage1-understand/pattern-detector.js';
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

function makeOrch(overrides: Partial<BizTalkApplication['orchestrations'][number]> = {}): BizTalkApplication['orchestrations'][number] {
  return {
    name: 'TestOrch', namespace: 'Test', filePath: '',
    shapes: [],
    ports: [],
    correlationSets: [],
    messages: [],
    variables: [],
    hasAtomicTransactions: false,
    hasLongRunningTransactions: false,
    hasCompensation: false,
    hasBRECalls: false,
    hasSuspend: false,
    activatingReceiveCount: 0,
    ...overrides,
  };
}

describe('detectPatterns — empty application', () => {
  it('returns an array', () => {
    const result = detectPatterns(makeApp());
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns no patterns for empty app', () => {
    const result = detectPatterns(makeApp());
    expect(result.length).toBe(0);
  });
});

describe('detectPatterns — content-based routing', () => {
  const app = makeApp({
    orchestrations: [makeOrch({
      shapes: [
        // CBR requires both a DecisionShape AND at least one SendShape
        {
          shapeType: 'DecisionShape',
          shapeId: '1',
          conditionExpression: 'msgOrder.Priority == "High"',
        },
        { shapeType: 'SendShape', shapeId: '2' },
      ],
    })],
  });

  it('detects content-based routing from DecisionShape + SendShape', () => {
    const patterns = detectPatterns(app);
    const hasCbr = patterns.some(p =>
      p.includes('routing') ||
      p.includes('content')
    );
    expect(hasCbr).toBe(true);
  });
});

describe('detectPatterns — correlation / convoy', () => {
  const app = makeApp({
    orchestrations: [makeOrch({
      correlationSets: [
        { name: 'OrderCorrelation', correlationTypeRef: 'OrderId', correlationProperties: ['OrderId'] },
      ],
    })],
  });

  it('detects correlation-related pattern', () => {
    const patterns = detectPatterns(app);
    const hasConvoy = patterns.some(p =>
      p.includes('convoy') ||
      p.includes('correlat')
    );
    expect(hasConvoy).toBe(true);
  });
});

describe('detectPatterns — parallel actions / scatter-gather', () => {
  const app = makeApp({
    orchestrations: [makeOrch({
      shapes: [
        // scatter-gather requires ParallelActionsShape + at least 2 SendShapes
        { shapeType: 'ParallelActionsShape', shapeId: '1' },
        { shapeType: 'SendShape', shapeId: '2' },
        { shapeType: 'SendShape', shapeId: '3' },
      ],
    })],
  });

  it('detects scatter-gather or fan-out pattern', () => {
    const patterns = detectPatterns(app);
    const hasParallel = patterns.some(p =>
      p.includes('scatter') ||
      p.includes('parallel') ||
      p.includes('fan')
    );
    expect(hasParallel).toBe(true);
  });
});

describe('detectPatterns — return shape', () => {
  it('each pattern is a non-empty string', () => {
    const app = makeApp({
      orchestrations: [makeOrch({
        shapes: [
          { shapeType: 'DecisionShape', shapeId: '1' },
          { shapeType: 'SendShape', shapeId: '2' },
        ],
      })],
    });
    const patterns = detectPatterns(app);
    for (const p of patterns) {
      expect(typeof p).toBe('string');
      expect(p.length).toBeGreaterThan(0);
    }
  });
});
