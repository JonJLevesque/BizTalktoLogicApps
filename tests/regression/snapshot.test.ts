/**
 * Snapshot Tests — Stage 1 and Stage 2 deterministic outputs
 *
 * Validates that Stage 1 (parsing) and Stage 2 (analysis) produce stable,
 * deterministic outputs for the known fixture files. These snapshots catch
 * regressions in parser or analyzer logic that would otherwise only be
 * detected downstream in Stage 3 build failures.
 *
 * Snapshots are auto-created on first run (jest --updateSnapshot or -u).
 * When a parser or analyzer is intentionally changed, update snapshots with:
 *   npx jest tests/regression/snapshot.test.ts --updateSnapshot
 *
 * Fixtures used:
 *   02-simple-file-receive   — linear Receive→Transform→Send, FILE adapters
 *   03-content-based-routing — DecideShape CBR, three ports, two routes
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { analyzeOrchestrationXml } from '../../src/stage1-understand/orchestration-analyzer.js';
import { analyzeBindingsXml }      from '../../src/stage1-understand/binding-analyzer.js';
import { analyzeGaps }             from '../../src/stage2-document/gap-analyzer.js';
import type { BizTalkApplication } from '../../src/types/biztalk.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures');

function fixtureFile(fixtureName: string, relativePath: string): string {
  const fullPath = join(FIXTURES_DIR, fixtureName, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Fixture file not found: ${fullPath}`);
  }
  return readFileSync(fullPath, 'utf-8');
}

/**
 * Build a minimal BizTalkApplication from fixture data for gap analysis.
 * Uses parsedApplication from the training-pair.json.
 */
function buildAppFromFixture(fixtureName: string): BizTalkApplication {
  const trainingPair = JSON.parse(
    fixtureFile(fixtureName, 'training-pair.json')
  ) as Record<string, unknown>;

  const biztalkInput = trainingPair['biztalkInput'] as Record<string, unknown>;
  const parsed = biztalkInput['parsedApplication'] as BizTalkApplication;
  return parsed;
}

// ─── Snapshot — Fixture 02: Simple File Receive ───────────────────────────────

describe('Snapshot — 02-simple-file-receive — Stage 1', () => {
  const orchXml  = fixtureFile('02-simple-file-receive', 'orchestration/SimpleFileReceive.odx.xml');
  const bindXml  = fixtureFile('02-simple-file-receive', 'bindings/BindingInfo.xml');

  it('analyzeOrchestrationXml output is stable', () => {
    const result = analyzeOrchestrationXml(orchXml);
    // Snapshot the key structural fields — exclude volatile fields like filePath
    expect({
      name:                       result.name,
      namespace:                  result.namespace,
      shapeCount:                 result.shapes.length,
      portCount:                  result.ports.length,
      messageCount:               result.messages.length,
      correlationSetCount:        result.correlationSets.length,
      variableCount:              result.variables.length,
      hasAtomicTransactions:      result.hasAtomicTransactions,
      hasLongRunningTransactions: result.hasLongRunningTransactions,
      hasCompensation:            result.hasCompensation,
      hasBRECalls:                result.hasBRECalls,
      hasSuspend:                 result.hasSuspend,
      activatingReceiveCount:     result.activatingReceiveCount,
      // Shape types — normalized, order-stable
      shapeTypes:                 result.shapes.map(s => s.shapeType).sort(),
      // Port names and polarity
      ports:                      result.ports.map(p => ({ name: p.name, polarity: p.polarity })),
    }).toMatchSnapshot();
  });

  it('analyzeBindingsXml output is stable', () => {
    const result = analyzeBindingsXml(bindXml);
    expect({
      receiveLocationCount: result.receiveLocations.length,
      sendPortCount:        result.sendPorts.length,
      receiveLocations:     result.receiveLocations.map(rl => ({
        name:        rl.name,
        adapterType: rl.adapterType,
        isEnabled:   rl.isEnabled,
      })),
      sendPorts:            result.sendPorts.map(sp => ({
        name:        sp.name,
        adapterType: sp.adapterType,
        isDynamic:   sp.isDynamic,
        isTwoWay:    sp.isTwoWay,
      })),
    }).toMatchSnapshot();
  });
});

describe('Snapshot — 02-simple-file-receive — Stage 2', () => {
  it('analyzeGaps output is stable for simple file receive', () => {
    const app = buildAppFromFixture('02-simple-file-receive');
    const gaps = analyzeGaps(app);

    expect({
      gapCount:  gaps.length,
      // Only snapshot gap capabilities and severities — not full descriptions
      // which may change with wording improvements
      gapSummary: gaps.map(g => ({
        capability: g.capability,
        severity:   g.severity,
      })).sort((a, b) => a.capability.localeCompare(b.capability)),
    }).toMatchSnapshot();
  });
});

