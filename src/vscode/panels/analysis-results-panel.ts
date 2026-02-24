/**
 * Analysis Results Panel
 *
 * WebviewPanel that renders the output of a BizTalk artifact analysis:
 *   - Orchestration / binding / map / pipeline summary
 *   - Complexity score + classification
 *   - Detected integration patterns
 *   - Gap analysis with severity badges
 *   - Architecture recommendation
 *
 * The panel is populated by calling AnalysisResultsPanel.render(panel, result)
 * after the Stage 1 + Stage 2 pipeline completes.
 */

import * as vscode from 'vscode';
import type { MigrationPlan } from '../../stage2-document/migration-spec-generator.js';
import type { ComplexityBreakdown } from '../../stage1-understand/complexity-scorer.js';
import type { MigrationGap } from '../../types/migration.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AnalysisResult {
  appName:      string;
  complexity:   ComplexityBreakdown;
  patterns:     string[];
  gaps:         MigrationGap[];
  plan:         MigrationPlan;
}

export class AnalysisResultsPanel {
  private static readonly viewType = 'biztalkMigrateAnalysis';
  private static current: AnalysisResultsPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  // ── Factory ──────────────────────────────────────────────────────────────

  static createOrShow(context: vscode.ExtensionContext, result: AnalysisResult): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (AnalysisResultsPanel.current) {
      AnalysisResultsPanel.current._panel.reveal(column);
      AnalysisResultsPanel.current._update(result);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AnalysisResultsPanel.viewType,
      `Analysis: ${result.appName}`,
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    AnalysisResultsPanel.current = new AnalysisResultsPanel(panel, result);
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  private constructor(panel: vscode.WebviewPanel, result: AnalysisResult) {
    this._panel = panel;
    this._update(result);

    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: { command: string; payload?: unknown }) => {
        switch (message.command) {
          case 'openDashboard':
            void vscode.commands.executeCommand('biztalk-migrate.openDashboard');
            break;
          case 'buildPackage':
            void vscode.commands.executeCommand('biztalk-migrate.buildPackage');
            break;
        }
      },
      null,
      this._disposables
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _update(result: AnalysisResult): void {
    this._panel.title   = `Analysis: ${result.appName}`;
    this._panel.webview.html = getAnalysisHtml(result);
  }

  private _dispose(): void {
    AnalysisResultsPanel.current = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }
}

// ─── HTML Generator ───────────────────────────────────────────────────────────

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#ef4444';
    case 'high':     return '#f97316';
    case 'medium':   return '#eab308';
    case 'low':      return '#22c55e';
    default:         return 'var(--vscode-descriptionForeground)';
  }
}

function classificationColor(c: string): string {
  switch (c) {
    case 'simple':         return '#22c55e';
    case 'moderate':       return '#eab308';
    case 'complex':        return '#f97316';
    case 'highly-complex': return '#ef4444';
    default:               return 'var(--vscode-descriptionForeground)';
  }
}

