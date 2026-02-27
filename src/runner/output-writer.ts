/**
 * Output Writer — Write BuildResult + migration-report.md to disk
 *
 * Produces a Logic Apps Standard project layout:
 *
 *   {outputDir}/
 *     {WorkflowName}/
 *       workflow.json
 *     Maps/
 *       {MapName}.xslt
 *       {MapName}.lml
 *     AzureFunctions/
 *       {FunctionName}.csx
 *     connections.json
 *     host.json
 *     local.settings.json
 *     arm-template.json        (if infrastructure included)
 *     arm-parameters.json      (if infrastructure included)
 *     tests/
 *       {WorkflowName}.tests.json
 *     migration-report.md
 */

import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, basename } from 'path';
import type { BuildResult } from '../stage3-build/package-builder.js';

export interface WriteOptions {
  /** The directory to write all output files to */
  outputDir: string;
  /** The fully generated BuildResult from the scaffold step */
  buildResult: BuildResult;
  /** The markdown migration report */
  migrationReport: string;
}

export function writeOutput(options: WriteOptions): void {
  const { outputDir, buildResult, migrationReport } = options;

  ensureDir(outputDir);

  // ── Workflows ───────────────────────────────────────────────────────────────
  for (const wf of buildResult.project.workflows) {
    const wfDir = join(outputDir, wf.name);
    ensureDir(wfDir);
    writeJson(join(wfDir, 'workflow.json'), wf.workflow);
  }

  // ── Root project files ──────────────────────────────────────────────────────
  writeJson(join(outputDir, 'connections.json'), buildResult.project.connections);
  writeJson(join(outputDir, 'host.json'), buildResult.project.host);
  writeJson(join(outputDir, 'local.settings.json'), buildResult.localSettings);

  // ── Maps ────────────────────────────────────────────────────────────────────
  const hasXslt = Object.keys(buildResult.project.xsltMaps).length > 0;
  const hasLml  = Object.keys(buildResult.project.lmlMaps).length > 0;

  if (hasXslt || hasLml) {
    const mapsDir = join(outputDir, 'Maps');
    ensureDir(mapsDir);
    for (const [name, content] of Object.entries(buildResult.project.xsltMaps)) {
      writeFileSync(join(mapsDir, name), content, 'utf-8');
    }
    for (const [name, content] of Object.entries(buildResult.project.lmlMaps)) {
      writeFileSync(join(mapsDir, name), content, 'utf-8');
    }
  }

  // ── ARM Infrastructure ──────────────────────────────────────────────────────
  if (buildResult.armTemplate && Object.keys(buildResult.armTemplate).length > 0) {
    writeJson(join(outputDir, 'arm-template.json'), buildResult.armTemplate);
    writeJson(join(outputDir, 'arm-parameters.json'), buildResult.armParameters);
  }

  // ── Test specs ──────────────────────────────────────────────────────────────
  if (buildResult.testSpecs && Object.keys(buildResult.testSpecs).length > 0) {
    const testsDir = join(outputDir, 'tests');
    ensureDir(testsDir);
    for (const [name, content] of Object.entries(buildResult.testSpecs)) {
      writeFileSync(join(testsDir, name), String(content), 'utf-8');
    }
  }

  // ── XSD Schemas ─────────────────────────────────────────────────────────────
  if (buildResult.schemaFiles && buildResult.schemaFiles.length > 0) {
    const schemasDir = join(outputDir, 'Schemas');
    ensureDir(schemasDir);
    for (const schemaPath of buildResult.schemaFiles) {
      try {
        copyFileSync(schemaPath, join(schemasDir, basename(schemaPath)));
      } catch {
        // Non-fatal: schema file may have moved since artifact scan
      }
    }
  }

  // ── VS Code workspace file ───────────────────────────────────────────────────
  const appName = buildResult.project.appName;
  const workspace = {
    folders: [{ path: '.' }],
    settings: {
      'azureLogicAppsStandard.showAutoTriggerKey': true,
    },
    extensions: {
      recommendations: [
        'ms-azuretools.vscode-azurelogicapps',
      ],
    },
  };
  writeJson(join(outputDir, `${appName}.code-workspace`), workspace);

  // ── Migration report ────────────────────────────────────────────────────────
  writeFileSync(join(outputDir, 'migration-report.md'), migrationReport, 'utf-8');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
