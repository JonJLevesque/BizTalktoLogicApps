/**
 * Migration Runner — Automated 5-Step Pipeline Engine
 *
 * The single function that orchestrates the full BizTalk → Logic Apps migration:
 *
 *   PARSE    (local, deterministic) — read artifacts, analyze, construct intent
 *   REASON   (Claude, AI-powered)   — enrich TODO_CLAUDE markers, validate intent
 *   SCAFFOLD (local, deterministic) — generate migration spec, build Logic Apps package
 *   VALIDATE (local, deterministic) — check workflow.json rules, score quality
 *   REVIEW   (Claude, conditional)  — fix errors / improve grade if < B (max 2 iterations)
 *   REPORT   (local, deterministic) — generate migration-report.md
 *
 * Only REASON and REVIEW require Claude. Everything else runs locally in <1 second.
 * Privacy: raw XML never leaves the machine — only structural metadata goes to Claude.
 */

import type { BizTalkApplication } from '../types/biztalk.js';
import type { WorkflowJson } from '../types/logicapps.js';
import type { IntegrationIntent, IntegrationPattern } from '../shared/integration-intent.js';
import type { MigrationRunOptions, MigrationRunResult, MigrationStep } from './types.js';

import { listArtifacts, readArtifact }  from '../mcp-server/tools/file-tools.js';
import { analyzeOrchestration, analyzeOrchestrationXml } from '../stage1-understand/orchestration-analyzer.js';
import { analyzeMap, analyzeMapXml }    from '../stage1-understand/map-analyzer.js';
import { analyzePipelineXml }           from '../stage1-understand/pipeline-analyzer.js';
import { analyzeBindingsXml }           from '../stage1-understand/binding-analyzer.js';
import { scoreApplication }             from '../stage1-understand/complexity-scorer.js';
import { detectPatterns }               from '../stage1-understand/pattern-detector.js';
import { constructIntent }              from '../stage1-understand/intent-constructor.js';
import { validateIntegrationIntent }    from '../shared/intent-validator.js';
import { analyzeGaps }                  from '../stage2-document/gap-analyzer.js';
import { generateMigrationResult }      from '../stage2-document/migration-spec-generator.js';
import { buildPackage }                 from '../stage3-build/package-builder.js';
import { validateWorkflow }             from '../validation/workflow-validator.js';
import { validateConnections }          from '../validation/connections-validator.js';
import { scoreWorkflowQuality }         from '../validation/quality-scorer.js';
import { ClaudeClient }                 from './claude-client.js';
import { generateMigrationReport }      from './report-generator.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runMigration(options: MigrationRunOptions): Promise<MigrationRunResult> {
  const { artifactDir, appName, outputDir, onProgress, skipEnrichment } = options;

  const errors: string[] = [];
  const warnings: string[] = [];
  const timings: Partial<Record<MigrationStep, number>> = {};
  const client = new ClaudeClient();

  function progress(step: MigrationStep, message: string, detail?: string): void {
    onProgress?.({ step, message, ...(detail !== undefined ? { detail } : {}) });
  }

  function time<T>(step: MigrationStep, fn: () => T): T {
    const start = Date.now();
    const result = fn();
    timings[step] = Date.now() - start;
    return result;
  }

  async function timeAsync<T>(step: MigrationStep, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    const result = await fn();
    timings[step] = (timings[step] ?? 0) + (Date.now() - start);
    return result;
  }

  // ── STEP 1: PARSE ──────────────────────────────────────────────────────────

  progress('parse', `Scanning artifacts in ${artifactDir}...`);

  const inventory = await timeAsync('parse', () => listArtifacts(artifactDir, true));
  const totalArtifacts =
    inventory.orchestrations.length +
    inventory.maps.length +
    inventory.pipelines.length +
    inventory.bindings.length;

  if (totalArtifacts === 0) {
    return {
      success: false,
      migrationReport: `# Migration Failed\n\nNo BizTalk artifacts found in: ${artifactDir}\n\nExpected .odx, .btm, .btp, or BindingInfo.xml files.`,
      errors: [`No artifacts found in ${artifactDir}`],
      warnings: [],
      timings,
    };
  }

  progress('parse', `Found ${totalArtifacts} artifacts`, `${inventory.orchestrations.length} orchestrations, ${inventory.maps.length} maps, ${inventory.pipelines.length} pipelines, ${inventory.bindings.length} bindings`);

  const app = await timeAsync('parse', () => parseArtifacts(inventory, appName, errors, (msg) => progress('parse', msg)));

  // ── STEP 2: REASON ─────────────────────────────────────────────────────────

  const patterns = time('reason', () => detectPatterns(app) as IntegrationPattern[]);
  const partialIntent = time('reason', () => constructIntent(app, patterns));
  let enrichedIntent: IntegrationIntent = partialIntent;

  if (!skipEnrichment) {
    progress('reason', `Enriching with AI (${client.clientMode} mode)...`);

    const gaps = analyzeGaps(app);
    const gapSummary =
      gaps.length > 0
        ? `${gaps.filter(g => g.severity === 'critical').length} critical, ${gaps.filter(g => g.severity === 'high').length} high, ${gaps.filter(g => g.severity === 'medium').length} medium gaps`
        : 'No gaps detected';

    const enrichmentResult = await timeAsync('reason', () =>
      client.enrich({
        partialIntent,
        appName,
        patterns: patterns as string[],
        gapSummary,
      })
    );

    if (enrichmentResult.notes?.startsWith('Enrichment failed')) {
      warnings.push(enrichmentResult.notes);
    }
    enrichedIntent = enrichmentResult.enrichedIntent;
  } else {
    progress('reason', 'Enrichment skipped (skipEnrichment=true)');
    timings['reason'] = 0;
  }

  // Validate intent before building
  const intentValidation = validateIntegrationIntent(enrichedIntent);
  if (!intentValidation.valid) {
    // Non-fatal: proceed with partial intent, record errors
    for (const e of intentValidation.errors) {
      errors.push(`Intent validation: ${e}`);
    }
  }

  // ── STEP 3: SCAFFOLD ───────────────────────────────────────────────────────

  progress('scaffold', 'Generating Logic Apps package...');

  const migrationResult = time('scaffold', () => generateMigrationResult(app, enrichedIntent));

  const buildResult = time('scaffold', () =>
    buildPackage(migrationResult, {
      appName,
      wrapInScope: true,
      includeTests: true,
      includeInfrastructure: true,
    })
  );
  warnings.push(...buildResult.warnings);

  // ── STEP 4: VALIDATE ───────────────────────────────────────────────────────

  progress('validate', 'Validating generated workflows...');

  // Validate each workflow and collect issues
  let worstGrade: 'A' | 'B' | 'C' | 'D' | 'F' = 'A';
  let lowestScore = 100;
  let qualityReport: import('../validation/quality-scorer.js').QualityReport | undefined;

  const connectionsJson = buildResult.project.connections;
  let workflowsToValidate = buildResult.project.workflows.map(wf => ({
    name: wf.name,
    json: JSON.stringify(wf.workflow),
    workflow: wf.workflow as WorkflowJson,
  }));

  for (const wf of workflowsToValidate) {
    const wfValidation = time('validate', () => validateWorkflow(wf.workflow));
    const connValidation = time('validate', () => validateConnections(connectionsJson, wf.workflow));
    const quality = time('validate', () => scoreWorkflowQuality(wf.workflow, enrichedIntent));

    for (const issue of wfValidation.issues) {
      if (issue.severity === 'error') errors.push(`[${wf.name}] ${issue.message}`);
      else if (issue.severity === 'warning') warnings.push(`[${wf.name}] ${issue.message}`);
    }
    for (const issue of connValidation.issues) {
      if (issue.severity === 'error') errors.push(`[${wf.name} connections] ${issue.message}`);
    }

    if (quality.totalScore < lowestScore) {
      lowestScore = quality.totalScore;
      worstGrade = quality.grade;
      qualityReport = quality;
    }
  }

  progress('validate', `Quality: ${lowestScore}/100 Grade ${worstGrade}`);

  // ── STEP 5: REVIEW (conditional) ─────────────────────────────────────────

  const needsReview = !skipEnrichment && (gradeValue(worstGrade) < gradeValue('B') || errors.some(e => !e.startsWith('Intent validation')));

  if (needsReview) {
    progress('review', `Reviewing and fixing workflows (grade ${worstGrade})...`);

    for (let iteration = 0; iteration < 2; iteration++) {
      let improved = false;

      for (let i = 0; i < workflowsToValidate.length; i++) {
        const wf = workflowsToValidate[i]!;
        const currentValidation = validateWorkflow(wf.workflow);
        const currentQuality = scoreWorkflowQuality(wf.workflow, enrichedIntent);

        if (currentValidation.errorCount === 0 && gradeValue(currentQuality.grade) >= gradeValue('B')) {
          continue; // This workflow is already good enough
        }

        const reviewResult = await timeAsync('review', () =>
          client.review({
            workflowJson: wf.json,
            validationIssues: currentValidation,
            currentGrade: currentQuality.grade,
            currentScore: currentQuality.totalScore,
          })
        );

        if (reviewResult.changesApplied.length > 0) {
          try {
            const fixedWorkflow = JSON.parse(reviewResult.fixedWorkflowJson) as WorkflowJson;
            const reValidated = validateWorkflow(fixedWorkflow);
            const reScored = scoreWorkflowQuality(fixedWorkflow, enrichedIntent);

            if (reScored.totalScore >= currentQuality.totalScore) {
              // Update workflow in place
              workflowsToValidate[i] = {
                ...wf,
                json: reviewResult.fixedWorkflowJson,
                workflow: fixedWorkflow,
              };
              // Update build result
              const bwf = buildResult.project.workflows.find(w => w.name === wf.name);
              if (bwf) bwf.workflow = fixedWorkflow as typeof bwf.workflow;

              qualityReport = reScored;
              lowestScore = reScored.totalScore;
              worstGrade = reScored.grade;
              improved = true;

              // Clear errors that were fixed
              for (const change of reviewResult.changesApplied) {
                warnings.push(`[${wf.name}] Fixed: ${change}`);
              }
              // Remove fixed errors from the list
              const fixedRuleIds = new Set(reValidated.issues.map(i => i.rule));
              errors.splice(
                0,
                errors.length,
                ...errors.filter(e => !fixedRuleIds.has(e.split(']')[0]?.replace('[', '') ?? ''))
              );
            }
          } catch {
            // Ignore parse failure on reviewed JSON
          }
        }
      }

      if (!improved) break; // No improvement — stop iterating
    }

    progress('review', `After review: ${lowestScore}/100 Grade ${worstGrade}`);
  }

  // ── STEP 6: REPORT ────────────────────────────────────────────────────────

  progress('report', 'Generating migration report...');

  const firstWorkflow = buildResult.project.workflows[0]?.workflow as WorkflowJson | undefined;
  const finalQualityReport = qualityReport ?? scoreWorkflowQuality(firstWorkflow ?? { definition: { $schema: '', contentVersion: '', triggers: {}, actions: {} }, kind: 'Stateful' }, enrichedIntent);

  const migrationReport = time('report', () =>
    generateMigrationReport({
      app,
      buildResult,
      qualityReport: finalQualityReport,
      gaps: analyzeGaps(app),
      patterns,
      outputDir,
      errors,
      warnings,
      timings,
      clientMode: client.clientMode,
    })
  );

  const result: MigrationRunResult = {
    success: true,
    buildResult,
    migrationReport,
    errors,
    warnings,
    timings,
  };
  if (finalQualityReport !== undefined) {
    result.qualityReport = finalQualityReport;
  }
  return result;
}

