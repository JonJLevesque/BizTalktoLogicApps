/**
 * Artifact Parser — Shared parse utilities for the migration pipeline
 *
 * Extracted from migration-runner.ts so that both the single-app runner
 * and the estate runner can reuse the same artifact-loading logic.
 *
 * Handles UTF-16 LE encoding that real BizTalk artifacts use, via the
 * file-path variants of each analyzer (analyzeOrchestration, analyzeMap, etc.)
 * rather than the Xml variants.
 */

import type {
  BizTalkApplication,
  ParsedOrchestration,
  ParsedMap,
  ParsedPipeline,
  ParsedBindingFile,
} from '../types/biztalk.js';
import type { ArtifactInventory } from '../mcp-server/tools/file-tools.js';

import { analyzeOrchestration } from '../stage1-understand/orchestration-analyzer.js';
import { analyzeMap }           from '../stage1-understand/map-analyzer.js';
import { analyzePipeline }      from '../stage1-understand/pipeline-analyzer.js';
import { analyzeBindings }      from '../stage1-understand/binding-analyzer.js';
import { scoreApplication }     from '../stage1-understand/complexity-scorer.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse all BizTalk artifacts from a pre-scanned inventory.
 * Collects errors per-artifact (non-fatal) and returns a BizTalkApplication
 * with complexity scored.
 */
export async function parseArtifacts(
  inventory: ArtifactInventory,
  appName: string,
  errors: string[],
  onStep: (msg: string) => void
): Promise<BizTalkApplication> {
  const orchestrations: ParsedOrchestration[] = [];
  const maps: ParsedMap[] = [];
  const pipelines: ParsedPipeline[] = [];
  const bindingFiles: ParsedBindingFile[] = [];

  for (const f of inventory.orchestrations) {
    try {
      onStep(`Parsing orchestration: ${f.split('/').pop()}`);
      // Use analyzeOrchestration (not analyzeOrchestrationXml) — it calls readBizTalkFile
      // which handles UTF-16 LE encoding and strips the #if __DESIGNER_DATA preprocessor block.
      orchestrations.push(await analyzeOrchestration(f));
    } catch (err) {
      errors.push(`Failed to parse orchestration ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const f of inventory.maps) {
    try {
      onStep(`Parsing map: ${f.split('/').pop()}`);
      // Use analyzeMap (not analyzeMapXml) — it calls readBizTalkFile for UTF-16 LE support.
      maps.push(await analyzeMap(f));
    } catch (err) {
      errors.push(`Failed to parse map ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const f of inventory.pipelines) {
    try {
      onStep(`Parsing pipeline: ${f.split('/').pop()}`);
      // Use analyzePipeline (not analyzePipelineXml) — it calls readBizTalkFile for UTF-16 LE support.
      pipelines.push(await analyzePipeline(f));
    } catch (err) {
      errors.push(`Failed to parse pipeline ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const f of inventory.bindings) {
    try {
      onStep(`Parsing bindings: ${f.split('/').pop()}`);
      // Use analyzeBindings (not analyzeBindingsXml) — it calls readBizTalkFile
      // which handles UTF-16 LE encoding that real BizTalk BindingInfo.xml files use.
      bindingFiles.push(await analyzeBindings(f));
    } catch (err) {
      errors.push(`Failed to parse bindings ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const app: BizTalkApplication = {
    name: appName,
    biztalkVersion: 'unknown',
    orchestrations,
    maps,
    pipelines,
    schemas: [],
    bindingFiles,
    complexityScore: 0,
    complexityClassification: 'moderate',
  };

  const complexity = scoreApplication(app);
  app.complexityScore = complexity.totalScore;
  app.complexityClassification = complexity.classification;

  return app;
}
