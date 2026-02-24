/**
 * VS Code Extension Entry Point — BizTalk to Logic Apps
 *
 * Registers VS Code commands, activates the MCP server as a child process,
 * and provides the migration UI panels.
 *
 * Commands registered:
 *   biztalk-migrate.analyzeFile       Analyze a .odx/.btm/.btp file opened in editor
 *   biztalk-migrate.analyzeDirectory  Analyze all artifacts in a selected folder
 *   biztalk-migrate.buildPackage      Build Logic Apps package from migration spec
 *   biztalk-migrate.openDashboard     Open the migration dashboard WebviewPanel
 *   biztalk-migrate.startMcpServer    Manually start the MCP server
 *   biztalk-migrate.createFromNlp     [Premium] Create workflow from description
 *   biztalk-migrate.listTemplates     [Premium] Browse template library
 *
 * The extension activates on:
 *   - Opening .odx, .btm, .btp, or binding XML files
 *   - Workspace containing biztalk-migrate.config.json
 */

import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { join, extname } from 'path';
import { existsSync } from 'fs';

// ─── Extension State ──────────────────────────────────────────────────────────

let mcpServerProcess: ChildProcess | null = null;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  outputChannel  = vscode.window.createOutputChannel('BizTalk Migrate');
  statusBarItem  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text  = '$(cloud-upload) BizTalk Migrate';
  statusBarItem.tooltip = 'BizTalk to Logic Apps Migration Tool';
  statusBarItem.command = 'biztalk-migrate.openDashboard';
  statusBarItem.show();

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('biztalk-migrate.analyzeFile',       () => analyzeActiveFile(context)),
    vscode.commands.registerCommand('biztalk-migrate.analyzeDirectory',  () => analyzeDirectory(context)),
    vscode.commands.registerCommand('biztalk-migrate.buildPackage',      () => buildPackageCommand(context)),
    vscode.commands.registerCommand('biztalk-migrate.openDashboard',     () => openDashboard(context)),
    vscode.commands.registerCommand('biztalk-migrate.startMcpServer',    () => startMcpServer(context)),
    vscode.commands.registerCommand('biztalk-migrate.createFromNlp',     () => createFromNlp(context)),
    vscode.commands.registerCommand('biztalk-migrate.listTemplates',     () => listTemplates(context)),
    statusBarItem,
    outputChannel,
  );

  // Auto-start MCP server if config present
  const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsPath && existsSync(join(wsPath, 'biztalk-migrate.config.json'))) {
    void startMcpServer(context);
  }

  outputChannel.appendLine('BizTalk to Logic Apps extension activated.');
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate(): void {
  if (mcpServerProcess) {
    mcpServerProcess.kill();
    mcpServerProcess = null;
  }
  outputChannel.appendLine('BizTalk to Logic Apps extension deactivated.');
}

// ─── Command Implementations ──────────────────────────────────────────────────

async function analyzeActiveFile(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showErrorMessage('No file is open. Open a .odx, .btm, .btp, or binding XML file first.');
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const ext      = extname(filePath).toLowerCase();
  const validExts = ['.odx', '.btm', '.btp', '.xml'];

  if (!validExts.includes(ext)) {
    void vscode.window.showWarningMessage(`Unsupported file type: ${ext}. Expected .odx, .btm, .btp, or binding .xml`);
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Analyzing BizTalk artifact...', cancellable: false },
    async () => {
      outputChannel.appendLine(`Analyzing: ${filePath}`);
      outputChannel.show();
      // In a full implementation, this would call the analyze engine directly
      // and display results in a WebviewPanel
      void vscode.window.showInformationMessage(
        `Analysis started for ${filePath}. Results will appear in the Migration Dashboard.`,
        'Open Dashboard'
      ).then(sel => {
        if (sel === 'Open Dashboard') {
          void vscode.commands.executeCommand('biztalk-migrate.openDashboard');
        }
      });
    }
  );
}

async function analyzeDirectory(context: vscode.ExtensionContext): Promise<void> {
  const folder = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles:   false,
    canSelectMany:    false,
    openLabel:        'Select BizTalk Project Folder',
  });

  if (!folder || folder.length === 0) return;
  const dirPath = folder[0].fsPath;

  const appName = await vscode.window.showInputBox({
    prompt:      'Enter the BizTalk application name',
    placeHolder: 'MyBizTalkApp',
    value:       dirPath.split('/').pop(),
  });

  if (!appName) return;

  outputChannel.appendLine(`Analyzing directory: ${dirPath} (app: ${appName})`);
  outputChannel.show();

  void vscode.window.showInformationMessage(
    `Analysis queued for "${appName}". This may take a moment for large applications.`
  );
}

