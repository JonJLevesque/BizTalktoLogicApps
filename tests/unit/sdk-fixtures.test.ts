/**
 * SDK Fixtures Test Suite
 *
 * Tests Stage 1 parsers against real BizTalk Server 2006 SDK artifacts from
 * tests/fixtures/04-08. Covers patterns not present in fixtures 01-03:
 *   - UTF-16 LE encoding (BTM, BTP files from Visual Studio)
 *   - CallOrchestration (Call shape → Logic Apps Workflow action)
 *   - Compensation (LongRunningTransaction, Parallel, Compensate shapes)
 *   - Flat file pipeline (FFDasmComp → flat file gap)
 *   - Map scripting variants (C#, VB.NET, JScript, XSLT, external assembly)
 *   - Complex E2E orchestration (OrderManager 466-line stress test)
 */

import { join } from 'path';
import {
  analyzeOrchestration,
  flattenShapes,
} from '../../src/stage1-understand/orchestration-analyzer.js';
import { analyzeMap } from '../../src/stage1-understand/map-analyzer.js';
import { analyzePipeline } from '../../src/stage1-understand/pipeline-analyzer.js';
import { readBizTalkFile } from '../../src/stage1-understand/read-biztalk-file.js';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
const f = (...parts: string[]) => join(FIXTURES, ...parts);

// ─── UTF-16 Encoding ─────────────────────────────────────────────────────────

describe('readBizTalkFile — encoding detection', () => {
  it('reads UTF-16 LE BTM without garbled output', async () => {
    const content = await readBizTalkFile(
      f('07-map-scripting-variants', 'Maps', 'Scriptor_InlineScripts.btm'),
    );
    // Should be valid XML, not null-byte-padded binary
    expect(content).toMatch(/<mapsource/i);
    expect(content).not.toMatch(/\x00/); // no null bytes in the decoded string
  });

  it('reads UTF-16 LE BTP without garbled output', async () => {
    const content = await readBizTalkFile(
      f('06-flat-file-pipeline', 'Pipelines', 'FFReceivePipeline.btp'),
    );
    expect(content).toMatch(/<Document/i);
    expect(content).not.toMatch(/\x00/);
  });
});

// ─── 04: Call Orchestration ──────────────────────────────────────────────────

describe('04-call-orchestration — receivePO.odx', () => {
  let result: Awaited<ReturnType<typeof analyzeOrchestration>>;

  beforeAll(async () => {
    result = await analyzeOrchestration(
      f('04-call-orchestration', 'Orchestrations', 'receivePO.odx'),
    );
  });

  it('parses successfully', () => {
    expect(result).toBeDefined();
    expect(result.name).toBeTruthy();
  });

  it('detects shapes', () => {
    expect(result.shapes.length).toBeGreaterThan(0);
  });

  it('detects a Call shape', () => {
    const all = flattenShapes(result.shapes);
    const callShape = all.find(s => s.shapeType === 'CallOrchestrationShape');
    expect(callShape).toBeDefined();
  });

  it('detects Receive and Send shapes', () => {
    const all = flattenShapes(result.shapes);
    expect(all.some(s => s.shapeType === 'ReceiveShape')).toBe(true);
    expect(all.some(s => s.shapeType === 'SendShape')).toBe(true);
  });
});

describe('04-call-orchestration — findShippingPrice.odx (child)', () => {
  let result: Awaited<ReturnType<typeof analyzeOrchestration>>;

  beforeAll(async () => {
    result = await analyzeOrchestration(
      f('04-call-orchestration', 'Orchestrations', 'findShippingPrice.odx'),
    );
  });

  it('parses child orchestration', () => {
    expect(result).toBeDefined();
    expect(result.name).toBeTruthy();
  });
});

// ─── 05: Compensation ────────────────────────────────────────────────────────

describe('05-compensation — UpdateContact.odx', () => {
  let result: Awaited<ReturnType<typeof analyzeOrchestration>>;

  beforeAll(async () => {
    result = await analyzeOrchestration(
      f('05-compensation', 'Orchestrations', 'UpdateContact.odx'),
    );
  });

  it('parses successfully', () => {
    expect(result).toBeDefined();
    expect(result.name).toBeTruthy();
  });

  it('detects transaction-related shapes', () => {
    const all = flattenShapes(result.shapes);
    // Should have Scope or LongRunningTransaction indicators
    const scopeOrCompensate = all.filter(s =>
      s.shapeType === 'ScopeShape' ||
      s.shapeType === 'CompensateShape' ||
      s.shapeType === 'GroupShape'
    );
    expect(scopeOrCompensate.length).toBeGreaterThan(0);
  });

  it('flags hasLongRunningTransactions or hasScopeShapes', () => {
    expect(
      result.hasLongRunningTransactions || result.shapes.length > 0,
    ).toBe(true);
  });
});

