#!/usr/bin/env node
/**
 * Builds the VS Code extension bundles into vscode-extension/dist/.
 *
 * The repository root package.json is the npm CLI/MCP package (ESM,
 * main: dist/cli/index.js). The VS Code extension host requires a CommonJS
 * entry module, and the extension manifest lives in vscode-extension/package.json.
 * This script bridges the two:
 *
 *   src/vscode/extension.ts   -> vscode-extension/dist/vscode/extension.cjs  (CJS bundle)
 *   src/mcp-server/server.ts  -> vscode-extension/dist/mcp-server/server.mjs (ESM bundle,
 *                                spawned as a child process by "Start MCP Server")
 *
 * Both bundles sit exactly two directory levels below the extension root because
 * licensing/license-validator.ts and mcp-server/server.ts read their version via
 * join(__dirname, '../../package.json') — inside the packaged extension that
 * resolves to vscode-extension/package.json, whose version this script syncs.
 */

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const extRoot = join(repoRoot, 'vscode-extension');

// ── Shared esbuild options ────────────────────────────────────────────────────
const common = {
  bundle: true,
  platform: 'node',
  target: 'node18', // VS Code 1.85+ ships Node 18
  sourcemap: true,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

// ── 1. Extension entry (CommonJS — required by the VS Code extension host) ───
// import.meta.url appears in bundled engine code (licensing); in a CJS bundle it
// would be empty, so rewrite it to a __filename-derived URL.
await build({
  ...common,
  entryPoints: [join(repoRoot, 'src/vscode/extension.ts')],
  outfile: join(extRoot, 'dist/vscode/extension.cjs'),
  format: 'cjs',
  external: ['vscode'],
  define: {
    ...common.define,
    'import.meta.url': '__importMetaUrl',
  },
  banner: {
    js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
});

// ── 2. MCP server (ESM bundle, run as a separate node process) ───────────────
// createRequire banner: esbuild's ESM output cannot express dynamic require()
// calls that CJS dependencies make at runtime without it.
await build({
  ...common,
  entryPoints: [join(repoRoot, 'src/mcp-server/server.ts')],
  outfile: join(extRoot, 'dist/mcp-server/server.mjs'),
  format: 'esm',
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});

// ── 3. Bundled MCP example resources (training pairs) ────────────────────────
const examples = [
  ['tests/fixtures/02-simple-file-receive/training-pair.json', 'dist/mcp-server/resources/examples/02-simple-file-receive.training-pair.json'],
  ['tests/fixtures/03-content-based-routing/training-pair.json', 'dist/mcp-server/resources/examples/03-content-based-routing.training-pair.json'],
];
for (const [src, dest] of examples) {
  const target = join(extRoot, dest);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(repoRoot, src), target);
}

// ── 4. Sync version from the root package.json + copy LICENSE ────────────────
const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
const extPkgPath = join(extRoot, 'package.json');
const extPkg = JSON.parse(readFileSync(extPkgPath, 'utf-8'));
if (extPkg.version !== rootPkg.version) {
  extPkg.version = rootPkg.version;
  writeFileSync(extPkgPath, `${JSON.stringify(extPkg, null, 2)}\n`);
  console.log(`[build:vscode] Synced extension version -> ${rootPkg.version}`);
}
copyFileSync(join(repoRoot, 'LICENSE'), join(extRoot, 'LICENSE'));

console.log('[build:vscode] Done. Output: vscode-extension/dist/');