// ─── Internal: Parse Artifacts ────────────────────────────────────────────────

async function parseArtifacts(
  inventory: Awaited<ReturnType<typeof listArtifacts>>,
  appName: string,
  errors: string[],
  onStep: (msg: string) => void
): Promise<BizTalkApplication> {
  const orchestrations: ReturnType<typeof analyzeOrchestrationXml>[] = [];
  const maps: ReturnType<typeof analyzeMapXml>[] = [];
  const pipelines: ReturnType<typeof analyzePipelineXml>[] = [];
  const bindingFiles: ReturnType<typeof analyzeBindingsXml>[] = [];

  for (const f of inventory.orchestrations) {
    try {
      onStep(`Parsing orchestration: ${f.split('/').pop()}`);
      // Use analyzeOrchestration (not analyzeOrchestrationXml) — it calls readBizTalkFile
      // which handles UTF-16 LE encoding and strips the #if __DESIGNER_DATA preprocessor block.
      orchestrations.push(await analyzeOrchestration(f));
    } catch (err) {
      errors.push(`Failed to parse orchestration ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const f of inventory.maps) {
    try {
      onStep(`Parsing map: ${f.split('/').pop()}`);
      // Use analyzeMap (not analyzeMapXml) — it calls readBizTalkFile for UTF-16 LE support.
      maps.push(await analyzeMap(f));
    } catch (err) {
      errors.push(`Failed to parse map ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const f of inventory.pipelines) {
    try {
      onStep(`Parsing pipeline: ${f.split('/').pop()}`);
      const artifact = await readArtifact(f);
      pipelines.push(analyzePipelineXml(artifact.content));
    } catch (err) {
      errors.push(`Failed to parse pipeline ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const f of inventory.bindings) {
    try {
      onStep(`Parsing bindings: ${f.split('/').pop()}`);
      const artifact = await readArtifact(f);
      bindingFiles.push(analyzeBindingsXml(artifact.content));
    } catch (err) {
      errors.push(`Failed to parse bindings ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const app: BizTalkApplication = {
    name: appName,
    biztalkVersion: 'unknown',
    orchestrations,
    maps,
    pipelines,
    schemas: [],
    bindingFiles,
    complexityScore: 0,
    complexityClassification: 'moderate',
  };

  const complexity = scoreApplication(app);
  app.complexityScore = complexity.totalScore;
  app.complexityClassification = complexity.classification;

  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gradeValue(grade: string): number {
  switch (grade) {
    case 'A': return 5;
    case 'B': return 4;
    case 'C': return 3;
    case 'D': return 2;
    case 'F': return 1;
    default:  return 0;
  }
}
