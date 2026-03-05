/**
 * Estate Runner — Multi-Application Assessment Orchestrator
 *
 * Scans a root directory where each subdirectory contains one BizTalk application,
 * runs Stage 1 (parse, score, pattern detect) and Stage 2 (gap analysis, architecture)
 * on each, and produces an aggregated estate assessment report.
 *
 * Entirely local and deterministic — no AI enrichment, no API calls.
 * Safe to run on large estates (50+ applications) without API cost.
 */

import { readdirSync } from 'fs';
import { join } from 'path';

import { listArtifacts }       from '../mcp-server/tools/file-tools.js';
import { parseArtifacts }      from './artifact-parser.js';
import { scoreApplication }    from '../stage1-understand/complexity-scorer.js';
import { detectPatterns }      from '../stage1-understand/pattern-detector.js';
import { analyzeGaps }         from '../stage2-document/gap-analyzer.js';
import { recommendArchitecture } from '../stage2-document/architecture-recommender.js';
import { generateEstateReport } from './estate-report-generator.js';

import type {
  EstateRunOptions,
  EstateResult,
  AppAssessment,
  EstateTotals,
  EstateProgress,
} from './types.js';
import type { ComplexityClass } from '../types/migration.js';

// ─── Adapters known to have migration gaps ────────────────────────────────────

