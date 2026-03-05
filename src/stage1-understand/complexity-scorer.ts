/**
 * Complexity Scorer — Stage 1 (Understand)
 *
 * Assigns a numeric complexity score to a BizTalk application and
 * classifies it as simple / moderate / complex / highly-complex.
 *
 * The score determines:
 *   - How much effort the migration will require
 *   - Whether the tool can auto-generate most of the output (low score)
 *     or whether a human architect must review (high score)
 *   - Which sections of the migration plan to emphasize
 *
 * Scoring algorithm: sum of shape scores + adapter modifiers + gap penalties.
 * See docs/reference/component-mapping.md Section 7 for the scoring table.
 */

import type { BizTalkApplication, ParsedOrchestration, ParsedMap } from '../types/biztalk.js';
import type { ComplexityClass } from '../types/migration.js';

// ─── Score Constants ──────────────────────────────────────────────────────────

const SHAPE_SCORES: Record<string, number> = {
  // Simple shapes (direct mapping) — 1 point each
  ReceiveShape: 1,
  SendShape: 1,
  ConstructShape: 1,
  MessageAssignmentShape: 1,
  TransformShape: 1,
  DecisionShape: 1,
  TerminateShape: 1,
  ThrowShape: 1,
  DelayShape: 1,
  ExpressionShape: 1,
  GroupShape: 0,
  CommentShape: 0,

  // Moderate shapes — 3 points each
  LoopShape: 3,
  ListenShape: 3,
  ForEachShape: 3,
  ParallelActionsShape: 3,
  SuspendShape: 3,
  CallOrchestrationShape: 2,
  StartOrchestrationShape: 2,

  // Complex shapes — higher penalties
  CompensateShape: 10,
  CallRulesShape: 5,
};

const SCOPE_SCORES: Record<string, number> = {
  None: 1,
  LongRunning: 6,
  Atomic: 10,
};

const ADAPTER_PENALTIES: Record<string, number> = {
  'WCF-NetTcp': 5,
  'WCF-NetNamedPipe': 15,
  'WCF-Custom': 4,
  'WCF-CustomIsolated': 4,
  'WCF-WSHttp': 2,
  'MQSeries': 3,
  'WebSphere MQ': 3,
  'SAP': 3,
  'Siebel': 4,
  'PeopleSoft': 5,
  'JD Edwards': 5,
};

const GAP_PENALTIES = {
  hasAtomicTransactions: 8,
  hasLongRunningTransactions: 3,
  hasCompensation: 6,
  hasBRECalls: 5,       // per BRE call — multiplied below
  hasSuspend: 3,
  hasCustomPipelineComponents: 2,  // per custom component
  hasScriptingFunctoids: 2,
  hasDatabaseFunctoids: 3,
  hasMultipleCorrelationSets: 3,
  hasEdiFunctoids: 2,
};

// ─── Classification Thresholds ────────────────────────────────────────────────

const THRESHOLDS: Record<ComplexityClass, { min: number; max: number }> = {
  'simple':         { min: 0,  max: 10  },
  'moderate':       { min: 11, max: 25  },
  'complex':        { min: 26, max: 50  },
  'highly-complex': { min: 51, max: 100 },
};

// ─── Score Detail ─────────────────────────────────────────────────────────────

export interface ComplexityBreakdown {
  totalScore: number;
  classification: ComplexityClass;
  /** Itemized contributions to the score */
  contributors: ComplexityContributor[];
  /** Human-readable summary of what's driving the complexity */
  summary: string;
  /** Shapes that will need the most attention */
  hotSpots: string[];
}

