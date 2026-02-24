/**
 * Stage 1: Understand
 * Exports all analysis functions for parsing BizTalk artifacts.
 */

export { analyzeOrchestration, analyzeOrchestrationXml, flattenShapes, OdxParseError } from './orchestration-analyzer.js';
export { analyzeMap, analyzeMapXml, BtmParseError } from './map-analyzer.js';
export { analyzePipeline, analyzePipelineXml, BtpParseError } from './pipeline-analyzer.js';
export { analyzeBindings, analyzeBindingsXml, BindingParseError } from './binding-analyzer.js';
export { detectPatterns, detectOrchestrationPatterns } from './pattern-detector.js';
export { scoreApplication, scoreOrchestration } from './complexity-scorer.js';
export type { ComplexityBreakdown, ComplexityContributor } from './complexity-scorer.js';

import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { analyzeOrchestration } from './orchestration-analyzer.js';
import { analyzeMap } from './map-analyzer.js';
import { analyzePipeline } from './pipeline-analyzer.js';
import { analyzeBindings } from './binding-analyzer.js';
import { detectPatterns } from './pattern-detector.js';
import { scoreApplication } from './complexity-scorer.js';
import type { BizTalkApplication, BizTalkVersion } from '../types/biztalk.js';

/**
 * Analyzes a complete BizTalk application directory.
 * Discovers all .odx, .btm, .btp, and BindingInfo.xml files recursively
 * and produces a BizTalkApplication aggregate.
 */
export async function analyzeApplication(
  dirPath: string,
  options: { version?: BizTalkVersion; name?: string } = {}
): Promise<BizTalkApplication> {
  const files = await findArtifactFiles(dirPath);

  // Parse all artifact types in parallel
  const [orchestrations, maps, pipelines, bindingFiles] = await Promise.all([
    Promise.allSettled(files.odx.map(f => analyzeOrchestration(f))),
    Promise.allSettled(files.btm.map(f => analyzeMap(f))),
    Promise.allSettled(files.btp.map(f => analyzePipeline(f))),
    Promise.allSettled(files.bindings.map(f => analyzeBindings(f))),
  ]);

  // Collect successful parses (log failures but continue)
  const parsedOrchestrations = orchestrations
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof analyzeOrchestration>>> => r.status === 'fulfilled')
    .map(r => r.value);
  const parsedMaps = maps
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof analyzeMap>>> => r.status === 'fulfilled')
    .map(r => r.value);
  const parsedPipelines = pipelines
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof analyzePipeline>>> => r.status === 'fulfilled')
    .map(r => r.value);
  const parsedBindings = bindingFiles
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof analyzeBindings>>> => r.status === 'fulfilled')
    .map(r => r.value);

  const partial: BizTalkApplication = {
    name: options.name ?? basename(dirPath),
    biztalkVersion: options.version ?? 'unknown',
    orchestrations: parsedOrchestrations,
    maps: parsedMaps,
    pipelines: parsedPipelines,
    schemas: [],   // Schema analysis can be added in a later iteration
    bindingFiles: parsedBindings,
    complexityScore: 0,
    complexityClassification: 'simple',
  };

  // Compute complexity
  const { totalScore, classification } = scoreApplication(partial);
  return { ...partial, complexityScore: totalScore, complexityClassification: classification };
}

// ─── File Discovery ────────────────────────────────────────────────────────────

interface ArtifactFiles {
  odx: string[];
  btm: string[];
  btp: string[];
  bindings: string[];
}

async function findArtifactFiles(dirPath: string): Promise<ArtifactFiles> {
  const result: ArtifactFiles = { odx: [], btm: [], btp: [], bindings: [] };
  await walkDir(dirPath, result);
  return result;
}

async function walkDir(dir: string, result: ArtifactFiles): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry);
    try {
      const info = await stat(fullPath);
      if (info.isDirectory()) {
        // Skip common non-artifact directories
        if (!['node_modules', '.git', 'dist', 'bin', 'obj'].includes(entry)) {
          await walkDir(fullPath, result);
        }
      } else {
        const ext = extname(entry).toLowerCase();
        const name = basename(entry).toLowerCase();
        if (ext === '.odx' || name.endsWith('.odx.xml')) result.odx.push(fullPath);
        else if (ext === '.btm') result.btm.push(fullPath);
        else if (ext === '.btp') result.btp.push(fullPath);
        else if (name === 'bindinginfo.xml' || name.includes('binding')) result.bindings.push(fullPath);
      }
    } catch {
      // Skip unreadable files
    }
  }));
}
