/**
 * Template Browser Panel
 *
 * WebviewPanel that renders the Premium template library.
 * Allows consultants to browse, search, and clone integration templates
 * without leaving VS Code.
 *
 * Uses the same template-library data that the CLI / MCP tools expose,
 * so the list is always in sync.
 */

import * as vscode from 'vscode';
import { listTemplates, getTemplate } from '../../greenfield/template-library.js';
import type { WorkflowTemplate } from '../../greenfield/template-library.js';

// ─── Panel ────────────────────────────────────────────────────────────────────

export class TemplateBrowserPanel {
  private static readonly viewType = 'biztalkMigrateTemplates';
  private static current: TemplateBrowserPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  // ── Factory ──────────────────────────────────────────────────────────────

  static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (TemplateBrowserPanel.current) {
      TemplateBrowserPanel.current._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      TemplateBrowserPanel.viewType,
      'Template Library',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    TemplateBrowserPanel.current = new TemplateBrowserPanel(panel);
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;

    const templates = listTemplates();
    this._panel.webview.html = getTemplateBrowserHtml(templates);

    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: { command: string; payload?: unknown }) => {
        switch (message.command) {
          case 'useTemplate': {
            const id = message.payload as string;
            this._handleUseTemplate(id);
            break;
          }
          case 'createFromNlp':
            void vscode.commands.executeCommand('biztalk-migrate.createFromNlp');
            break;
        }
      },
      null,
      this._disposables
    );
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private _handleUseTemplate(id: string): void {
    const template = getTemplate(id);
    if (!template) {
      void vscode.window.showErrorMessage(`Template "${id}" not found.`);
      return;
    }

    // Show a quick pick to decide what to do with the template
    void vscode.window.showQuickPick(
      [
        { label: '$(terminal) Use in NLP Builder', description: 'Refine this template with a natural language description', id: 'nlp' },
        { label: '$(json) Copy JSON to Clipboard', description: 'Copy the template intent JSON', id: 'copy' },
      ],
      { title: `Template: ${template.name}`, placeHolder: 'How would you like to use this template?' }
    ).then(pick => {
      if (!pick) return;
      if (pick.id === 'nlp') {
        void vscode.commands.executeCommand('biztalk-migrate.createFromNlp');
      } else if (pick.id === 'copy') {
        void vscode.env.clipboard.writeText(JSON.stringify(template.intent, null, 2));
        void vscode.window.showInformationMessage(`Template "${template.name}" intent copied to clipboard.`);
      }
    });
  }

  // ── Dispose ───────────────────────────────────────────────────────────────

  private _dispose(): void {
    TemplateBrowserPanel.current = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }
}

// ─── HTML Generator ───────────────────────────────────────────────────────────

function getTemplateBrowserHtml(templates: WorkflowTemplate[]): string {
  const cards = templates.map(t => `
    <div class="template-card" data-id="${escapeAttr(t.id)}">
      <div class="template-header">
        <span class="template-name">${escapeHtml(t.name)}</span>
        <span class="template-category">${escapeHtml(t.category)}</span>
      </div>
      <p class="template-desc">${escapeHtml(t.description)}</p>
      <div class="template-tags">
        ${t.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
      </div>
      <button class="btn" onclick="useTemplate('${escapeAttr(t.id)}')">Use Template</button>
    </div>
  `).join('');

  const emptyState = templates.length === 0 ? `
    <div style="text-align:center;padding:48px;color:var(--vscode-descriptionForeground);">
      <p style="font-size:32px;margin-bottom:8px;">📋</p>
      <p>No templates available. Templates require a Premium license.</p>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Template Library</title>
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
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 24px; }
    .search-bar {
      width: 100%; padding: 8px 12px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      color: var(--vscode-input-foreground);
      border-radius: 4px; font-size: 13px;
      margin-bottom: 20px;
      outline: none;
    }
    .search-bar:focus { border-color: var(--vscode-focusBorder); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .template-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      padding: 16px;
      transition: border-color 0.1s;
    }
    .template-card:hover { border-color: var(--vscode-focusBorder); }
    .template-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .template-name { font-weight: bold; font-size: 14px; }
    .template-category {
      font-size: 11px; padding: 2px 8px; border-radius: 10px;
      background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    }
    .template-desc { margin: 0 0 10px; font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
    .template-tags { margin-bottom: 12px; }
    .tag {
      display: inline-block; padding: 1px 7px; border-radius: 8px;
      font-size: 11px; margin: 2px;
      background: var(--vscode-textBlockQuote-background);
      color: var(--vscode-descriptionForeground);
    }
    .btn {
      padding: 5px 14px; border-radius: 4px; border: none;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      font-size: 12px; cursor: pointer;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .toolbar { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
    .count { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <h1>📋 Template Library</h1>
  <p class="subtitle">Premium integration templates for Azure Logic Apps Standard</p>

  <input type="text" class="search-bar" id="search" placeholder="Search templates by name, category, or tag…" oninput="filterTemplates(this.value)">

  <div class="toolbar">
    <span class="count" id="count">${templates.length} template${templates.length !== 1 ? 's' : ''}</span>
    <button class="btn" onclick="vscode.postMessage({command:'createFromNlp'})" style="margin-left:auto;">
      + Create from Description (NLP)
    </button>
  </div>

  <div class="grid" id="grid">
    ${cards}
    ${emptyState}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const allCards = Array.from(document.querySelectorAll('.template-card'));

    function useTemplate(id) {
      vscode.postMessage({ command: 'useTemplate', payload: id });
    }

    function filterTemplates(query) {
      const q = query.toLowerCase().trim();
      let visible = 0;
      allCards.forEach(card => {
        const text = card.textContent.toLowerCase();
        const match = !q || text.includes(q);
        card.classList.toggle('hidden', !match);
        if (match) visible++;
      });
      document.getElementById('count').textContent =
        visible + ' template' + (visible !== 1 ? 's' : '');
    }
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

function escapeAttr(str: string): string {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
