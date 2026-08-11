/**
 * Unit tests for Stage 1 — Intent Constructor
 *
 * Focuses on the Stage1→Stage3 contract fields that the workflow generator
 * consumes: handlesErrorFrom (Scope Catch handlers), loopConfig (Until/Foreach),
 * and step chaining around extracted catch handlers.
 */

import { constructIntent } from '../../src/stage1-understand/intent-constructor.js';
import type { BizTalkApplication, OdxShape, ParsedOrchestration } from '../../src/types/biztalk.js';

// ─── Fixture Builders ─────────────────────────────────────────────────────────

function makeOrchestration(shapes: OdxShape[]): ParsedOrchestration {
  return {
    name: 'TestOrchestration',
    namespace: 'Test.Namespace',
    filePath: 'TestOrchestration.odx',
    shapes,
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
  };
}

function makeApp(shapes: OdxShape[]): BizTalkApplication {
  return {
    name: 'TestApp',
    biztalkVersion: 'unknown',
    orchestrations: [makeOrchestration(shapes)],
    maps: [],
    pipelines: [],
    schemas: [],
    bindingFiles: [],
    complexityScore: 0,
    complexityClassification: 'simple',
  };
}

// ─── Scope Catch → handlesErrorFrom ───────────────────────────────────────────

describe('constructIntent — Scope Catch handlers', () => {
  const shapes: OdxShape[] = [
    {
      shapeType: 'ScopeShape',
      shapeId: 's1',
      name: 'MainScope',
      children: [
        {
          shapeType: 'ExpressionShape',
          shapeId: 's2',
          name: 'BodyWork',
          codeExpression: 'counter = 1;',
        },
        {
          shapeType: 'GroupShape',
          shapeId: 's3',
          name: 'CatchOrderError',
          children: [
            {
              shapeType: 'ExpressionShape',
              shapeId: 's4',
              name: 'LogError',
              codeExpression: 'errorMsg = "failed";',
            },
          ],
        },
      ],
    },
    {
      shapeType: 'SendShape',
      shapeId: 's5',
      name: 'SendResult',
    },
  ];
  const intent = constructIntent(makeApp(shapes));

  const scopeStep = intent.steps.find(s => s.id === 'step_MainScope_scope');
  const catchStep = intent.steps.find(s => s.handlesErrorFrom !== undefined);

  it('emits a sibling catch step with handlesErrorFrom pointing at the scope', () => {
    expect(scopeStep).toBeDefined();
    expect(catchStep).toBeDefined();
    expect(catchStep?.handlesErrorFrom).toBe(scopeStep?.id);
    expect(catchStep?.type).toBe('error-handler');
    expect(catchStep?.actionType).toBe('Scope');
  });

  it('moves the Catch handler steps into the catch step body', () => {
    expect(catchStep?.branches?.trueBranch?.length).toBe(1);
    expect(catchStep?.branches?.trueBranch?.[0]?.description).toContain('errorMsg');
  });

  it('removes the Catch content from the scope step falseBranch', () => {
    expect(scopeStep?.branches?.falseBranch).toBeUndefined();
    expect(scopeStep?.branches?.trueBranch?.length).toBe(1);
  });

  it('chains the next step after the scope (success path), not the catch handler', () => {
    const sendStep = intent.steps.find(s => s.type === 'send');
    expect(sendStep?.runAfter).toEqual([scopeStep?.id]);
  });
});

// ─── LoopShape → loopConfig ───────────────────────────────────────────────────

describe('constructIntent — loopConfig', () => {
  it('populates loopConfig.untilExpression with the inversion marker for while loops', () => {
    const intent = constructIntent(makeApp([
      {
        shapeType: 'LoopShape',
        shapeId: 'l1',
        name: 'RetryLoop',
        conditionExpression: 'counter < 3',
        children: [
          { shapeType: 'ExpressionShape', shapeId: 'l2', name: 'Inc', codeExpression: 'counter = counter + 1;' },
        ],
      },
    ]));

    const loopStep = intent.steps.find(s => s.type === 'loop');
    expect(loopStep?.actionType).toBe('Until');
    expect(loopStep?.loopConfig?.untilExpression).toBe('TODO_CLAUDE_INVERT: counter < 3');
    expect(loopStep?.loopConfig?.iterateOver).toBeUndefined();
    expect(loopStep?.branches?.trueBranch?.length).toBe(1);
  });

  it('marks enumerator loops (MoveNext) as Foreach with loopConfig.iterateOver', () => {
    const intent = constructIntent(makeApp([
      {
        shapeType: 'LoopShape',
        shapeId: 'l1',
        name: 'ItemLoop',
        conditionExpression: 'orderEnum.MoveNext()',
        children: [
          { shapeType: 'ExpressionShape', shapeId: 'l2', name: 'Handle', codeExpression: 'current = 1;' },
        ],
      },
    ]));

    const loopStep = intent.steps.find(s => s.type === 'loop');
    expect(loopStep?.actionType).toBe('Foreach');
    expect(loopStep?.loopConfig?.iterateOver).toBeDefined();
    expect(loopStep?.loopConfig?.iterateOver).toContain('TODO_CLAUDE');
    expect(loopStep?.loopConfig?.iterateOver).toContain('orderEnum');
  });
});