// ─── Snapshot — Fixture 03: Content-Based Routing ────────────────────────────

describe('Snapshot — 03-content-based-routing — Stage 1', () => {
  const orchXml  = fixtureFile('03-content-based-routing', 'orchestration/OrderRouter.odx.xml');
  const bindXml  = fixtureFile('03-content-based-routing', 'bindings/BindingInfo.xml');

  it('analyzeOrchestrationXml output is stable', () => {
    const result = analyzeOrchestrationXml(orchXml);
    expect({
      name:                       result.name,
      namespace:                  result.namespace,
      shapeCount:                 result.shapes.length,
      portCount:                  result.ports.length,
      messageCount:               result.messages.length,
      correlationSetCount:        result.correlationSets.length,
      variableCount:              result.variables.length,
      hasAtomicTransactions:      result.hasAtomicTransactions,
      hasLongRunningTransactions: result.hasLongRunningTransactions,
      hasCompensation:            result.hasCompensation,
      hasBRECalls:                result.hasBRECalls,
      hasSuspend:                 result.hasSuspend,
      activatingReceiveCount:     result.activatingReceiveCount,
      shapeTypes:                 result.shapes.map(s => s.shapeType).sort(),
      ports:                      result.ports.map(p => ({ name: p.name, polarity: p.polarity })),
    }).toMatchSnapshot();
  });

  it('analyzeBindingsXml output is stable', () => {
    const result = analyzeBindingsXml(bindXml);
    expect({
      receiveLocationCount: result.receiveLocations.length,
      sendPortCount:        result.sendPorts.length,
      receiveLocations:     result.receiveLocations.map(rl => ({
        name:        rl.name,
        adapterType: rl.adapterType,
        isEnabled:   rl.isEnabled,
      })),
      sendPorts:            result.sendPorts.map(sp => ({
        name:        sp.name,
        adapterType: sp.adapterType,
        isDynamic:   sp.isDynamic,
        isTwoWay:    sp.isTwoWay,
      })),
    }).toMatchSnapshot();
  });
});

describe('Snapshot — 03-content-based-routing — Stage 2', () => {
  it('analyzeGaps output is stable for content-based routing', () => {
    const app = buildAppFromFixture('03-content-based-routing');
    const gaps = analyzeGaps(app);

    expect({
      gapCount:  gaps.length,
      gapSummary: gaps.map(g => ({
        capability: g.capability,
        severity:   g.severity,
      })).sort((a, b) => a.capability.localeCompare(b.capability)),
    }).toMatchSnapshot();
  });
});

// ─── Snapshot — Cross-Fixture Comparisons ─────────────────────────────────────

describe('Snapshot — cross-fixture comparison', () => {
  it('simple file receive has fewer shapes than CBR fixture', () => {
    const orchXml02 = fixtureFile('02-simple-file-receive', 'orchestration/SimpleFileReceive.odx.xml');
    const orchXml03 = fixtureFile('03-content-based-routing', 'orchestration/OrderRouter.odx.xml');

    const result02 = analyzeOrchestrationXml(orchXml02);
    const result03 = analyzeOrchestrationXml(orchXml03);

    // Simple file receive (3 shapes: Receive, Construct/Transform, Send) should
    // have fewer top-level shapes than CBR (Receive + Decide + branches)
    expect(result02.shapes.length).toBeLessThanOrEqual(result03.shapes.length);
  });

  it('CBR fixture has more ports than simple file receive', () => {
    const orchXml02 = fixtureFile('02-simple-file-receive', 'orchestration/SimpleFileReceive.odx.xml');
    const orchXml03 = fixtureFile('03-content-based-routing', 'orchestration/OrderRouter.odx.xml');

    const result02 = analyzeOrchestrationXml(orchXml02);
    const result03 = analyzeOrchestrationXml(orchXml03);

    // CBR has 3 ports (1 receive + 2 send) vs simple file receive's 2 ports
    expect(result03.ports.length).toBeGreaterThan(result02.ports.length);
  });

  it('CBR binding file has more send ports than simple file receive', () => {
    const bindXml02 = fixtureFile('02-simple-file-receive', 'bindings/BindingInfo.xml');
    const bindXml03 = fixtureFile('03-content-based-routing', 'bindings/BindingInfo.xml');

    const result02 = analyzeBindingsXml(bindXml02);
    const result03 = analyzeBindingsXml(bindXml03);

    expect(result03.sendPorts.length).toBeGreaterThan(result02.sendPorts.length);
  });
});
