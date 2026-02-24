/**
 * Risk Assessor — Stage 2 (Document)
 *
 * Computes overall migration risk from the gap analysis results and produces
 * manual intervention points that require human review before or after
 * auto-generation.
 *
 * Inputs:  gaps from analyzeGaps(), the parsed BizTalkApplication
 * Outputs: RiskAssessment containing overallRisk, estimatedEffortDays,
 *          manualInterventionPoints, and a human-readable riskSummary
 *
 * Risk escalation rules:
 *   - Any critical gap  → 'critical' overall
 *   - Any high gap      → at least 'high' overall
 *   - ≥3 medium gaps    → escalated to 'high'
 *   - ≥1 medium gap     → 'medium' overall
 *   - Only low gaps     → 'low' overall
 *   - No gaps           → 'low' overall
 */

import type { BizTalkApplication } from '../types/biztalk.js';
import type {
  MigrationGap,
  ManualInterventionPoint,
  RiskSeverity,
} from '../types/migration.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RiskAssessment {
  overallRisk: RiskSeverity;
  /** Total estimated effort in person-days */
  estimatedEffortDays: number;
  manualInterventionPoints: ManualInterventionPoint[];
  /** Human-readable migration risk summary */
  riskSummary: string;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function assessRisk(
  gaps: MigrationGap[],
  app: BizTalkApplication
): RiskAssessment {
  const overallRisk         = computeOverallRisk(gaps);
  const estimatedEffortDays = computeEffortDays(gaps, app);
  const manualInterventionPoints = deriveInterventionPoints(gaps, app);
  const riskSummary         = buildRiskSummary(overallRisk, gaps, app, estimatedEffortDays);

  return { overallRisk, estimatedEffortDays, manualInterventionPoints, riskSummary };
}

// ─── Risk Computation ─────────────────────────────────────────────────────────

function computeOverallRisk(gaps: MigrationGap[]): RiskSeverity {
  if (gaps.some(g => g.severity === 'critical')) return 'critical';
  if (gaps.some(g => g.severity === 'high'))     return 'high';

  const mediumCount = gaps.filter(g => g.severity === 'medium').length;
  if (mediumCount >= 3) return 'high';
  if (mediumCount >= 1) return 'medium';

  return 'low';
}

// ─── Effort Estimation ────────────────────────────────────────────────────────

/**
 * Sums gap effort + base migration effort per artifact.
 *
 * Base effort per orchestration:
 *   ≤5 shapes  → 1 day    (simple linear flow)
 *   ≤15 shapes → 2 days   (moderate branching)
 *   >15 shapes → 3 days   (complex)
 *
 * Base effort per map:
 *   lml / xslt            → 1 day
 *   xslt-rewrite          → 2 days
 *   azure-function        → 3 days
 *   manual                → 5 days
 *
 * Base effort per non-default pipeline: 1–2 days
 */
function computeEffortDays(gaps: MigrationGap[], app: BizTalkApplication): number {
  let total = gaps.reduce((sum, g) => sum + g.estimatedEffortDays, 0);

  // Orchestration base migration effort
  for (const orch of app.orchestrations) {
    const count = orch.shapes.length;
    if (count <= 5)       total += 1;
    else if (count <= 15) total += 2;
    else                  total += 3;
  }

  // Map conversion effort
  for (const map of app.maps) {
    switch (map.recommendedMigrationPath) {
      case 'lml':            total += 1; break;
      case 'xslt':           total += 1; break;
      case 'xslt-rewrite':   total += 2; break;
      case 'azure-function': total += 3; break;
      case 'manual':         total += 5; break;
      default:               total += 1; break;
    }
  }

  // Non-default pipeline migration effort
  for (const pipeline of app.pipelines) {
    if (!pipeline.isDefault) {
      total += pipeline.hasCustomComponents ? 2 : 1;
    }
  }

  return total;
}

// ─── Manual Intervention Points ───────────────────────────────────────────────