const ADAPTERS_WITH_KNOWN_GAPS = new Set([
  'WCF-NetNamedPipe',
  'WCF-NetTcp',
  'WCF-Custom',
  'WCF-CustomIsolated',
  'FTP',
  'SFTP',
  'MSMQ',
  'WCF-NetMsmq',
  'MQSeries',
  'WebSphere MQ',
  'SAP',
  'Siebel',
  'PeopleSoft',
  'JD Edwards',
  'Oracle',
]);

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function runEstateAssessment(options: EstateRunOptions): Promise<EstateResult> {
  const { estateDir, onProgress } = options;

  function progress(phase: EstateProgress['phase'], current: number, total: number, appName: string, message: string): void {
    onProgress?.({ phase, current, total, appName, message });
  }

  // ── SCAN: Discover all subdirectories ────────────────────────────────────────

  progress('scan', 0, 0, '', `Scanning ${estateDir}...`);

  let entries: string[];
  try {
    entries = readdirSync(estateDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch (err) {
    throw new Error(`Cannot read estate directory: ${err instanceof Error ? err.message : String(err)}`);
  }

  const total = entries.length;
  progress('scan', 0, total, '', `Found ${total} subdirector${total === 1 ? 'y' : 'ies'}`);

  // ── ANALYZE: Process each subdirectory ───────────────────────────────────────

  const assessments: AppAssessment[] = [];
  const failures: Array<{ name: string; dirPath: string; error: string }> = [];

  for (let i = 0; i < entries.length; i++) {
    const dirName = entries[i]!;
    const dirPath = join(estateDir, dirName);
    const current = i + 1;

    progress('analyze', current, total, dirName, 'Scanning artifacts...');

    try {
      // Discover artifacts
      const inventory = await listArtifacts(dirPath, true);
      const artifactCount =
        inventory.orchestrations.length +
        inventory.maps.length +
        inventory.pipelines.length +
        inventory.bindings.length;

      if (artifactCount === 0) {
        // Skip directories with no BizTalk artifacts
        continue;
      }

      progress('analyze', current, total, dirName, 'Parsing artifacts...');

      const errors: string[] = [];
      const app = await parseArtifacts(
        inventory,
        dirName,
        errors,
        (msg) => progress('analyze', current, total, dirName, msg)
      );

      progress('analyze', current, total, dirName, 'Scoring complexity...');
      const complexity = scoreApplication(app);

      progress('analyze', current, total, dirName, 'Detecting patterns...');
      const patterns = detectPatterns(app);

      progress('analyze', current, total, dirName, 'Analyzing gaps...');
      const gaps = analyzeGaps(app);

      progress('analyze', current, total, dirName, 'Recommending architecture...');
      const architecture = recommendArchitecture(app, gaps, patterns);

      const estimatedEffortDays = gaps.reduce(
        (sum, g) => sum + (g.estimatedEffortDays ?? 0),
        0
      );

      const wave = complexityToWave(complexity.classification);

      assessments.push({
        name: dirName,
        dirPath,
        app,
        complexity,
        gaps,
        patterns,
        architecture,
        estimatedEffortDays,
        wave,
      });

    } catch (err) {
      failures.push({
        name: dirName,
        dirPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── REPORT: Aggregate and generate ───────────────────────────────────────────

  progress('report', total, total, '', 'Aggregating estate totals...');

  const totals = computeTotals(assessments);

  progress('report', total, total, '', 'Generating estate report...');
  const report = generateEstateReport(assessments, failures, totals);

  return { assessments, failures, totals, report };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function complexityToWave(classification: ComplexityClass): 1 | 2 | 3 | 4 {
  switch (classification) {
    case 'simple':         return 1;
    case 'moderate':       return 2;
    case 'complex':        return 3;
    case 'highly-complex': return 4;
    default:               return 2;
  }
}

function computeTotals(assessments: AppAssessment[]): EstateTotals {
  const complexityDistribution: Record<ComplexityClass, number> = {
    simple: 0,
    moderate: 0,
    complex: 0,
    'highly-complex': 0,
  };

  // Adapter usage: adapter type → set of app names
  const adapterAppMap = new Map<string, Set<string>>();

  let orchestrations = 0;
  let maps = 0;
  let pipelines = 0;
  let schemas = 0;
  let totalGaps = 0;
  let criticalGaps = 0;
  let highGaps = 0;
  let mediumGaps = 0;
  let totalEstimatedEffortDays = 0;
  let requiresIntegrationAccount = 0;
  let requiresOnPremGateway = 0;

  for (const a of assessments) {
    orchestrations += a.app.orchestrations.length;
    maps += a.app.maps.length;
    pipelines += a.app.pipelines.length;
    schemas += a.app.schemas.length;
    totalGaps += a.gaps.length;
    criticalGaps += a.gaps.filter(g => g.severity === 'critical').length;
    highGaps += a.gaps.filter(g => g.severity === 'high').length;
    mediumGaps += a.gaps.filter(g => g.severity === 'medium').length;
    totalEstimatedEffortDays += a.estimatedEffortDays;
    complexityDistribution[a.complexity.classification]++;

    if (a.architecture.requiresIntegrationAccount) requiresIntegrationAccount++;
    if (a.architecture.requiresOnPremGateway) requiresOnPremGateway++;

    // Collect adapter types from binding files
    for (const b of a.app.bindingFiles) {
      for (const r of b.receiveLocations) {
        if (r.adapterType) {
          if (!adapterAppMap.has(r.adapterType)) adapterAppMap.set(r.adapterType, new Set());
          adapterAppMap.get(r.adapterType)!.add(a.name);
        }
      }
      for (const s of b.sendPorts) {
        if (s.adapterType) {
          if (!adapterAppMap.has(s.adapterType)) adapterAppMap.set(s.adapterType, new Set());
          adapterAppMap.get(s.adapterType)!.add(a.name);
        }
      }
    }
  }

  // Build adapter inventory sorted by app count descending
  const adapterInventory = [...adapterAppMap.entries()]
    .map(([adapterType, apps]) => ({
      adapterType,
      appCount: apps.size,
      hasKnownGaps: ADAPTERS_WITH_KNOWN_GAPS.has(adapterType),
    }))
    .sort((a, b) => b.appCount - a.appCount);

  return {
    applications: assessments.length,
    orchestrations,
    maps,
    pipelines,
    schemas,
    totalGaps,
    criticalGaps,
    highGaps,
    mediumGaps,
    totalEstimatedEffortDays,
    complexityDistribution,
    adapterInventory,
    requiresIntegrationAccount,
    requiresOnPremGateway,
  };
}
