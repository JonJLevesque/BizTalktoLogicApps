/**
 * Estate Report Generator
 *
 * Produces a consultant-ready estate-report.md with:
 *   - Estate Overview
 *   - Complexity Distribution
 *   - Application Inventory (sortable table)
 *   - Migration Waves
 *   - Adapter Inventory with Logic Apps connector equivalents
 *   - Gap Heat Map (aggregated across all applications)
 *   - Infrastructure Requirements
 *   - Effort Summary
 *   - Failures (if any)
 *
 * Fully local — no AI required.
 * Support: Me@Jonlevesque.com
 */

import type { AppAssessment, EstateTotals } from './types.js';
import type { ComplexityClass } from '../types/migration.js';

// ─── Adapter → Logic Apps connector mapping ───────────────────────────────────

const ADAPTER_TO_CONNECTOR: Record<string, string> = {
  'FILE':              'azureblob (ServiceProvider) / filesystem (on-prem+gateway)',
  'HTTP':              'request trigger + Http action',
  'SOAP':              'request trigger + Http action (Content-Type: text/xml)',
  'WCF-SQL':           'sql (ServiceProvider)',
  'WCF-BasicHttp':     'request trigger + Http action',
  'WCF-WSHttp':        'request trigger + Http action + WS-Security headers',
  'SB-Messaging':      'serviceBus (ServiceProvider)',
  'WCF-NetMsmq':       'serviceBus (ServiceProvider)',
  'MSMQ':              'serviceBus (ServiceProvider)',
  'SFTP':              'sftp (ServiceProvider)',
  'FTP':               'ftp (ServiceProvider)',
  'SQL':               'sql (ServiceProvider) / +gateway (on-prem)',
  'SMTP':              'smtp (ServiceProvider)',
  'Event Hubs':        'eventhub (ServiceProvider)',
  'EventHubs':         'eventhub (ServiceProvider)',
  'Schedule':          'recurrence trigger',
  'WCF-NetTcp':        'Azure Functions (.NET) — no LA connector',
  'WCF-NetNamedPipe':  'REDESIGN REQUIRED — no Azure equivalent',
  'WCF-Custom':        'Azure Functions (.NET) or redesign',
  'WCF-CustomIsolated':'Azure Functions (.NET) or redesign',
  'MQSeries':          'ibmmq (ServiceProvider)',
  'WebSphere MQ':      'ibmmq (ServiceProvider)',
  'SAP':               'sap (managed + gateway)',
  'Oracle':            'oracle (managed connector)',
  'SharePoint':        'sharepoint (managed) / +gateway (on-prem)',
  'POP3':              'office365 (managed)',
  'IMAP':              'office365 (managed)',
  'EDI X12':           'x12 (Integration Account)',
  'EDI EDIFACT':       'edifact (Integration Account)',
  'AS2':               'as2 (Integration Account)',
};

// ─── Complexity display ───────────────────────────────────────────────────────

const COMPLEXITY_EMOJI: Record<ComplexityClass, string> = {
  'simple':         '🟢',
  'moderate':       '🟡',
  'complex':        '🟠',
  'highly-complex': '🔴',
};

// ─── Infrastructure service labels ───────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  'logic-apps-standard':  'Azure Logic Apps Standard',
  'integration-account':  'Integration Account (Basic/Standard)',
  'service-bus':          'Azure Service Bus',
  'event-hubs':           'Azure Event Hubs',
  'event-grid':           'Azure Event Grid',
  'azure-functions':      'Azure Functions (.NET)',
  'blob-storage':         'Azure Blob Storage',
  'cosmos-db':            'Azure Cosmos DB',
  'key-vault':            'Azure Key Vault',
  'application-insights': 'Application Insights',
  'api-management':       'Azure API Management',
  'azure-relay':          'Azure Relay',
  'on-prem-data-gateway': 'On-Premises Data Gateway',
};

// ─── Main report ──────────────────────────────────────────────────────────────