function deriveInterventionPoints(
  gaps: MigrationGap[],
  app: BizTalkApplication
): ManualInterventionPoint[] {
  const points: ManualInterventionPoint[] = [];

  // Critical gaps: must be resolved before migration can proceed
  for (const gap of gaps.filter(g => g.severity === 'critical')) {
    points.push({
      description: `${gap.capability}: ${gap.mitigation.split('.')[0]}.`,
      severity:    'required',
      ...(gap.affectedArtifacts[0] ? { artifactRef: gap.affectedArtifacts[0] } : {}),
    });
  }

  // High-risk gaps: review mitigation strategy, then proceed
  for (const gap of gaps.filter(g => g.severity === 'high')) {
    points.push({
      description: `${gap.capability}: Review and plan mitigation before generating output. Affected: ${gap.affectedArtifacts.join(', ')}.`,
      severity:    'warning',
      ...(gap.affectedArtifacts[0] ? { artifactRef: gap.affectedArtifacts[0] } : {}),
    });
  }

  // Complex orchestrations: generated output should be verified
  for (const orch of app.orchestrations) {
    if (orch.shapes.length > 20) {
      points.push({
        description: `Orchestration "${orch.name}" has ${orch.shapes.length} shapes — verify the generated workflow for correct action ordering and runAfter chains. Complex orchestrations often require hand-tuning.`,
        severity:    'warning',
        artifactRef: orch.name,
      });
    }

    // Correlation sets: map to Service Bus sessions or custom session tracking
    if (orch.correlationSets.length > 0) {
      points.push({
        description:
          `Orchestration "${orch.name}" uses ${orch.correlationSets.length} correlation set(s) ` +
          `[${orch.correlationSets.map(c => c.name).join(', ')}]. ` +
          `Map each set to Service Bus sessions (sequential convoy) or session state variables. ` +
          `Review the generated session-tracking implementation before deployment.`,
        severity:    'warning',
        artifactRef: orch.name,
      });
    }

    // XLANG/s expressions: require translation review
    const expressionShapes = orch.shapes.filter(s => s.codeExpression || s.conditionExpression);
    if (expressionShapes.length > 0) {
      points.push({
        description:
          `Orchestration "${orch.name}" contains ${expressionShapes.length} XLANG/s expression(s) ` +
          `that have been auto-translated to WDL @{...} syntax. Verify each expression — ` +
          `C# string methods, xpath() calls, and type casts require manual validation.`,
        severity:    'info',
        artifactRef: orch.name,
      });
    }
  }

  // Large maps that can't be auto-converted
  for (const map of app.maps) {
    if (map.recommendedMigrationPath === 'manual') {
      points.push({
        description: `Map "${map.name}" requires manual conversion — automated path unavailable. Contains patterns that cannot be reliably auto-translated. Rebuild from scratch using Logic Apps Data Mapper or XSLT.`,
        severity:    'required',
        artifactRef: map.name,
      });
    }
    if (map.linkCount > 100) {
      points.push({
        description: `Map "${map.name}" has ${map.linkCount} links — very large map. Consider partitioning into multiple maps to stay within Logic Apps transformation limits.`,
        severity:    'info',
        artifactRef: map.name,
      });
    }
  }

  // Dynamic send ports: require runtime connector configuration
  const dynamicPorts = app.bindingFiles.flatMap(b => b.sendPorts).filter(sp => sp.isDynamic);
  if (dynamicPorts.length > 0) {
    points.push({
      description:
        `${dynamicPorts.length} dynamic send port(s) detected [${dynamicPorts.map(p => p.name).join(', ')}]. ` +
        `Logic Apps has no equivalent of dynamic ports — the target address must be resolved at runtime ` +
        `via a variable and passed to the HTTP action or connector. Review the routing logic.`,
      severity: 'warning',
    });
  }

  return points;
}

// ─── Risk Summary ─────────────────────────────────────────────────────────────

function buildRiskSummary(
  risk: RiskSeverity,
  gaps: MigrationGap[],
  app: BizTalkApplication,
  effortDays: number
): string {
  const critical = gaps.filter(g => g.severity === 'critical');
  const high     = gaps.filter(g => g.severity === 'high');

  const parts: string[] = [
    `Overall migration risk: ${risk.toUpperCase()}. Estimated effort: ${effortDays} person-day(s).`,
    `${app.orchestrations.length} orchestration(s), ${app.maps.length} map(s), ` +
      `${app.pipelines.filter(p => !p.isDefault).length} custom pipeline(s) to migrate.`,
  ];

  if (critical.length > 0) {
    parts.push(
      `${critical.length} CRITICAL gap(s) require architectural redesign before migration can proceed: ` +
      `${critical.map(g => g.capability).join(', ')}.`
    );
  }

  if (high.length > 0) {
    parts.push(
      `${high.length} HIGH-risk gap(s) require mitigation planning: ` +
      `${high.map(g => g.capability).join(', ')}.`
    );
  }

  if (gaps.length === 0) {
    parts.push(
      'No significant migration gaps detected. Direct migration path is available.'
    );
  }

  return parts.join(' ');
}
