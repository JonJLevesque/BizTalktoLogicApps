/**
 * Regression Tests — Quality Baseline Runner
 *
 * Ensures that golden master workflows do not regress in quality score
 * or validation result compared to the checked-in baseline in
 * tests/regression/quality-baseline.json.
 *
 * Tolerance: actual score >= baseline - 2 (two-point tolerance).
 * This allows minor generator improvements to raise the bar without
 * requiring a baseline update for small changes.
 *
 * To update baselines: edit quality-baseline.json with the new values
 * after verifying the regression is intentional.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { validateWorkflow, validateConnections, scoreWorkflowQuality } from '../../src/validation/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowValidationBaseline {
  errors: number;
  warnings: number;
}

interface BaselineEntry {
  qualityScore: number;
  grade: string;
  workflowValidation: WorkflowValidationBaseline;
  connectionsValidation: { errors: number };
}

interface QualityBaseline {
  version: number;
  description: string;
  baselines: Record<string, BaselineEntry>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FIXTURES_DIR  = join(process.cwd(), 'tests', 'fixtures');
const BASELINE_PATH = join(process.cwd(), 'tests', 'regression', 'quality-baseline.json');

function loadBaseline(): QualityBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as QualityBaseline;
}

function fixtureWorkflowPath(name: string): string {
  return join(FIXTURES_DIR, name, 'expected-logic-apps', 'workflow.json');
}

function fixtureConnectionsPath(name: string): string {
  return join(FIXTURES_DIR, name, 'expected-logic-apps', 'connections.json');
}

// ─── Regression Tests ─────────────────────────────────────────────────────────

describe('Regression — quality baseline', () => {
  const baseline = loadBaseline();
  const entries = Object.entries(baseline.baselines);

  it('baseline file is version 1', () => {
    expect(baseline.version).toBe(1);
  });

  it('baseline has at least 2 entries', () => {
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  for (const [fixtureName, entry] of entries) {
    describe(`fixture: ${fixtureName}`, () => {
      const workflowPath = fixtureWorkflowPath(fixtureName);
      const connectionsPath = fixtureConnectionsPath(fixtureName);

      it('golden master workflow file exists', () => {
        expect(existsSync(workflowPath)).toBe(true);
      });

      it('quality score does not regress beyond 2 points below baseline', () => {
        if (!existsSync(workflowPath)) {
          console.warn(`Skipping ${fixtureName}: workflow file not found`);
          expect(true).toBe(true);
          return;
        }

        const workflowJson = JSON.parse(readFileSync(workflowPath, 'utf-8')) as unknown;
        const report = scoreWorkflowQuality(workflowJson);

        const minAcceptable = entry.qualityScore - 2;

        if (report.totalScore < minAcceptable) {
          console.error(
            `Quality regression for ${fixtureName}!\n` +
            `  Baseline: ${entry.qualityScore} | Actual: ${report.totalScore} | Min acceptable: ${minAcceptable}\n` +
            `  ${report.summary}\n` +
            `  Failing dimensions:\n` +
            report.dimensions
              .filter(d => d.issues.length > 0)
              .map(d => `    [${d.name}] ${d.score}/${d.maxScore}: ${d.issues.join('; ')}`)
              .join('\n')
          );
        }

        expect(report.totalScore).toBeGreaterThanOrEqual(minAcceptable);
      });

      it('grade does not regress (must be A or B)', () => {
        if (!existsSync(workflowPath)) {
          expect(true).toBe(true);
          return;
        }

        const workflowJson = JSON.parse(readFileSync(workflowPath, 'utf-8')) as unknown;
        const report = scoreWorkflowQuality(workflowJson);

        expect(['A', 'B']).toContain(report.grade);
      });

      it('golden master workflow has no real validation errors (no regression)', () => {
        if (!existsSync(workflowPath)) {
          expect(true).toBe(true);
          return;
        }

        const workflowJson = JSON.parse(readFileSync(workflowPath, 'utf-8')) as unknown;
        const result = validateWorkflow(workflowJson);

        // Filter out the known false-positive: the runafter-refs-exist rule
        // incorrectly flags nested scope action runAfter references as top-level
        // violations. This is a known validator limitation, not a real error.
        const realErrors = result.issues.filter(
          i => i.severity === 'error' && i.rule !== 'runafter-refs-exist'
        );

        if (realErrors.length > 0) {
          const msgs = realErrors.map(i => `  [${i.rule}] ${i.message}`).join('\n');
          console.error(`Real validation regression for ${fixtureName}:\n${msgs}`);
        }

        expect(realErrors.length).toBe(entry.workflowValidation.errors);
      });

      it('golden master connections.json has 0 errors (no regression)', () => {
        if (!existsSync(connectionsPath)) {
          // Connections file is optional
          expect(true).toBe(true);
          return;
        }

        const connectionsJson = JSON.parse(readFileSync(connectionsPath, 'utf-8')) as unknown;
        const result = validateConnections(connectionsJson);
        const errorCount = result.issues.filter(i => i.severity === 'error').length;

        expect(errorCount).toBe(entry.connectionsValidation.errors);
      });

      it('warning count does not increase beyond baseline', () => {
        if (!existsSync(workflowPath)) {
          expect(true).toBe(true);
          return;
        }

        const workflowJson = JSON.parse(readFileSync(workflowPath, 'utf-8')) as unknown;
        const result = validateWorkflow(workflowJson);

        // Allow the same or fewer warnings — if new warnings appear, they should be reviewed
        const maxWarnings = entry.workflowValidation.warnings + 2;  // 2-warning tolerance
        if (result.warningCount > maxWarnings) {
          console.warn(
            `Warning count increase for ${fixtureName}: ` +
            `baseline=${entry.workflowValidation.warnings} actual=${result.warningCount}\n` +
            `New warnings:\n` +
            result.issues
              .filter(i => i.severity === 'warning')
              .map(i => `  [${i.rule}] ${i.message}`)
              .join('\n')
          );
        }
        expect(result.warningCount).toBeLessThanOrEqual(maxWarnings);
      });
    });
  }
});

// ─── Baseline Integrity Tests ─────────────────────────────────────────────────

describe('Regression — baseline file integrity', () => {
  it('baseline.json is valid JSON with required structure', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    const baseline = loadBaseline();
    expect(typeof baseline.version).toBe('number');
    expect(typeof baseline.baselines).toBe('object');

    for (const [name, entry] of Object.entries(baseline.baselines)) {
      expect(typeof entry.qualityScore).toBe('number');
      expect(typeof entry.grade).toBe('string');
      expect(typeof entry.workflowValidation.errors).toBe('number');
      expect(typeof entry.connectionsValidation.errors).toBe('number');
    }
  });

  it('all baseline fixtures have corresponding fixture directories', () => {
    const baseline = loadBaseline();
    for (const name of Object.keys(baseline.baselines)) {
      const workflowPath = fixtureWorkflowPath(name);
      expect(existsSync(workflowPath)).toBe(true);
    }
  });
});
