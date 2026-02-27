/**
 * Migration Report Generator
 *
 * Produces a consultant-ready migration-report.md with:
 *   - Executive Summary table
 *   - Gap analysis table
 *   - Architecture recommendation
 *   - Generated artifacts inventory
 *   - Quality score and grade
 *   - Deployment instructions
 *   - Manual next steps
 *   - Warnings list
 *
 * Support: Me@Jonlevesque.com
 */

import type { BizTalkApplication } from '../types/biztalk.js';
import type { BuildResult } from '../stage3-build/package-builder.js';
import type { QualityReport } from '../validation/quality-scorer.js';
import type { MigrationGap } from '../types/migration.js';
import type { IntegrationPattern } from '../shared/integration-intent.js';
import type { MigrationStep } from './types.js';

export interface ReportInput {
  app: BizTalkApplication;
  buildResult: BuildResult;
  qualityReport: QualityReport;
  gaps: MigrationGap[];
  patterns?: IntegrationPattern[];
  outputDir: string;
  errors: string[];
  warnings: string[];
  timings: Partial<Record<MigrationStep, number>>;
  clientMode: 'proxy' | 'direct' | 'dev';
}

// ── Pattern display metadata ──────────────────────────────────────────────────

type PatternSupport = 'auto' | 'partial' | 'redesign';

interface PatternDisplayInfo {
  displayName: string;
  support: PatternSupport;
  logicAppsEquivalent: string;
}

const PATTERN_DISPLAY_MAP: Partial<Record<IntegrationPattern, PatternDisplayInfo>> = {
  'content-based-routing': {
    displayName: 'Content-Based Router',
    support: 'auto',
    logicAppsEquivalent: 'If / Switch action',
  },
  'message-filter': {
    displayName: 'Message Filter',
    support: 'auto',
    logicAppsEquivalent: 'Condition + terminate branch',
  },
  'request-reply': {
    displayName: 'Request-Reply',
    support: 'auto',
    logicAppsEquivalent: 'Request trigger + Response action',
  },
  'wire-tap': {
    displayName: 'Wire Tap',
    support: 'auto',
    logicAppsEquivalent: 'Additional ServiceProvider send action',
  },
  'dead-letter-queue': {
    displayName: 'Dead Letter Queue',
    support: 'auto',
    logicAppsEquivalent: 'Scope + Terminate on FAILED runAfter',
  },
  'claim-check': {
    displayName: 'Claim Check',
    support: 'auto',
    logicAppsEquivalent: 'Azure Blob pass-through action',
  },
  'message-enricher': {
    displayName: 'Message Enricher',
    support: 'auto',
    logicAppsEquivalent: 'HTTP call-out + Compose action',
  },
  'sequential-convoy': {
    displayName: 'Sequential Convoy',
    support: 'partial',
    logicAppsEquivalent: 'Service Bus sessions (FIFO)',
  },
  'splitter': {
    displayName: 'Splitter',
    support: 'partial',
    logicAppsEquivalent: 'ForEach action (concurrency: 1)',
  },
  'message-aggregator': {
    displayName: 'Aggregator',
    support: 'partial',
    logicAppsEquivalent: 'ForEach + Append to Array Variable',
  },
  'scatter-gather': {
    displayName: 'Scatter-Gather',
    support: 'partial',
    logicAppsEquivalent: 'Parallel actions + ForEach collect',
  },
  'retry-idempotent': {
    displayName: 'Suspend with Retry',
    support: 'partial',
    logicAppsEquivalent: 'Until loop (no native Suspend)',
  },
  'process-manager': {
    displayName: 'Process Manager',
    support: 'partial',
    logicAppsEquivalent: 'Stateful workflow + child Workflow actions',
  },
  'publish-subscribe': {
    displayName: 'Message Broker (Pub-Sub)',
    support: 'redesign',
    logicAppsEquivalent: 'Service Bus Topics + Event Grid',
  },
  'correlation': {
    displayName: 'Correlation',
    support: 'partial',
    logicAppsEquivalent: 'Stateful workflow execution context',
  },
  'fan-out': {
    displayName: 'Fan-Out (Multiple Receives)',
    support: 'partial',
    logicAppsEquivalent: 'Separate trigger workflows + shared child workflow',
  },
};

