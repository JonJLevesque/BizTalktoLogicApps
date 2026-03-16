/**
 * Migration Report Generator
 *
 * Produces a consultant-ready migration-report.md with:
 *   - Executive Summary table
 *   - Detected integration patterns
 *   - Gap analysis (severity-grouped narrative, not cramped table)
 *   - Architecture recommendation
 *   - Generated artifacts inventory
 *   - Quality score with visual bar
 *   - Actionable fix list (numbered, not wide table)
 *   - Warnings (split: auto-applied vs manual action required)
 *   - Deployment and getting-started instructions
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
    logicAppsEquivalent: 'Service Bus batch trigger + ForEach + dictionary variable',
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
  'custom-pipeline': {
    displayName: 'Custom Pipeline Components',
    support: 'partial',
    logicAppsEquivalent: 'Azure Functions or Local Code Functions',
  },
};

// ── Score bar visualization ───────────────────────────────────────────────────

function scoreBar(score: number, maxScore = 100): string {
  const filled = Math.round((score / maxScore) * 20);
  const empty  = 20 - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

// ── Main report ───────────────────────────────────────────────────────────────

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

  const gradeEmoji: Record<string, string> = { A: '🟢', B: '🟢', C: '🟡', D: '🟠', F: '🔴' };
  const grade     = qualityReport.grade;
  const gradeIcon = gradeEmoji[grade] ?? '⚪';

  // Split warnings into auto-applied fixes vs manual-action items
  const autoFixedWarnings  = warnings.filter(w => /\] Fixed:/i.test(w));
  const attentionWarnings  = warnings.filter(w => !/\] Fixed:/i.test(w));

  const hasOnPrem = app.bindingFiles.some(b =>
    b.receiveLocations.some(r => r.address?.startsWith('C:\\') || r.address?.startsWith('\\\\')) ||
    b.sendPorts.some(s => s.address?.startsWith('C:\\') || s.address?.startsWith('\\\\'))
  );

  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────────

  lines.push(`# Migration Report — ${app.name}`);
  lines.push('');
  lines.push(`> **Date:** ${date} &nbsp;|&nbsp; **Quality:** ${gradeIcon} ${qualityReport.totalScore}/100 Grade ${grade} &nbsp;|&nbsp; **Runtime:** ${(totalMs / 1000).toFixed(1)}s &nbsp;|&nbsp; **Mode:** ${clientMode}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Executive Summary ────────────────────────────────────────────────────────

  lines.push('## Executive Summary');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|---|---|');
  lines.push(`| Application | ${app.name} |`);
  lines.push(`| Complexity | ${capitalize(app.complexityClassification)} (${app.complexityScore}/100) |`);
  lines.push(`| Orchestrations | ${app.orchestrations.length} |`);
  lines.push(`| Maps | ${app.maps.length} |`);
  lines.push(`| Pipelines | ${app.pipelines.length} |`);
  lines.push(`| Workflows generated | ${buildResult.project.workflows.length} |`);
  lines.push(`| Gaps — Critical / High / Medium | ${criticalGaps.length} / ${highGaps.length} / ${mediumGaps.length} |`);
  lines.push(`| Quality score | ${gradeIcon} ${qualityReport.totalScore}/100 Grade ${grade} |`);
  lines.push('');

  // ── Detected Enterprise Integration Patterns ──────────────────────────────

  if (patterns && patterns.length > 0) {
    const known          = patterns.filter(p => PATTERN_DISPLAY_MAP[p] !== undefined);
    const unknown        = patterns.filter(p => PATTERN_DISPLAY_MAP[p] === undefined);
    const autoPatterns   = known.filter(p => PATTERN_DISPLAY_MAP[p]!.support === 'auto');
    const partialPatterns    = known.filter(p => PATTERN_DISPLAY_MAP[p]!.support === 'partial');
    const redesignPatterns   = known.filter(p => PATTERN_DISPLAY_MAP[p]!.support === 'redesign');

    lines.push('## Integration Patterns');
    lines.push('');
    lines.push(
      `${patterns.length} enterprise integration pattern(s) detected — ` +
      `${autoPatterns.length} migrate automatically, ` +
      `${partialPatterns.length} require review, ` +
      `${redesignPatterns.length} require redesign.`
    );
    lines.push('');
    lines.push('| Pattern | Migration | Logic Apps Equivalent |');
    lines.push('|---|---|---|');

    for (const p of [...autoPatterns, ...partialPatterns, ...redesignPatterns]) {
      const info = PATTERN_DISPLAY_MAP[p]!;
      const label =
        info.support === 'auto'    ? '✅ Automatic' :
        info.support === 'partial' ? '⚠️ Needs review' : '❌ Redesign required';
      lines.push(`| ${info.displayName} | ${label} | ${info.logicAppsEquivalent} |`);
    }
    for (const p of unknown) {
      lines.push(`| ${p} | ⚠️ Needs review | Manual review required |`);
    }
    lines.push('');
  }

  // ── Gap Analysis ─────────────────────────────────────────────────────────────

  lines.push('## Gap Analysis');
  lines.push('');

  if (gaps.length === 0) {
    lines.push('✅ No migration gaps detected — clean migration.');
    lines.push('');
  } else {
    const totalEffort = gaps.reduce((sum, g) => sum + (g.estimatedEffortDays ?? 0), 0);
    lines.push(`${gaps.length} gap(s) identified.`);
    lines.push('');

    if (criticalGaps.length > 0) {
      lines.push('### 🔴 Critical — Must resolve before deployment');
      lines.push('');
      for (const gap of criticalGaps) {
        lines.push(`**${gap.capability}**`);
        if (gap.description) lines.push(gap.description);
        lines.push(`*Mitigation:* ${gap.mitigation}`);
        lines.push('');
      }
    }

    if (highGaps.length > 0) {
      lines.push('### 🟠 High — Significant workaround required');
      lines.push('');
      for (const gap of highGaps) {
        lines.push(`**${gap.capability}**`);
        if (gap.description) lines.push(gap.description);
        lines.push(`*Mitigation:* ${gap.mitigation}`);
        lines.push('');
      }
    }

    if (mediumGaps.length > 0) {
      lines.push('### 🟡 Medium — Workaround available');
      lines.push('');
      for (const gap of mediumGaps) {
        lines.push(`**${gap.capability}**`);
        if (gap.description) lines.push(gap.description);
        lines.push(`*Mitigation:* ${gap.mitigation}`);
        lines.push('');
      }
    }
  }

  // ── Architecture Recommendation ───────────────────────────────────────────

  lines.push('## Architecture Recommendation');
  lines.push('');
  lines.push('**Target platform:** Azure Logic Apps Standard (single-tenant, Workflow Standard plan)');
  lines.push('');

  // Connector inventory from binding files
  const adapterTypes = new Set<string>();
  for (const b of app.bindingFiles) {
    for (const r of b.receiveLocations) if (r.adapterType) adapterTypes.add(r.adapterType);
    for (const s of b.sendPorts)        if (s.adapterType) adapterTypes.add(s.adapterType);
  }
  if (adapterTypes.size > 0) {
    lines.push(`**Adapters in use:** ${[...adapterTypes].join(', ')}`);
    lines.push('');
  }

  if (hasOnPrem) {
    lines.push('**On-premises connectivity required:** On-premises data gateway needed for FILE/SQL adapters with local paths.');
    lines.push('');
  }

  const hasFlatFilePipelines = app.pipelines.some(p =>
    p.components.some(c =>
      ['FlatFileDasmComp','FFDasmComp','FlatFileAsmComp','FFAsmComp',
       'FlatFileDecode','FlatFileEncode'].includes(c.componentType)
    )
  );
  if (app.maps.length > 0 || hasFlatFilePipelines) {
    const iaReasons: string[] = [];
    if (app.maps.length > 0) iaReasons.push('XSLT map execution from converted `.btm` files');
    if (hasFlatFilePipelines) iaReasons.push('Flat File Decode/Encode actions in pipeline workflows');
    lines.push(`**Integration Account:** Required for ${iaReasons.join(' and ')}.`);
    lines.push('');
  }

  lines.push('**Connector preference:** Built-in ServiceProvider connectors used where available — better performance, no managed connection overhead.');
  lines.push('');
  lines.push('**Security:** All sensitive values reference Key Vault secrets via `@appsetting(\'KVS_...\')` — no connection strings in source control.');
  lines.push('');

  // ── Generated Artifacts ───────────────────────────────────────────────────

  lines.push('## Generated Artifacts');
  lines.push('');

  const appName = buildResult.project.appName;
  const hasFunctions = buildResult.localCodeFunctions
    ? Object.keys(buildResult.localCodeFunctions).filter(k => k.endsWith('.cs')).length > 0
    : false;

  lines.push('**Workspace structure**');
  lines.push('```');
  lines.push(`${outputDir}/`);
  lines.push(`  ${appName}.code-workspace     ← open this in VS Code`);
  lines.push(`  ${appName}/                   ← Logic Apps project`);
  if (hasFunctions) {
    lines.push(`  ${appName}_Functions/        ← C# Functions project`);
  }
  lines.push(`  migration-report.md`);
  lines.push(`  migration-report.html`);
  lines.push('```');
  lines.push('');

  if (buildResult.project.workflows.length > 0) {
    lines.push(`**Workflows** *(inside \`${appName}/\`)*`);
    for (const wf of buildResult.project.workflows) {
      lines.push(`- \`${appName}/${wf.name}/workflow.json\``);
    }
    lines.push('');
  }

  const xsltCount = Object.keys(buildResult.project.xsltMaps).length;
  const lmlCount  = Object.keys(buildResult.project.lmlMaps).length;
  if (xsltCount + lmlCount > 0) {
    lines.push(`**Maps** *(inside \`${appName}/Artifacts/Maps/\`)*`);
    for (const name of Object.keys(buildResult.project.xsltMaps)) {
      lines.push(`- \`${name}\` — XSLT`);
    }
    for (const name of Object.keys(buildResult.project.lmlMaps)) {
      lines.push(`- \`${name}\` — Data Mapper LML`);
    }
    lines.push('');
  }

  if (hasFunctions && buildResult.localCodeFunctions) {
    const csFiles = Object.keys(buildResult.localCodeFunctions).filter(k => k.endsWith('.cs'));
    lines.push(`**Local Code Function stubs** *(inside \`${appName}_Functions/\`)*`);
    lines.push('Implement each stub before deploying. Build the Functions project to copy DLLs to `lib/custom/net472/`.');
    for (const name of csFiles) {
      lines.push(`- \`${name}\``);
    }
    lines.push('');
  }

  const flatFilePipelineWorkflows = buildResult.project.workflows.filter(wf =>
    wf.name.startsWith('Pipeline_') || wf.name.toLowerCase().includes('pipeline')
  );
  const hasFlatFileActions = flatFilePipelineWorkflows.some(wf =>
    JSON.stringify(wf.workflow).includes('FlatFileSchemaName')
  );
  if (hasFlatFileActions) {
    lines.push('**⚠ Flat File schema placeholder** — Pipeline workflows contain `FlatFileSchemaName` as a placeholder.');
    lines.push('Replace it with your actual flat file schema name in each pipeline `workflow.json`.');
    lines.push('The schema must be uploaded to your Integration Account before the workflow can run.');
    lines.push('');
  }

  lines.push(`**Configuration** *(inside \`${appName}/\`)*`);
  lines.push('- `connections.json` — connector definitions');
  lines.push('- `host.json` — Logic Apps host settings');
  lines.push('- `local.settings.json` — local dev settings *(gitignore this)*');
  if (Object.keys(buildResult.armTemplate).length > 0) {
    lines.push('- `arm-template.json` + `arm-parameters.json` — ARM deployment');
  }
  lines.push('');

  // ── Quality Report ────────────────────────────────────────────────────────

  lines.push('## Quality Report');
  lines.push('');
  lines.push(`**Score:** ${qualityReport.totalScore}/100 &nbsp; \`${scoreBar(qualityReport.totalScore)}\` &nbsp; ${gradeIcon} **Grade ${grade}**`);
  lines.push('');
  lines.push(`> ${qualityReport.summary}`);
  lines.push('');

  if (qualityReport.dimensions.length > 0) {
    lines.push('| Dimension | Score | Max |');
    lines.push('|---|---|---|');
    for (const dim of qualityReport.dimensions) {
      lines.push(`| ${dim.name} | ${dim.score} | ${dim.maxScore} |`);
    }
    lines.push('');
  }

  if (qualityReport.recommendations.length > 0) {
    lines.push('**Recommendations to improve score:**');
    for (const rec of qualityReport.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push('');
  }

  // ── Actionable Fix List ───────────────────────────────────────────────────

  const allFixItems: Array<{ issue: string; action: string; impact: string }> = [];

  for (const error of errors) {
    allFixItems.push(errorToFix(error));
  }

  const REC_ACTIONS: Record<string, string> = {
    'Add a Scope with runAfter FAILED': 'Wrap main actions in `Scope_Main`; add `Terminate_On_Error` with `runAfter: { Scope_Main: ["FAILED", "TIMEDOUT"] }`',
    'Ensure all intent steps': 'Review dropped steps — some BizTalk shapes may lack a direct Logic Apps equivalent; add Compose placeholders',
    'Add retryPolicy to all HTTP': 'Add `retryPolicy: { type: "fixed", count: 3, interval: "PT30S" }` to each Http action',
    'Change all runAfter status values': 'Replace `"Succeeded"`/`"Failed"` with `"SUCCEEDED"`/`"FAILED"` in workflow.json',
    'Use KVS_ prefix': 'Rename sensitive `@appsetting` keys to start with `KVS_` (e.g. `KVS_Storage_Blob_ConnectionString`)',
    'Consider using Stateful': 'Set `"kind": "Stateful"` at the workflow root — required for BizTalk migrations',
    'Remove circular runAfter': 'Check the runAfter dependency graph for cycles and remove the back-edge causing the loop',
    'Use PascalCase for all action names': 'Rename actions using PascalCase with underscores (e.g. `Transform_Order`, `Send_To_Service_Bus`) — avoid spaces and lowercase',
    'Replace generic action names': 'Replace `Action1`, `Step1`, `action` etc. with descriptive PascalCase names (e.g. `Parse_Incoming_Message`, `Route_By_Priority`)',
    'Resolve all TODO_CLAUDE markers': 'Run the migration with a valid `BTLA_LICENSE_KEY` to let AI enrichment resolve all TODO_CLAUDE placeholders automatically',
    'Translate C# expressions to WDL': 'Convert C# expressions to WDL `@{...}` syntax: e.g. `str.ToUpper()` → `@{toUpper(str)}`, `DateTime.Now` → `@{utcNow()}`',
    'Replace raw C# code in SetVariable': 'Replace C# code in SetVariable values with WDL `@{...}` expressions or extract to a Local Code Function stub (`.cs`)',
    'Translate XLANG/s conditions to WDL': 'Convert If-action conditions to JSON predicate objects: `{ "equals": ["@body(\'Parse\')?[\'Status\']", "APPROVED"] }` — not `@{...}` strings',
  };

  for (const rec of qualityReport.recommendations) {
    const actionKey = Object.keys(REC_ACTIONS).find(k => rec.startsWith(k));
    const action = actionKey ? REC_ACTIONS[actionKey]! : rec;
    allFixItems.push({ issue: rec, action, impact: 'Score improvement' });
  }

  if (allFixItems.length > 0) {
    lines.push('## Actionable Fix List');
    lines.push('');
    lines.push('Address each item to improve quality and close deployment gaps.');
    lines.push('');
    for (let i = 0; i < allFixItems.length; i++) {
      const item = allFixItems[i]!;
      lines.push(`**${i + 1}. ${item.issue}**`);
      lines.push(`- Fix: ${item.action}`);
      lines.push(`- Impact: ${item.impact}`);
      lines.push('');
    }
  }

  // ── Warnings ──────────────────────────────────────────────────────────────

  const uniqueAutoFixed  = [...new Set(autoFixedWarnings)];
  const uniqueAttention  = [...new Set(attentionWarnings)];

  if (uniqueAutoFixed.length > 0 || uniqueAttention.length > 0) {
    lines.push('## Warnings');
    lines.push('');

    if (uniqueAutoFixed.length > 0) {
      lines.push('### Applied Automatically');
      lines.push('These changes were applied by the AI review pass — no action needed.');
      lines.push('');
      for (const w of uniqueAutoFixed) {
        // Strip the "[WorkflowName] Fixed: " prefix for cleaner display
        const clean = w.replace(/^\[.*?\]\s+Fixed:\s*/i, '');
        const wfMatch = /^\[(.+?)\]/.exec(w);
        const prefix = wfMatch ? `\`${wfMatch[1]}\`: ` : '';
        lines.push(`- ${prefix}${clean}`);
      }
      lines.push('');
    }

    if (uniqueAttention.length > 0) {
      lines.push('### Requires Manual Action');
      lines.push('');
      for (const w of uniqueAttention.slice(0, 30)) {
        lines.push(`- ⚠️ ${w}`);
      }
      if (uniqueAttention.length > 30) {
        lines.push(`- *... and ${uniqueAttention.length - 30} more*`);
      }
      lines.push('');
    }
  }

  // ── Non-Fatal Errors ──────────────────────────────────────────────────────

  if (errors.length > 0) {
    lines.push('## Non-Fatal Errors');
    lines.push('');
    lines.push('These issues were encountered but did not stop the migration:');
    lines.push('');
    for (const e of errors.slice(0, 10)) {
      lines.push(`- ❌ ${e}`);
    }
    if (errors.length > 10) {
      lines.push(`- *... and ${errors.length - 10} more*`);
    }
    lines.push('');
  }

  // ── Getting Started ───────────────────────────────────────────────────────

  lines.push('## Getting Started');
  lines.push('');
  lines.push(`1. **Open the workspace** — File → Open Workspace from File → select \`${appName}.code-workspace\``);
  lines.push(`   This loads both \`${appName}/\` (Logic Apps project) and \`${appName}_Functions/\` (C# Functions project) in the same VS Code window.`);
  lines.push('2. **Install prerequisites** — VS Code will prompt to install the "Azure Logic Apps (Standard)" extension (`ms-azuretools.vscode-azurelogicapps`). Accept the recommendation.');
  lines.push('3. **Start Azurite** — the designer requires the local storage emulator.');
  lines.push('   Click `Azurite Blob Service`, `Azurite Queue Service`, and `Azurite Table Service` in the VS Code status bar.');
  lines.push('   All three must show a green checkmark before the designer will load.');
  lines.push('   If Azurite is not installed: `npm install -g azurite`');
  lines.push(`4. **Configure connection strings** — edit \`${appName}/local.settings.json\` with your real connection strings`);
  if (hasFlatFilePipelines) {
    lines.push(`5. **Configure flat file schemas** — pipeline workflows contain a \`FlatFileSchemaName\` placeholder.`);
    lines.push(`   Replace every occurrence with your actual flat file schema name (the name you uploaded to your Integration Account).`);
    lines.push(`   Search for \`FlatFileSchemaName\` across the \`${appName}/\` folder to find all occurrences.`);
  }
  if (hasFunctions) {
    const ffStep = hasFlatFilePipelines ? '6' : '5';
    lines.push(`${ffStep}. **Build the Functions project** — right-click \`${appName}_Functions\` in the Explorer panel → "Build functions project".`);
    lines.push(`   This compiles the C# stubs and copies the DLLs to \`${appName}/lib/custom/net472/\`.`);
    lines.push(`   The Logic Apps designer cannot load Local Code Function actions until this step completes.`);
  }
  const designerStep = hasFlatFilePipelines && hasFunctions ? '7' : hasFlatFilePipelines || hasFunctions ? '6' : '5';
  lines.push(`${designerStep}. **Open a workflow in the designer** — navigate to \`${appName}/{WorkflowName}/workflow.json\` → right-click → "Open in Designer"`);
  lines.push('');
  lines.push(`Maps are in \`${appName}/Artifacts/Maps/\` and Schemas are in \`${appName}/Artifacts/Schemas/\`.`);
  lines.push('');

  // ── Manual Next Steps ─────────────────────────────────────────────────────

  lines.push('## Manual Next Steps');
  lines.push('');

  if (criticalGaps.length > 0) {
    lines.push(`**Before deployment — address ${criticalGaps.length} critical gap(s):**`);
    for (const g of criticalGaps) {
      lines.push(`- ${g.capability}: ${g.mitigation}`);
    }
    lines.push('');
  }

  if (app.maps.length > 0) {
    lines.push('- Review converted maps — C# scripting functoids require Local Code Function implementation');
  }
  lines.push('- Replace all `KVS_*` placeholder values with actual Azure Key Vault secret URIs');
  lines.push('- Run end-to-end tests with representative sample messages for each workflow');
  lines.push('- Set up Azure Monitor alerts for workflow failures');
  lines.push('');
  lines.push('**Testing options for Logic Apps Standard:**');
  lines.push('');
  lines.push('| Approach | When to use |');
  lines.push('|---|---|');
  lines.push('| **Generated test specs** (`tests/*.tests.json`) | Run with the Logic Apps test runner — no Azure required |');
  lines.push('| **Microsoft unit testing NuGet** (`Microsoft.Azure.Workflows.UnitTesting`) | Local CI; mock individual actions without deploying |');
  lines.push('| **Azure Management API integration tests** | Trigger live deployed workflow; validate run history in CI/CD |');
  lines.push('');
  lines.push('- Microsoft unit testing docs: https://learn.microsoft.com/azure/logic-apps/create-run-custom-code-functions');
  if (hasOnPrem) {
    lines.push('- Install and register the On-premises Data Gateway for FILE/SQL connectors');
  }
  lines.push('');

  // ── Deployment Instructions ───────────────────────────────────────────────

  lines.push('## Deployment');
  lines.push('');
  lines.push('**Prerequisites:** Azure subscription · Azure CLI (`az login`) · VS Code with Azure Logic Apps (Standard) extension');
  lines.push('');
  lines.push('**Option A — VS Code:**');
  lines.push('```');
  lines.push(`Right-click the "${appName}" subfolder (not the workspace root) → "Deploy to Logic App..."`);
  lines.push('```');
  lines.push(`> The workspace root contains \`${appName}.code-workspace\`, \`${appName}/\`, and \`${appName}_Functions/\`.`);
  lines.push(`> Deploy from the \`${appName}/\` folder only — that is the Logic Apps project.`);
  lines.push('');
  lines.push('**Option B — Azure CLI:**');
  lines.push('```bash');
  lines.push(`az logicapp deployment source config-zip \\`);
  lines.push(`  --name <logic-app-name> \\`);
  lines.push(`  --resource-group <resource-group> \\`);
  lines.push(`  --src <path-to-zip>`);
  lines.push('```');
  lines.push('');
  lines.push('**Configure app settings** in Azure Portal → Logic App → Configuration:');
  lines.push('- Add all `KVS_*` entries as Key Vault references');
  lines.push('- Add all `Common_*` and `Workflow_*` entries as plain values');
  lines.push('');

  // ── Footer ────────────────────────────────────────────────────────────────

  lines.push('---');
  lines.push('');
  lines.push('*Generated by [BizTalk to Logic Apps Migration Framework](https://biztalkmigrate.com)*  ');
  lines.push('*Support: me@jonlevesque.com*');

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function errorToFix(error: string): { issue: string; action: string; impact: string } {
  if (error.includes('TODO_CLAUDE'))
    return { issue: error, action: 'Run AI enrichment or manually translate the XLANG/s expression to WDL `@{...}` syntax', impact: '+5–15 pts' };
  if (error.includes('connections') || error.includes('connection'))
    return { issue: error, action: 'Add the missing connector entry to `connections.json` with the correct `parameterValues`', impact: 'Deployment fix' };
  if (error.includes('runAfter'))
    return { issue: error, action: 'Change `runAfter` status values to ALL CAPS: `SUCCEEDED`, `FAILED`, `TIMEDOUT`, `SKIPPED`', impact: '+10 pts' };
  if (error.includes('empty value') || error.includes('SetVariable'))
    return { issue: error, action: 'Translate the C# expression to WDL `@{...}` syntax and set it as the action value', impact: '+3–9 pts' };
  if (error.includes('Intent validation'))
    return { issue: error, action: 'Fix the IntegrationIntent structure — check for missing required fields', impact: 'Build fix' };
  if (error.includes('parse') || error.includes('Parse'))
    return { issue: error, action: 'Review the source artifact for encoding or syntax issues', impact: 'Parse fix' };
  return { issue: error, action: 'Manual review required — check the specific workflow section', impact: 'Variable' };
}