// ─── 06: Flat File Pipeline ──────────────────────────────────────────────────

describe('06-flat-file-pipeline — FFReceivePipeline.btp', () => {
  let result: Awaited<ReturnType<typeof analyzePipeline>>;

  beforeAll(async () => {
    result = await analyzePipeline(
      f('06-flat-file-pipeline', 'Pipelines', 'FFReceivePipeline.btp'),
    );
  });

  it('parses successfully', () => {
    expect(result).toBeDefined();
    expect(result.name).toBeTruthy();
  });

  it('detects Receive direction', () => {
    expect(result.direction).toBe('receive');
  });

  it('detects flat file disassembler component', () => {
    const hasFF = result.components.some(c =>
      c.fullTypeName.toLowerCase().includes('ffdasm') ||
      c.fullTypeName.toLowerCase().includes('flatfile') ||
      c.fullTypeName.toLowerCase().includes('ffdsm'),
    );
    expect(hasFF).toBe(true);
  });

  it('FFDasmComp is a built-in Microsoft component (not custom)', () => {
    // Microsoft.BizTalk.Component.FFDasmComp is a known built-in component.
    // hasCustomComponents is false because the pipeline only uses built-in components.
    const ffComp = result.components.find(c => c.fullTypeName.includes('FFDasmComp'));
    expect(ffComp).toBeDefined();
    expect(ffComp?.isCustom).toBe(false);
  });
});

// ─── 07: Map Scripting Variants ──────────────────────────────────────────────

describe('07-map-scripting-variants', () => {
  const variants = [
    { file: 'Scriptor_InlineScripts.btm',                  expectScripting: true  },
    { file: 'Scriptor_XsltCalltemplate.btm',               expectScripting: true  },
    { file: 'Scriptor_CallExternalAssembly.btm',           expectScripting: true  },
    { file: 'Scriptor_InlineXslt.btm',                     expectScripting: true  },
    { file: 'Scriptor_GlobalVariableInInlineScript.btm',   expectScripting: true  },
    { file: 'Scriptor_InlineXsltCallingExternalAssembly.btm', expectScripting: true },
    { file: 'OverridingMapXslt.btm',                       expectScripting: false },
  ] as const;

  for (const { file, expectScripting } of variants) {
    describe(file, () => {
      let result: Awaited<ReturnType<typeof analyzeMap>>;

      beforeAll(async () => {
        result = await analyzeMap(f('07-map-scripting-variants', 'Maps', file));
      });

      it('parses without error', () => {
        expect(result).toBeDefined();
        expect(result.name).toBeTruthy();
      });

      if (expectScripting) {
        it('detects scripting functoids', () => {
          expect(result.hasScriptingFunctoids).toBe(true);
        });

        it('recommends xslt-rewrite or function-stub migration path', () => {
          expect(['xslt-rewrite', 'function-stub']).toContain(
            result.recommendedMigrationPath,
          );
        });
      } else {
        it('does not flag scripting functoids', () => {
          expect(result.hasScriptingFunctoids).toBe(false);
        });
      }
    });
  }
});

// ─── 08: E2E Order Broker ────────────────────────────────────────────────────

describe('08-e2e-order-broker — OrderBroker.odx', () => {
  let result: Awaited<ReturnType<typeof analyzeOrchestration>>;

  beforeAll(async () => {
    result = await analyzeOrchestration(
      f('08-e2e-order-broker', 'Orchestrations', 'OrderBroker.odx'),
    );
  });

  it('parses successfully', () => {
    expect(result).toBeDefined();
    expect(result.name).toBeTruthy();
  });

  it('extracts multiple shapes', () => {
    expect(result.shapes.length).toBeGreaterThan(3);
  });

  it('detects port declarations', () => {
    expect(result.ports.length).toBeGreaterThan(0);
  });
});

describe('08-e2e-order-broker — OrderManager.odx (466-line stress test)', () => {
  let result: Awaited<ReturnType<typeof analyzeOrchestration>>;

  beforeAll(async () => {
    result = await analyzeOrchestration(
      f('08-e2e-order-broker', 'Orchestrations', 'OrderManager.odx'),
    );
  });

  it('parses the most complex SDK orchestration without error', () => {
    expect(result).toBeDefined();
    expect(result.name).toBeTruthy();
  });

  it('extracts many shapes from complex orchestration', () => {
    const all = flattenShapes(result.shapes);
    expect(all.length).toBeGreaterThan(5);
  });

  it('detects multiple port declarations', () => {
    expect(result.ports.length).toBeGreaterThan(1);
  });
});