export function generateEstateReport(
  assessments: AppAssessment[],
  failures: Array<{ name: string; dirPath: string; error: string }>,
  totals: EstateTotals
): string {
  const lines: string[] = [];
  const date = new Date().toISOString().split('T')[0]!;
  const totalApps = assessments.length + failures.length;

  // ── Header ────────────────────────────────────────────────────────────────────

  lines.push('# BizTalk Estate Assessment Report');
  lines.push('');
  lines.push(`> **Date:** ${date} &nbsp;|&nbsp; **Applications assessed:** ${assessments.length} of ${totalApps} &nbsp;|&nbsp; **Total estimated effort:** ~${totals.totalEstimatedEffortDays} day(s)`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Estate Overview ───────────────────────────────────────────────────────────

  lines.push('## Estate Overview');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|---|---|');
  lines.push(`| Applications | ${totals.applications} |`);
  lines.push(`| Orchestrations | ${totals.orchestrations} |`);
  lines.push(`| Maps | ${totals.maps} |`);
  lines.push(`| Pipelines | ${totals.pipelines} |`);
  lines.push(`| Schemas | ${totals.schemas} |`);
  lines.push(`| Total gaps | ${totals.totalGaps} |`);
  lines.push(`| Critical gaps | 🔴 ${totals.criticalGaps} |`);
  lines.push(`| High gaps | 🟠 ${totals.highGaps} |`);
  lines.push(`| Medium gaps | 🟡 ${totals.mediumGaps} |`);
  lines.push(`| Estimated total effort | ~${totals.totalEstimatedEffortDays} day(s) |`);
  lines.push(`| Apps requiring Integration Account | ${totals.requiresIntegrationAccount} |`);
  lines.push(`| Apps requiring On-Premises Gateway | ${totals.requiresOnPremGateway} |`);
  if (failures.length > 0) {
    lines.push(`| Parse failures | ❌ ${failures.length} |`);
  }
  lines.push('');

  // ── Complexity Distribution ────────────────────────────────────────────────

  lines.push('## Complexity Distribution');
  lines.push('');
  lines.push('| Complexity | Count | % of Estate |');
  lines.push('|---|---|---|');
  const complexityOrder: ComplexityClass[] = ['simple', 'moderate', 'complex', 'highly-complex'];
  for (const cls of complexityOrder) {
    const count = totals.complexityDistribution[cls];
    const pct = totals.applications > 0 ? Math.round((count / totals.applications) * 100) : 0;
    const emoji = COMPLEXITY_EMOJI[cls];
    lines.push(`| ${emoji} ${capitalize(cls)} | ${count} | ${pct}% |`);
  }
  lines.push('');

  // ── Application Inventory ─────────────────────────────────────────────────

  lines.push('## Application Inventory');
  lines.push('');

  // Sort by wave (ascending), then by complexity score (descending)
  const sorted = [...assessments].sort((a, b) => {
    if (a.wave !== b.wave) return a.wave - b.wave;
    return b.complexity.totalScore - a.complexity.totalScore;
  });

  lines.push('| # | Application | Complexity | Score | Orchs | Maps | Adapters | Gaps | Effort (d) | Wave |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    const emoji = COMPLEXITY_EMOJI[a.complexity.classification];
    const adapterTypes = collectAdapterTypes(a);
    const adapterStr = adapterTypes.slice(0, 3).join(', ') + (adapterTypes.length > 3 ? ` +${adapterTypes.length - 3}` : '');
    lines.push(
      `| ${i + 1} | ${a.name} | ${emoji} ${capitalize(a.complexity.classification)} | ${a.complexity.totalScore} | ${a.app.orchestrations.length} | ${a.app.maps.length} | ${adapterStr || '—'} | ${a.gaps.length} | ${a.estimatedEffortDays} | ${a.wave} |`
    );
  }
  lines.push('');

  // ── Migration Waves ────────────────────────────────────────────────────────

  lines.push('## Migration Waves');
  lines.push('');
  lines.push('Applications grouped by recommended migration order. Start with Wave 1 (simplest) to build team confidence and validate Azure infrastructure before tackling complex applications.');
  lines.push('');

  const waveDescriptions: Record<number, { title: string; rationale: string }> = {
    1: { title: 'Wave 1 — Quick Wins (Simple)', rationale: 'Low complexity. Direct adapter mappings. Ideal for validating Azure infrastructure and team onboarding.' },
    2: { title: 'Wave 2 — Core Migrations (Moderate)', rationale: 'Moderate complexity. Some manual review required for expression translation and gap workarounds.' },
    3: { title: 'Wave 3 — Complex Integrations', rationale: 'High complexity. Requires architect review. Multiple workflows, custom components, or complex adapters.' },
    4: { title: 'Wave 4 — Strategic Redesigns (Highly Complex)', rationale: 'Very high complexity. Involves transactions, custom BRE rules, or adapters with no Azure equivalent. Plan for redesign sprints.' },
  };

  for (const waveNum of [1, 2, 3, 4] as const) {
    const waveApps = sorted.filter(a => a.wave === waveNum);
    if (waveApps.length === 0) continue;

    const desc = waveDescriptions[waveNum]!;
    const waveEffort = waveApps.reduce((s, a) => s + a.estimatedEffortDays, 0);
    lines.push(`### ${desc.title}`);
    lines.push('');
    lines.push(`*${desc.rationale}*`);
    lines.push('');
    lines.push(`**${waveApps.length} application(s)** — ~${waveEffort} effort day(s)`);
    lines.push('');
    for (const a of waveApps) {
      const criticalCount = a.gaps.filter(g => g.severity === 'critical').length;
      const criticalNote = criticalCount > 0 ? ` ⚠️ ${criticalCount} critical gap(s)` : '';
      lines.push(`- **${a.name}** — ${a.complexity.totalScore} pts, ${a.gaps.length} gap(s), ~${a.estimatedEffortDays}d${criticalNote}`);
    }
    lines.push('');
  }

  // ── Adapter Inventory ─────────────────────────────────────────────────────

  if (totals.adapterInventory.length > 0) {
    lines.push('## Adapter Inventory');
    lines.push('');
    lines.push('| Adapter Type | App Count | Known Gaps | Logic Apps Connector |');
    lines.push('|---|---|---|---|');
    for (const entry of totals.adapterInventory) {
      const gapFlag = entry.hasKnownGaps ? '⚠️ Yes' : '✅ No';
      const connector = ADAPTER_TO_CONNECTOR[entry.adapterType] ?? 'Review required';
      lines.push(`| ${entry.adapterType} | ${entry.appCount} | ${gapFlag} | ${connector} |`);
    }
    lines.push('');
  }

  // ── Gap Heat Map ──────────────────────────────────────────────────────────

  const allGaps = assessments.flatMap(a => a.gaps.map(g => ({ gap: g, appName: a.name })));
  if (allGaps.length > 0) {
    lines.push('## Gap Heat Map');
    lines.push('');
    lines.push('Aggregated across all applications. High instance count = widespread impact across estate.');
    lines.push('');

    // Group gaps by capability
    const gapMap = new Map<string, { severity: string; count: number; apps: Set<string>; mitigation: string }>();
    for (const { gap, appName } of allGaps) {
      const existing = gapMap.get(gap.capability);
      if (existing) {
        existing.count++;
        existing.apps.add(appName);
      } else {
        gapMap.set(gap.capability, {
          severity: gap.severity,
          count: 1,
          apps: new Set([appName]),
          mitigation: gap.mitigation,
        });
      }
    }

    // Sort: critical first, then by instance count descending
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sortedGaps = [...gapMap.entries()].sort((a, b) => {
      const sDiff = (severityOrder[a[1].severity] ?? 9) - (severityOrder[b[1].severity] ?? 9);
      return sDiff !== 0 ? sDiff : b[1].count - a[1].count;
    });

    lines.push('| Gap / Capability | Severity | Instances | Affected Apps | Mitigation |');
    lines.push('|---|---|---|---|---|');
    for (const [capability, data] of sortedGaps) {
      const severityEmoji = data.severity === 'critical' ? '🔴' : data.severity === 'high' ? '🟠' : data.severity === 'medium' ? '🟡' : '⚪';
      const affectedList = [...data.apps].slice(0, 3).join(', ') + (data.apps.size > 3 ? ` +${data.apps.size - 3}` : '');
      const shortMitigation = data.mitigation.length > 100
        ? data.mitigation.slice(0, data.mitigation.lastIndexOf(' ', 97) + 1).trimEnd() + '...'
        : data.mitigation;
      lines.push(`| ${capability} | ${severityEmoji} ${capitalize(data.severity)} | ${data.count} | ${affectedList} | ${shortMitigation} |`);
    }
    lines.push('');
  }

  // ── Infrastructure Requirements ───────────────────────────────────────────

  const serviceCountMap = new Map<string, number>();
  for (const a of assessments) {
    for (const svc of a.architecture.azureServicesRequired) {
      serviceCountMap.set(svc, (serviceCountMap.get(svc) ?? 0) + 1);
    }
  }

  if (serviceCountMap.size > 0) {
    lines.push('## Infrastructure Requirements');
    lines.push('');
    lines.push('Azure services needed across the estate, sorted by adoption count.');
    lines.push('');
    lines.push('| Azure Service | Required By (apps) | Notes |');
    lines.push('|---|---|---|');

    const sortedServices = [...serviceCountMap.entries()].sort((a, b) => b[1] - a[1]);
    for (const [svc, count] of sortedServices) {
      const label = SERVICE_LABELS[svc] ?? svc;
      const note = infraNote(svc, count);
      lines.push(`| ${label} | ${count} | ${note} |`);
    }
    lines.push('');
  }

  // ── Effort Summary ────────────────────────────────────────────────────────

  lines.push('## Effort Summary');
  lines.push('');

  const waveNums = [1, 2, 3, 4] as const;
  const activeWaves = waveNums.filter(w => assessments.some(a => a.wave === w));

  if (activeWaves.length > 0) {
    lines.push('| Wave | Apps | Effort (days) | Calendar Estimate (1 engineer) |');
    lines.push('|---|---|---|---|');

    let runningTotal = 0;
    for (const w of activeWaves) {
      const waveApps = assessments.filter(a => a.wave === w);
      const effort = waveApps.reduce((s, a) => s + a.estimatedEffortDays, 0);
      const weeks = Math.ceil(effort / 5);
      runningTotal += effort;
      lines.push(`| Wave ${w} | ${waveApps.length} | ${effort} | ~${weeks} week(s) |`);
    }
    lines.push(`| **Total** | **${assessments.length}** | **${totals.totalEstimatedEffortDays}** | **~${Math.ceil(totals.totalEstimatedEffortDays / 5)} week(s)** |`);
    lines.push('');
    lines.push(`> *Estimates assume 1 engineer, sequential migration. Parallel teams or pre-built automation can significantly reduce calendar time. Gap effort only — does not include Azure infrastructure setup, testing, or UAT.*`);
    lines.push('');

    // Suppress unused variable warning
    void runningTotal;
  }

  // ── Failures ─────────────────────────────────────────────────────────────

  if (failures.length > 0) {
    lines.push('## Parse Failures');
    lines.push('');
    lines.push(`${failures.length} application(s) could not be parsed and are excluded from the analysis above.`);
    lines.push('');
    for (const f of failures) {
      lines.push(`- **${f.name}** (\`${f.dirPath}\`): ${f.error}`);
    }
    lines.push('');
    lines.push('**Recommendation:** Check that each application directory contains `.odx`, `.btm`, `.btp`, or `BindingInfo.xml` files. Some directories may be infrastructure projects (not BizTalk applications) and can be safely ignored.');
    lines.push('');
  }

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

function collectAdapterTypes(a: AppAssessment): string[] {
  const types = new Set<string>();
  for (const b of a.app.bindingFiles) {
    for (const r of b.receiveLocations) if (r.adapterType) types.add(r.adapterType);
    for (const s of b.sendPorts)        if (s.adapterType) types.add(s.adapterType);
  }
  return [...types];
}

function infraNote(svc: string, count: number): string {
  switch (svc) {
    case 'integration-account':  return `Required for XSLT map execution (${count} app${count > 1 ? 's' : ''})`;
    case 'on-prem-data-gateway': return 'Required for FILE/SQL/SAP on-premises adapters';
    case 'service-bus':          return 'SB-Messaging, MSMQ, or pub-sub migration';
    case 'azure-functions':      return 'Custom C# components or no-equivalent adapters';
    case 'key-vault':            return 'All connection strings stored as secrets (mandatory)';
    case 'logic-apps-standard':  return 'Single-tenant, stateful — target for all BizTalk migrations';
    case 'event-hubs':           return 'Event Hubs adapter or high-throughput messaging';
    case 'event-grid':           return 'Pub-sub redesign or event-driven fan-out';
    case 'api-management':       return 'SOAP/REST API exposure and transformation';
    case 'azure-relay':          return 'WCF-NetTcp hybrid connectivity';
    default:                     return '';
  }
}