function getAnalysisHtml(result: AnalysisResult): string {
  const { appName, complexity, patterns, gaps, plan } = result;

  const criticalCount = gaps.filter(g => g.severity === 'critical').length;
  const highCount     = gaps.filter(g => g.severity === 'high').length;

  const gapRows = gaps.map(g => `
    <tr>
      <td style="padding:6px 12px;"><strong>${escapeHtml(g.capability)}</strong></td>
      <td style="padding:6px 12px;">${escapeHtml(g.description)}</td>
      <td style="padding:6px 12px;">
        <span style="color:${severityColor(g.severity)};font-weight:bold;text-transform:uppercase;font-size:11px;">${g.severity}</span>
      </td>
      <td style="padding:6px 12px;font-size:12px;color:var(--vscode-descriptionForeground);">${escapeHtml(g.mitigation)}</td>
    </tr>
  `).join('');

  const mappingRows = plan.componentMappings.map(m => `
    <tr>
      <td style="padding:6px 12px;font-family:monospace;">${escapeHtml(m.sourceComponent)}</td>
      <td style="padding:6px 12px;">→</td>
      <td style="padding:6px 12px;font-family:monospace;">${escapeHtml(m.targetComponent)}</td>
      <td style="padding:6px 12px;font-size:11px;">${escapeHtml(m.migrationStatus)}</td>
    </tr>
  `).join('');

  const patternBadges = patterns.length > 0
    ? patterns.map(p => `<span class="badge">${escapeHtml(p)}</span>`).join(' ')
    : '<em style="color:var(--vscode-descriptionForeground)">None detected</em>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Analysis: ${escapeHtml(appName)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0; padding: 24px;
    }
    h1 { margin: 0 0 4px; color: var(--vscode-textLink-foreground); }
    h2 { margin: 24px 0 12px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); }
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 24px; }
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .metric-row { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 16px; }
    .metric { text-align: center; min-width: 80px; }
    .metric-value { font-size: 28px; font-weight: bold; line-height: 1; }
    .metric-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 12px;
      font-size: 11px; font-weight: bold;
      background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
      margin: 2px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead th {
      text-align: left; padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
    }
    tbody tr:hover { background: var(--vscode-list-hoverBackground); }
    .btn {
      display: inline-block; padding: 6px 16px; border-radius: 4px; border: none;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      font-size: 13px; cursor: pointer; margin-right: 8px;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    blockquote {
      margin: 0; padding: 12px 16px;
      border-left: 3px solid var(--vscode-textLink-foreground);
      background: var(--vscode-textBlockQuote-background);
      font-style: italic;
    }
  </style>
</head>
<body>
  <h1>⚙ ${escapeHtml(appName)}</h1>
  <p class="subtitle">BizTalk Migration Analysis — Stage 1 + Stage 2 Complete</p>

  <div class="card">
    <div class="metric-row">
      <div class="metric">
        <div class="metric-value" style="color:${classificationColor(complexity.classification)}">${complexity.totalScore}</div>
        <div class="metric-label">Complexity Score</div>
      </div>
      <div class="metric">
        <div class="metric-value" style="color:${classificationColor(complexity.classification)};font-size:18px;text-transform:capitalize;">${complexity.classification}</div>
        <div class="metric-label">Classification</div>
      </div>
      <div class="metric">
        <div class="metric-value" style="color:${criticalCount > 0 ? '#ef4444' : '#22c55e'}">${criticalCount}</div>
        <div class="metric-label">Critical Gaps</div>
      </div>
      <div class="metric">
        <div class="metric-value">${highCount}</div>
        <div class="metric-label">High Gaps</div>
      </div>
      <div class="metric">
        <div class="metric-value">${plan.gapAnalysis.estimatedEffortDays}</div>
        <div class="metric-label">Est. Days</div>
      </div>
    </div>
    <div>${patternBadges}</div>
  </div>

  ${plan.architectureRecommendation ? `
  <h2>Architecture Recommendation</h2>
  <div class="card">
    <blockquote>${escapeHtml(plan.architectureRecommendation)}</blockquote>
  </div>
  ` : ''}

  ${gaps.length > 0 ? `
  <h2>Gap Analysis (${gaps.length} items)</h2>
  <div class="card" style="padding:0;overflow:auto;">
    <table>
      <thead>
        <tr>
          <th>Component</th><th>Description</th><th>Severity</th><th>Recommendation</th>
        </tr>
      </thead>
      <tbody>${gapRows}</tbody>
    </table>
  </div>
  ` : ''}

  ${plan.componentMappings.length > 0 ? `
  <h2>Component Mappings (${plan.componentMappings.length})</h2>
  <div class="card" style="padding:0;overflow:auto;">
    <table>
      <thead>
        <tr><th>BizTalk Source</th><th></th><th>Logic Apps Target</th><th>Status</th></tr>
      </thead>
      <tbody>${mappingRows}</tbody>
    </table>
  </div>
  ` : ''}

  <div style="margin-top:24px;">
    <button class="btn" onclick="vscode.postMessage({command:'buildPackage'})">Build Logic Apps Package</button>
    <button class="btn btn-secondary" onclick="vscode.postMessage({command:'openDashboard'})">Open Dashboard</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