async function buildPackageCommand(context: vscode.ExtensionContext): Promise<void> {
  const specFile = await vscode.window.showOpenDialog({
    canSelectFolders: false,
    canSelectFiles:   true,
    canSelectMany:    false,
    openLabel:        'Select migration-spec.json',
    filters:          { 'JSON files': ['json'] },
  });

  if (!specFile || specFile.length === 0) return;

  const outputDir = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles:   false,
    canSelectMany:    false,
    openLabel:        'Select Output Folder',
  });

  if (!outputDir || outputDir.length === 0) return;

  outputChannel.appendLine(`Building Logic Apps package from: ${specFile[0].fsPath}`);
  outputChannel.appendLine(`Output directory: ${outputDir[0].fsPath}`);
  outputChannel.show();

  void vscode.window.showInformationMessage('Package build started. See output channel for progress.');
}

function openDashboard(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    'biztalkMigrateDashboard',
    'BizTalk Migration Dashboard',
    vscode.ViewColumn.One,
    {
      enableScripts:    true,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = getDashboardHtml(panel.webview, context);
}

async function startMcpServer(context: vscode.ExtensionContext): Promise<void> {
  if (mcpServerProcess) {
    void vscode.window.showInformationMessage('MCP server is already running.');
    return;
  }

  const serverPath = join(context.extensionPath, 'dist', 'mcp-server', 'server.js');
  if (!existsSync(serverPath)) {
    void vscode.window.showErrorMessage('MCP server not found. Run npm run build first.');
    return;
  }

  const licenseKey = vscode.workspace.getConfiguration('biztalkMigrate').get<string>('licenseKey');

  mcpServerProcess = spawn('node', [serverPath], {
    env:   { ...process.env, BIZTALK_LICENSE_KEY: licenseKey ?? '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  mcpServerProcess.stderr?.on('data', (data: Buffer) => {
    outputChannel.appendLine(`[MCP Server] ${data.toString().trim()}`);
  });

  mcpServerProcess.on('exit', (code) => {
    outputChannel.appendLine(`[MCP Server] Exited with code ${code}`);
    mcpServerProcess = null;
    statusBarItem.text = '$(warning) BizTalk Migrate (server stopped)';
  });

  statusBarItem.text = '$(sync~spin) BizTalk Migrate (MCP running)';
  outputChannel.appendLine('[MCP Server] Started.');
}

async function createFromNlp(context: vscode.ExtensionContext): Promise<void> {
  const description = await vscode.window.showInputBox({
    prompt:      '[Premium] Describe your integration in plain English',
    placeHolder: 'e.g., Poll SFTP every 5 minutes for CSV files, transform to JSON, POST to API...',
    ignoreFocusOut: true,
  });

  if (!description) return;

  outputChannel.appendLine(`Creating workflow from NLP description: ${description}`);
  outputChannel.show();
  void vscode.window.showInformationMessage('Workflow design in progress. See Migration Dashboard for results.');
  openDashboard(context);
}

function listTemplates(context: vscode.ExtensionContext): void {
  void vscode.commands.executeCommand('biztalk-migrate.openDashboard');
}

// ─── Dashboard WebView ────────────────────────────────────────────────────────

function getDashboardHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>BizTalk Migration Dashboard</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      margin: 0;
    }
    h1 { color: var(--vscode-textLink-foreground); margin-bottom: 4px; }
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 24px; }
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .card h3 { margin-top: 0; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: bold;
      margin-left: 8px;
    }
    .badge-premium { background: #7c3aed; color: white; }
    .badge-free    { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .step { margin-bottom: 12px; }
    .step-num {
      display: inline-block;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      text-align: center;
      line-height: 24px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 8px;
    }
  </style>
</head>
<body>
  <h1>⚙ BizTalk to Logic Apps</h1>
  <p class="subtitle">Migration framework for Azure Logic Apps Standard</p>

  <div class="card">
    <h3>Mode A — BizTalk Migration <span class="badge badge-free">FREE TIER: Analyze + Document</span></h3>
    <div class="step"><span class="step-num">1</span> <strong>Analyze</strong> — Open a .odx/.btm/.btp file and run "Analyze BizTalk Artifact"</div>
    <div class="step"><span class="step-num">2</span> <strong>Document</strong> — Review gap analysis, architecture recommendation, and migration spec</div>
    <div class="step"><span class="step-num">3</span> <strong>Build</strong> — Generate Logic Apps deployment package (requires Standard license)</div>
  </div>

  <div class="card">
    <h3>Mode B — Greenfield NLP Builder <span class="badge badge-premium">PREMIUM</span></h3>
    <div class="step"><span class="step-num">1</span> <strong>Describe</strong> — Use "Create Workflow from Description" command</div>
    <div class="step"><span class="step-num">2</span> <strong>Design</strong> — Review the generated architecture specification</div>
    <div class="step"><span class="step-num">3</span> <strong>Build</strong> — Generate the complete Logic Apps package</div>
  </div>

  <div class="card">
    <h3>Quick Start</h3>
    <ul>
      <li>Open a BizTalk project folder in VS Code</li>
      <li>Open a .odx file and use Ctrl+Shift+P → "BizTalk: Analyze File"</li>
      <li>Or use the Claude AI chat with the MCP server running</li>
    </ul>
    <p><em>Set your license key in VS Code Settings → Extensions → BizTalk Migrate → License Key</em></p>
  </div>
</body>
</html>`;
}
