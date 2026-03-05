/**
 * Unit tests for Estate Runner
 *
 * Tests the estate assessment pipeline using the existing test fixtures.
 * Fixtures 01-08 each live in their own subdirectory under tests/fixtures/,
 * making the fixture root directory an ideal estate test input.
 */

import { describe, it, expect, vi } from 'vitest';
import { join } from 'path';
import { runEstateAssessment } from '../../src/runner/estate-runner.js';
import { generateEstateReport } from '../../src/runner/estate-report-generator.js';
import type { AppAssessment, EstateTotals } from '../../src/runner/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FIXTURES_DIR = join(process.cwd(), 'tests/fixtures');

function makeMinimalAssessment(overrides: Partial<AppAssessment> = {}): AppAssessment {
  return {
    name: 'TestApp',
    dirPath: '/tmp/TestApp',
    app: {
      name: 'TestApp',
      biztalkVersion: 'unknown',
      orchestrations: [],
      maps: [],
      pipelines: [],
      schemas: [],
      bindingFiles: [],
      complexityScore: 5,
      complexityClassification: 'simple',
    },
    complexity: {
      totalScore: 5,
      classification: 'simple',
      contributors: [],
      summary: 'Simple app',
      hotSpots: [],
    },
    gaps: [],
    patterns: [],
    architecture: {
      targetSku: 'standard',
      workflowCount: 1,
      requiresIntegrationAccount: false,
      requiresOnPremGateway: false,
      requiresVnetIntegration: false,
      azureServicesRequired: ['logic-apps-standard', 'key-vault'],
      rationale: 'Simple migration',
    },
    estimatedEffortDays: 0,
    wave: 1,
    ...overrides,
  };
}

function makeMinimalTotals(overrides: Partial<EstateTotals> = {}): EstateTotals {
  return {
    applications: 1,
    orchestrations: 0,
    maps: 0,
    pipelines: 0,
    schemas: 0,
    totalGaps: 0,
    criticalGaps: 0,
    highGaps: 0,
    mediumGaps: 0,
    totalEstimatedEffortDays: 0,
    complexityDistribution: { simple: 1, moderate: 0, complex: 0, 'highly-complex': 0 },
    adapterInventory: [],
    requiresIntegrationAccount: 0,
    requiresOnPremGateway: 0,
    ...overrides,
  };
}

// ─── Estate Report Generator (pure unit tests, no I/O) ────────────────────────

describe('generateEstateReport — empty estate', () => {
  it('generates a report with header', () => {
    const report = generateEstateReport([], [], makeMinimalTotals({ applications: 0 }));
    expect(report).toContain('# BizTalk Estate Assessment Report');
  });

  it('includes date in header', () => {
    const report = generateEstateReport([], [], makeMinimalTotals({ applications: 0 }));
    const today = new Date().toISOString().split('T')[0];
    expect(report).toContain(today);
  });
});

describe('generateEstateReport — single application', () => {
  const assessment = makeMinimalAssessment();
  const totals = makeMinimalTotals();
  let report: string;

  beforeEach(() => {
    report = generateEstateReport([assessment], [], totals);
  });

  it('includes Estate Overview section', () => {
    expect(report).toContain('## Estate Overview');
  });

  it('includes Complexity Distribution section', () => {
    expect(report).toContain('## Complexity Distribution');
  });

  it('includes Application Inventory section', () => {
    expect(report).toContain('## Application Inventory');
  });

  it('includes the app name in the inventory', () => {
    expect(report).toContain('TestApp');
  });

  it('includes Migration Waves section', () => {
    expect(report).toContain('## Migration Waves');
  });

  it('assigns wave 1 for simple apps', () => {
    expect(report).toContain('Wave 1');
  });

  it('includes Effort Summary section', () => {
    expect(report).toContain('## Effort Summary');
  });

  it('ends with footer', () => {
    expect(report).toContain('BizTalk to Logic Apps Migration Framework');
  });
});

describe('generateEstateReport — failures section', () => {
  it('includes failures section when there are failures', () => {
    const failures = [{ name: 'BrokenApp', dirPath: '/tmp/BrokenApp', error: 'Parse error: invalid XML' }];
    const report = generateEstateReport([], failures, makeMinimalTotals({ applications: 0 }));
    expect(report).toContain('## Parse Failures');
    expect(report).toContain('BrokenApp');
    expect(report).toContain('Parse error: invalid XML');
  });

  it('omits failures section when there are no failures', () => {
    const report = generateEstateReport([], [], makeMinimalTotals());
    expect(report).not.toContain('## Parse Failures');
  });
});

