# BizTalk to Logic Apps — VS Code Extension

Migrate BizTalk Server applications to Azure Logic Apps Standard from inside VS Code:
analyze `.odx` / `.btm` / `.btp` artifacts, review gap analysis and architecture
recommendations, and run the one-command migration pipeline.

This directory holds the **VS Code extension manifest and packaging output**. The
extension source lives at `src/vscode/` in the repository root and shares the
analysis/build engine with the `biztalk-migrate` npm CLI.

## Why a separate manifest?

The repository root `package.json` is the **npm package** (CLI + MCP server): its
`main` is `dist/cli/index.js` and it publishes to npm. A VS Code extension needs
`main` to point at the extension entry module and is packaged with `vsce`, not npm.
One `package.json` cannot serve both, so the VS Code-specific fields
(`publisher`, `engines.vscode`, `activationEvents`, `contributes`, extension `main`)
live here, and the two manifests' versions are kept in sync by the build script.

The extension entry is bundled to **CommonJS** (`dist/vscode/extension.cjs`) because
the VS Code extension host does not load ESM extension modules, while the repo is an
ESM package. The MCP server is bundled separately (`dist/mcp-server/server.mjs`) and
spawned as a normal Node child process, so it stays ESM.

## Build

From the **repository root**:

```bash
npm install
npm run build:vscode     # tsc build + esbuild bundles into vscode-extension/dist/
npm run package:vscode   # build + `vsce package` -> vscode-extension/*.vsix
```

`scripts/build-vscode-extension.mjs` does the bundling:

- `src/vscode/extension.ts` → `vscode-extension/dist/vscode/extension.cjs`
  (CJS, single file, `vscode` external, engine code inlined)
- `src/mcp-server/server.ts` → `vscode-extension/dist/mcp-server/server.mjs`
  (ESM, single file, spawned by the "Start MCP Server" command)
- Syncs `version` from the root `package.json` and copies `LICENSE`.

Bundle paths are two directory levels below the extension root on purpose: the
licensing and MCP-server code resolve their package version via
`join(__dirname, '../../package.json')`, which lands on this directory's manifest.

## Develop / debug

1. `npm run build:vscode` at the repo root.
2. Open the `vscode-extension/` folder in VS Code.
3. Press F5 (Run Extension) — or use the Extensions view "Install from VSIX..."
   with the packaged `.vsix`.

## Install the packaged extension

```bash
code --install-extension vscode-extension/biztalk-migrate-<version>.vsix
```