export interface ComplexityContributor {
  label: string;
  score: number;
  category: 'shape' | 'adapter' | 'gap' | 'map';
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Scores a complete BizTalk application.
 * Returns both the numeric score and a detailed breakdown.
 */
export function scoreApplication(app: BizTalkApplication): ComplexityBreakdown {
  const contributors: ComplexityContributor[] = [];

  // Score each orchestration
  for (const orch of app.orchestrations) {
    contributors.push(...scoreOrchestration(orch));
  }

  // Score map complexity
  for (const map of app.maps) {
    contributors.push(...scoreMap(map));
  }

  // Score custom pipeline component penalties
  for (const pipeline of app.pipelines) {
    if (pipeline.hasCustomComponents) {
      const customCount = pipeline.components.filter(c => c.isCustom).length;
      contributors.push({
        label: `Pipeline ${pipeline.name}: ${customCount} custom component(s) — require Azure Function`,
        score: GAP_PENALTIES.hasCustomPipelineComponents * customCount,
        category: 'gap',
      });
    }
  }

  // Score adapter penalties from binding files
  for (const binding of app.bindingFiles) {
    for (const rl of binding.receiveLocations) {
      const penalty = ADAPTER_PENALTIES[rl.adapterType];
      if (penalty) {
        contributors.push({
          label: `Adapter: ${rl.adapterType} (${rl.name})`,
          score: penalty,
          category: 'adapter',
        });
      }
    }
    for (const sp of binding.sendPorts) {
      const penalty = ADAPTER_PENALTIES[sp.adapterType];
      if (penalty) {
        contributors.push({
          label: `Adapter: ${sp.adapterType} (${sp.name})`,
          score: penalty,
          category: 'adapter',
        });
      }
    }
  }

  const totalScore = Math.min(contributors.reduce((sum, c) => sum + c.score, 0), 100);
  const classification = classify(totalScore);
  const hotSpots = identifyHotSpots(contributors);
  const summary = buildSummary(totalScore, classification, contributors, app);

  return { totalScore, classification, contributors, summary, hotSpots };
}

/**
 * Scores a single orchestration. Used by scoreApplication() and
 * also useful for scoring a partial analysis.
 */
export function scoreOrchestration(orch: ParsedOrchestration): ComplexityContributor[] {
  const contributors: ComplexityContributor[] = [];
  const { shapes, name } = orch;

  // Recursively score all shapes
  const allShapes = flattenAllShapes(shapes);
  for (const shape of allShapes) {
    const baseScore = SHAPE_SCORES[shape.shapeType] ?? 1;

    // ScopeShape score depends on transaction type
    if (shape.shapeType === 'ScopeShape') {
      const txScore = SCOPE_SCORES[shape.transactionType ?? 'None'] ?? 1;
      if (txScore > 1) {
        contributors.push({
          label: `${name}: ScopeShape (${shape.transactionType ?? 'None'})`,
          score: txScore,
          category: 'shape',
        });
        continue;
      }
    }

    // DecisionShape score scales with branch count (Switch is harder than If)
    if (shape.shapeType === 'DecisionShape') {
      const branchCount = shape.children?.filter(c => c.shapeType === 'GroupShape').length ?? 2;
      const adjustedScore = branchCount > 2 ? branchCount : baseScore;
      contributors.push({
        label: `${name}: DecisionShape (${branchCount} branch${branchCount !== 1 ? 'es' : ''})${shape.name ? ` — ${shape.name}` : ''}`,
        score: adjustedScore,
        category: 'shape',
      });
      continue;
    }

    if (baseScore > 0) {
      contributors.push({
        label: `${name}: ${shape.shapeType}${shape.name ? ` (${shape.name})` : ''}`,
        score: baseScore,
        category: 'shape',
      });
    }
  }

  // Gap penalties at orchestration level
  if (orch.hasAtomicTransactions) {
    contributors.push({
      label: `${name}: MSDTC atomic transaction scope`,
      score: GAP_PENALTIES.hasAtomicTransactions,
      category: 'gap',
    });
  }
  if (orch.hasLongRunningTransactions) {
    contributors.push({
      label: `${name}: Long-running transaction scope`,
      score: GAP_PENALTIES.hasLongRunningTransactions,
      category: 'gap',
    });
  }
  if (orch.hasCompensation) {
    contributors.push({
      label: `${name}: Compensate shape (no Logic Apps equivalent)`,
      score: GAP_PENALTIES.hasCompensation,
      category: 'gap',
    });
  }
  if (orch.hasBRECalls) {
    const breCallCount = allShapes.filter(s => s.shapeType === 'CallRulesShape').length;
    contributors.push({
      label: `${name}: BRE policy calls (${breCallCount}× CallRules shape)`,
      score: GAP_PENALTIES.hasBRECalls * breCallCount,
      category: 'gap',
    });
  }
  if (orch.hasSuspend) {
    contributors.push({
      label: `${name}: Suspend shape (no Logic Apps equivalent)`,
      score: GAP_PENALTIES.hasSuspend,
      category: 'gap',
    });
  }
  if (orch.correlationSets.length > 2) {
    contributors.push({
      label: `${name}: Complex correlation (${orch.correlationSets.length} sets)`,
      score: GAP_PENALTIES.hasMultipleCorrelationSets,
      category: 'gap',
    });
  }

  return contributors;
}

function scoreMap(map: ParsedMap): ComplexityContributor[] {
  const contributors: ComplexityContributor[] = [];

  if (map.hasScriptingFunctoids) {
    contributors.push({
      label: `Map ${map.name}: scripting functoids (msxsl:script — requires rewrite)`,
      score: GAP_PENALTIES.hasScriptingFunctoids * map.functoids.filter(f => f.isScripting).length,
      category: 'map',
    });
  }
  if (map.hasDatabaseFunctoids) {
    contributors.push({
      label: `Map ${map.name}: database functoids (requires Azure Function enrichment)`,
      score: GAP_PENALTIES.hasDatabaseFunctoids,
      category: 'map',
    });
  }
  if (map.linkCount > 50) {
    contributors.push({
      label: `Map ${map.name}: large map (${map.linkCount} links)`,
      score: Math.floor(map.linkCount / 25),
      category: 'map',
    });
  }

  return contributors;
}

// ─── Classification ───────────────────────────────────────────────────────────

function classify(score: number): ComplexityClass {
  for (const [cls, range] of Object.entries(THRESHOLDS) as [ComplexityClass, { min: number; max: number }][]) {
    if (score >= range.min && score <= range.max) return cls;
  }
  return 'highly-complex';
}

// ─── Hot Spot Identification ──────────────────────────────────────────────────

function identifyHotSpots(contributors: ComplexityContributor[]): string[] {
  return contributors
    .filter(c => c.score >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(c => `${c.label} (+${c.score})`);
}

// ─── Summary Generation ───────────────────────────────────────────────────────

function buildSummary(
  score: number,
  classification: ComplexityClass,
  contributors: ComplexityContributor[],
  app: BizTalkApplication
): string {
  const gapCount = contributors.filter(c => c.category === 'gap').length;
  const adapterCount = contributors.filter(c => c.category === 'adapter').length;

  const parts: string[] = [
    `Complexity score: ${score} (${classification}).`,
    `${app.orchestrations.length} orchestration(s), ${app.maps.length} map(s), ${app.bindingFiles.flatMap(b => b.receiveLocations).length} receive location(s).`,
  ];

  if (gapCount > 0) {
    parts.push(`${gapCount} gap indicator(s) detected — review gap-analysis for mitigation strategies.`);
  }
  if (adapterCount > 0) {
    parts.push(`${adapterCount} non-trivial adapter(s) require special attention.`);
  }

  const suggestionMap: Record<ComplexityClass, string> = {
    'simple': 'Direct migration recommended — most output can be auto-generated.',
    'moderate': 'Guided migration — review generated output and adjust for gaps.',
    'complex': 'Architect-led migration — plan gap mitigations before generating output.',
    'highly-complex': 'Phased migration recommended — address critical gaps (MSDTC/WCF-NetTcp) before migrating other components.',
  };
  parts.push(suggestionMap[classification]);

  return parts.join(' ');
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function flattenAllShapes(shapes: ParsedOrchestration['shapes']): ParsedOrchestration['shapes'] {
  const result: ParsedOrchestration['shapes'] = [];
  for (const shape of shapes) {
    result.push(shape);
    if (shape.children) result.push(...flattenAllShapes(shape.children));
  }
  return result;
}