describe('generateEstateReport — adapter inventory', () => {
  it('includes adapter inventory section when adapters are present', () => {
    const totals = makeMinimalTotals({
      adapterInventory: [
        { adapterType: 'FILE', appCount: 2, hasKnownGaps: false },
        { adapterType: 'WCF-NetNamedPipe', appCount: 1, hasKnownGaps: true },
      ],
    });
    const report = generateEstateReport([makeMinimalAssessment()], [], totals);
    expect(report).toContain('## Adapter Inventory');
    expect(report).toContain('FILE');
    expect(report).toContain('WCF-NetNamedPipe');
  });
});

describe('generateEstateReport — wave assignment', () => {
  it('assigns wave 1 to simple apps', () => {
    const a = makeMinimalAssessment({ complexity: { totalScore: 5, classification: 'simple', contributors: [], summary: '', hotSpots: [] }, wave: 1 });
    const report = generateEstateReport([a], [], makeMinimalTotals());
    expect(report).toContain('Wave 1');
  });

  it('assigns wave 4 to highly-complex apps', () => {
    const a = makeMinimalAssessment({
      complexity: { totalScore: 80, classification: 'highly-complex', contributors: [], summary: '', hotSpots: [] },
      wave: 4,
    });
    const totals = makeMinimalTotals({
      complexityDistribution: { simple: 0, moderate: 0, complex: 0, 'highly-complex': 1 },
    });
    const report = generateEstateReport([a], [], totals);
    expect(report).toContain('Wave 4');
  });
});

describe('generateEstateReport — gap heat map', () => {
  it('includes gap heat map when gaps are present', () => {
    const a = makeMinimalAssessment({
      gaps: [{
        capability: 'MSDTC Distributed Transactions',
        severity: 'critical',
        description: 'No 2PC in Azure',
        mitigation: 'Saga pattern',
        estimatedEffortDays: 5,
        affectedArtifacts: [],
      }],
    });
    const report = generateEstateReport([a], [], makeMinimalTotals({ totalGaps: 1, criticalGaps: 1 }));
    expect(report).toContain('## Gap Heat Map');
    expect(report).toContain('MSDTC Distributed Transactions');
  });
});

// ─── Estate Runner (integration test against fixtures) ────────────────────────

describe('runEstateAssessment — fixtures directory', () => {
  it('runs against test fixtures without throwing', async () => {
    const progressMessages: string[] = [];
    const result = await runEstateAssessment({
      estateDir: FIXTURES_DIR,
      outputPath: '/dev/null',
      onProgress: ({ message }) => progressMessages.push(message),
    });

    expect(result).toBeDefined();
    expect(result.assessments).toBeInstanceOf(Array);
    expect(result.failures).toBeInstanceOf(Array);
    expect(result.totals).toBeDefined();
    expect(result.report).toContain('# BizTalk Estate Assessment Report');
  }, 30_000);

  it('detects at least one BizTalk application in the fixtures', async () => {
    const result = await runEstateAssessment({
      estateDir: FIXTURES_DIR,
      outputPath: '/dev/null',
    });
    expect(result.assessments.length).toBeGreaterThan(0);
  }, 30_000);

  it('assigns a wave (1-4) to every assessment', async () => {
    const result = await runEstateAssessment({
      estateDir: FIXTURES_DIR,
      outputPath: '/dev/null',
    });
    for (const a of result.assessments) {
      expect([1, 2, 3, 4]).toContain(a.wave);
    }
  }, 30_000);

  it('generates EstateTotals with correct application count', async () => {
    const result = await runEstateAssessment({
      estateDir: FIXTURES_DIR,
      outputPath: '/dev/null',
    });
    expect(result.totals.applications).toBe(result.assessments.length);
  }, 30_000);

  it('reports progress events', async () => {
    const phases: string[] = [];
    await runEstateAssessment({
      estateDir: FIXTURES_DIR,
      outputPath: '/dev/null',
      onProgress: ({ phase }) => { if (!phases.includes(phase)) phases.push(phase); },
    });
    expect(phases).toContain('scan');
    expect(phases).toContain('analyze');
    expect(phases).toContain('report');
  }, 30_000);
});

describe('runEstateAssessment — invalid directory', () => {
  it('throws a descriptive error for non-existent directory', async () => {
    await expect(
      runEstateAssessment({ estateDir: '/non/existent/path', outputPath: '/dev/null' })
    ).rejects.toThrow(/Cannot read estate directory/);
  });
});