export function generateMigrationReport(input: ReportInput): string {
  const {
    app,
    buildResult,
    qualityReport,
    gaps,
    patterns,
    outputDir,
    errors,
    warnings,
    timings,
    clientMode,
  } = input;

  const date = new Date().toISOString().split('T')[0]!;
  const totalMs = Object.values(timings).reduce((a, b) => a + (b ?? 0), 0);
  const criticalGaps = gaps.filter(g => g.severity === 'critical');
  const highGaps     = gaps.filter(g => g.severity === 'high');
  const mediumGaps   = gaps.filter(g => g.severity === 'medium');

  const gradeEmoji = { A: '🟢', B: '🟢', C: '🟡', D: '🟠', F: '🔴' };
  const grade = qualityReport.grade;
  const gradeIcon = gradeEmoji[grade] ?? '⚪';

  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────────

  lines.push(`# BizTalk Migration Report: ${app.name}`);
  lines.push('');
  lines.push(`Generated: ${date} | AI mode: ${clientMode} | Runtime: ${(totalMs / 1000).toFixed(1)}s`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Executive Summary ────────────────────────────────────────────────────────

  lines.push('## Executive Summary');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|----------|-------|');
  lines.push(`| Application | ${app.name} |`);
  lines.push(`| Complexity | ${app.complexityClassification} (${app.complexityScore}/100) |`);
  lines.push(`| Orchestrations | ${app.orchestrations.length} |`);
  lines.push(`| Maps | ${app.maps.length} |`);
  lines.push(`| Pipelines | ${app.pipelines.length} |`);
  lines.push(`| Bindings | ${app.bindingFiles.length} |`);
  lines.push(`| Workflows generated | ${buildResult.project.workflows.length} |`);
  lines.push(`| Quality score | ${gradeIcon} ${qualityReport.totalScore}/100 Grade ${grade} |`);
  lines.push(`| Critical gaps | ${criticalGaps.length} |`);
  lines.push(`| High gaps | ${highGaps.length} |`);
  lines.push(`| Medium gaps | ${mediumGaps.length} |`);
  lines.push('');

  // ── Detected Enterprise Integration Patterns ─────────────────────────────────

  if (patterns && patterns.length > 0) {
    lines.push('## Detected Enterprise Integration Patterns');
    lines.push('');

    const known   = patterns.filter(p => PATTERN_DISPLAY_MAP[p] !== undefined);
    const unknown = patterns.filter(p => PATTERN_DISPLAY_MAP[p] === undefined);

    const autoPatterns    = known.filter(p => PATTERN_DISPLAY_MAP[p]!.support === 'auto');
    const partialPatterns = known.filter(p => PATTERN_DISPLAY_MAP[p]!.support === 'partial');
    const redesignPatterns = known.filter(p => PATTERN_DISPLAY_MAP[p]!.support === 'redesign');

    lines.push(`Detected **${patterns.length}** enterprise integration pattern(s): ` +
      `${autoPatterns.length} migrate automatically, ` +
      `${partialPatterns.length} require review, ` +
      `${redesignPatterns.length} require redesign.`);
    lines.push('');
    lines.push('| Pattern | Support | Logic Apps Equivalent |');
    lines.push('|---------|---------|----------------------|');

    for (const p of [...autoPatterns, ...partialPatterns, ...redesignPatterns]) {
      const info = PATTERN_DISPLAY_MAP[p]!;
      const supportLabel =
        info.support === 'auto'     ? '✅ Auto'     :
        info.support === 'partial'  ? '⚠️ Partial'  : '❌ Redesign';
      lines.push(`| ${info.displayName} | ${supportLabel} | ${info.logicAppsEquivalent} |`);
    }

    if (unknown.length > 0) {
      for (const p of unknown) {
        lines.push(`| ${p} | ⚠️ Partial | Manual review required |`);
      }
    }

    lines.push('');
    lines.push('> See the migration report above for pattern details and effort estimates.');
    lines.push('');
  }

  // ── Gap Analysis ─────────────────────────────────────────────────────────────

  if (gaps.length > 0) {
    lines.push('## Gap Analysis');
    lines.push('');
    lines.push('| Severity | Capability | Mitigation |');
    lines.push('|----------|-----------|-----------|');
    for (const gap of [...criticalGaps, ...highGaps, ...mediumGaps]) {
      const sev = gap.severity === 'critical' ? '🔴 Critical' :
                  gap.severity === 'high'     ? '🟠 High'     : '🟡 Medium';
      lines.push(`| ${sev} | ${gap.capability} | ${gap.mitigation} |`);
    }
    lines.push('');
  } else {
    lines.push('## Gap Analysis');
    lines.push('');
    lines.push('✅ No migration gaps detected — clean migration.');
    lines.push('');
  }

  // ── Architecture Recommendation ───────────────────────────────────────────────

  lines.push('## Architecture Recommendation');
  lines.push('');
  lines.push('**Target:** Azure Logic Apps Standard (single-tenant)');
  lines.push('');

  const hasOnPrem = app.bindingFiles.some(b =>
    b.receiveLocations.some(r => r.address?.startsWith('C:\\') || r.address?.startsWith('\\\\')) ||
    b.sendPorts.some(s => s.address?.startsWith('C:\\') || s.address?.startsWith('\\\\'))
  );

  if (hasOnPrem) {
    lines.push('**On-premises connectivity:** On-premises data gateway required for FILE/SQL adapters with local paths.');
    lines.push('');
  }

  if (app.maps.length > 0) {
    lines.push('**Integration Account:** Required for XSLT map execution from converted .btm files.');
    lines.push('');
  }

  lines.push('**Connector strategy:** ServiceProvider (built-in) connectors used where available for better performance and simpler configuration.');
  lines.push('');

  // ── Generated Artifacts ────────────────────────────────────────────────────────

  lines.push('## Generated Artifacts');
  lines.push('');
  lines.push(`Output directory: \`${outputDir}\``);
  lines.push('');

  if (buildResult.project.workflows.length > 0) {
    lines.push('**Workflows:**');
    for (const wf of buildResult.project.workflows) {
      lines.push(`- \`${wf.name}/workflow.json\``);
    }
    lines.push('');
  }

  const xsltCount = Object.keys(buildResult.project.xsltMaps).length;
  const lmlCount  = Object.keys(buildResult.project.lmlMaps).length;
  if (xsltCount + lmlCount > 0) {
    lines.push('**Maps:**');
    for (const name of Object.keys(buildResult.project.xsltMaps)) {
      lines.push(`- \`Artifacts/Maps/${name}\` (XSLT)`);
    }
    for (const name of Object.keys(buildResult.project.lmlMaps)) {
      lines.push(`- \`Artifacts/Maps/${name}\` (Data Mapper LML)`);
    }
    lines.push('');
  }

  lines.push('**Configuration files:**');
  lines.push('- `connections.json` — connector configuration');
  lines.push('- `host.json` — Logic Apps host settings');
  lines.push('- `local.settings.json` — local dev settings (gitignore this)');
  if (Object.keys(buildResult.armTemplate).length > 0) {
    lines.push('- `arm-template.json` — ARM deployment template');
    lines.push('- `arm-parameters.json` — ARM parameters');
  }
  lines.push('');

  // ── Quality Report ────────────────────────────────────────────────────────────

  lines.push('## Quality Report');
  lines.push('');
  lines.push(`**Score:** ${qualityReport.totalScore}/100  **Grade:** ${gradeIcon} ${grade}`);
  lines.push('');
  lines.push(`> ${qualityReport.summary}`);
  lines.push('');

  if (qualityReport.dimensions.length > 0) {
    lines.push('| Dimension | Score | Max |');
    lines.push('|-----------|-------|-----|');
    for (const dim of qualityReport.dimensions) {
      lines.push(`| ${dim.name} | ${dim.score} | ${dim.maxScore} |`);
    }
    lines.push('');
  }

  if (qualityReport.recommendations.length > 0) {
    lines.push('**Recommendations:**');
    for (const rec of qualityReport.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push('');
  }

  // ── Actionable Fix List ────────────────────────────────────────────────────────
  // Map errors and quality recommendations to specific, numbered fixes.
  // Helps consultants burn down issues one by one.

  const allFixItems: Array<{ issue: string; action: string; impact: string }> = [];

  for (const error of errors) {
    allFixItems.push(errorToFix(error));
  }
  const REC_ACTIONS: Record<string, string> = {
    'Add a Scope with runAfter FAILED': 'Wrap main actions in Scope_Main; add Terminate_On_Error with runAfter: { Scope_Main: ["FAILED", "TIMEDOUT"] }',
    'Ensure all intent steps': 'Review dropped steps — some BizTalk shapes may lack a direct Logic Apps equivalent; add Compose placeholders',
    'Add retryPolicy to all HTTP': 'Add retryPolicy: { type: "fixed", count: 3, interval: "PT30S" } to each Http action inputs',
    'Change all runAfter status values': 'Find and replace "Succeeded"/"Failed" with "SUCCEEDED"/"FAILED" in workflow.json',
    'Use KVS_ prefix': 'Rename sensitive @appsetting keys to start with KVS_ (e.g. KVS_Storage_Blob_ConnectionString)',
    'Consider using Stateful': 'Set "kind": "Stateful" at the workflow root — required for BizTalk migrations',
    'Remove circular runAfter': 'Check the runAfter graph for cycles; remove the back-edge causing the loop',
  };
  for (const rec of qualityReport.recommendations) {
    const actionKey = Object.keys(REC_ACTIONS).find(k => rec.startsWith(k));
    const action = actionKey ? REC_ACTIONS[actionKey]! : rec;
    allFixItems.push({ issue: `Quality: ${rec}`, action, impact: 'Score improvement' });
  }

  if (allFixItems.length > 0) {
    lines.push('## Actionable Fix List');
    lines.push('');
    lines.push('Address each item below to improve migration quality and close deployment gaps.');
    lines.push('');
    lines.push('| # | Issue | Recommended Fix | Impact |');
    lines.push('|---|-------|-----------------|--------|');
    for (let i = 0; i < allFixItems.length; i++) {
      const item = allFixItems[i]!;
      lines.push(`| ${i + 1} | ${item.issue} | ${item.action} | ${item.impact} |`);
    }
    lines.push('');
  }

  // ── Deployment Instructions ───────────────────────────────────────────────────

  lines.push('## Deployment Instructions');
  lines.push('');
  lines.push('### Prerequisites');
  lines.push('- Azure subscription with Logic Apps Standard resource');
  lines.push('- Azure CLI (`az login`)');
  lines.push('- VS Code with Azure Logic Apps (Standard) extension');
  lines.push('');
  lines.push('### Steps');
  lines.push('');
  lines.push('1. **Configure app settings** in Azure Portal → Logic App → Configuration:');
  lines.push('   - Add all `KVS_*` secrets as Key Vault references');
  lines.push('   - Add all `Common_*` and `Workflow_*` settings as plain values');
  lines.push('');
  lines.push('2. **Deploy via VS Code:**');
  lines.push('   ```');
  lines.push(`   Right-click \`${outputDir}\` → Deploy to Logic App...`);
  lines.push('   ```');
  lines.push('');
  lines.push('3. **Deploy via Azure CLI:**');
  lines.push('   ```bash');
  lines.push(`   az logicapp deployment source config-zip \\`);
  lines.push(`    --name <logic-app-name> \\`);
  lines.push(`    --resource-group <resource-group> \\`);
  lines.push(`    --src <path-to-zip>`);
  lines.push('   ```');
  lines.push('');
  lines.push('4. **Verify:** Open Logic App in Azure Portal → check each workflow runs successfully.');
  lines.push('');

  // ── Manual Next Steps ─────────────────────────────────────────────────────────

  lines.push('## Manual Next Steps');
  lines.push('');

  const nextSteps: string[] = [];

  if (criticalGaps.length > 0) {
    nextSteps.push(`**Address ${criticalGaps.length} critical gap(s)** before deployment:`);
    for (const g of criticalGaps) {
      nextSteps.push(`  - ${g.capability}: ${g.mitigation}`);
    }
  }

  if (app.maps.length > 0) {
    nextSteps.push('Review converted XSLT maps — C# scripting functoids require Azure Functions replacement');
  }

  nextSteps.push('Replace all `KVS_*` placeholder values with actual Key Vault secret URIs');
  nextSteps.push('Test each workflow end-to-end with representative sample messages');
  nextSteps.push('Set up Azure Monitor alerts for workflow failures');

  if (hasOnPrem) {
    nextSteps.push('Install and register On-premises Data Gateway for FILE/SQL connectors');
  }

  for (const step of nextSteps) {
    lines.push(`- ${step}`);
  }
  lines.push('');

  // ── Warnings ──────────────────────────────────────────────────────────────────

  if (warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    const uniqueWarnings = [...new Set(warnings)];
    for (const w of uniqueWarnings.slice(0, 20)) {
      lines.push(`- ⚠ ${w}`);
    }
    if (uniqueWarnings.length > 20) {
      lines.push(`- ... and ${uniqueWarnings.length - 20} more`);
    }
    lines.push('');
  }

  // ── Errors ────────────────────────────────────────────────────────────────────

  if (errors.length > 0) {
    lines.push('## Non-Fatal Errors');
    lines.push('');
    lines.push('These issues were encountered but did not stop the migration:');
    lines.push('');
    for (const e of errors.slice(0, 10)) {
      lines.push(`- ❌ ${e}`);
    }
    if (errors.length > 10) {
      lines.push(`- ... and ${errors.length - 10} more`);
    }
    lines.push('');
  }

  // ── Getting Started ───────────────────────────────────────────────────────────

  lines.push('## Getting Started');
  lines.push('');
  lines.push('Open this output folder in VS Code to work with the migrated Logic Apps project:');
  lines.push('');
  lines.push('1. **Install the extension** — "Azure Logic Apps (Standard)" (`ms-azuretools.vscode-azurelogicapps`)');
  lines.push('2. **Open the folder** — File → Open Folder → select this output directory');
  lines.push('3. **The `.vscode/settings.json`** is pre-configured for Logic Apps Standard');
  lines.push('4. **Edit connection settings** — update `local.settings.json` with your real connection strings');
  lines.push('5. **Open a workflow in Designer** — right-click any `workflow.json` → "Open in Designer"');
  lines.push('6. **Deploy to Azure** — use the Logic Apps extension sidebar → Deploy to Logic App');
  lines.push('');
  if (buildResult.localCodeFunctions && Object.keys(buildResult.localCodeFunctions).length > 0) {
    lines.push('**Local Code Functions** — the following `.cs` stubs were generated for custom C# logic:');
    for (const name of Object.keys(buildResult.localCodeFunctions)) {
      lines.push(`- \`${name}\` — implement the transformation logic before deploying`);
    }
    lines.push('');
  }
  lines.push('**Maps** are in `Artifacts/Maps/` and **Schemas** are in `Artifacts/Schemas/`.');
  lines.push('');

  // ── Footer ────────────────────────────────────────────────────────────────────

  lines.push('---');
  lines.push('');
  lines.push('*Generated by BizTalk to Logic Apps Migration Framework*');
  lines.push('*Support: Me@Jonlevesque.com*');

  return lines.join('\n');
}

// ─── Error-to-Fix Mapper ──────────────────────────────────────────────────────

function errorToFix(error: string): { issue: string; action: string; impact: string } {
  if (error.includes('TODO_CLAUDE'))
    return { issue: error, action: 'Run AI enrichment or manually translate the XLANG/s expression to WDL', impact: '+5-15 pts' };
  if (error.includes('connections') || error.includes('connection'))
    return { issue: error, action: 'Add missing connector entry to connections.json with correct parameterValues', impact: 'Deployment fix' };
  if (error.includes('runAfter'))
    return { issue: error, action: 'Change runAfter status values to ALL CAPS: SUCCEEDED, FAILED, TIMEDOUT, SKIPPED', impact: '+10 pts' };
  if (error.includes('empty value') || error.includes('SetVariable'))
    return { issue: error, action: 'Translate C# expression to WDL @{...} syntax and set as the value', impact: '+3-9 pts' };
  if (error.includes('Intent validation'))
    return { issue: error, action: 'Fix the IntegrationIntent structure — check for missing required fields', impact: 'Build fix' };
  if (error.includes('parse') || error.includes('Parse'))
    return { issue: error, action: 'Review source artifact for encoding or syntax issues', impact: 'Parse fix' };
  return { issue: error, action: 'Manual review required — check the specific workflow section', impact: 'Variable' };
}
