/**
 * Quality Scorer -- 0-100 quality rating for generated Logic Apps workflows
 *
 * Dimensions:
 *   Structural (40pts)    -- valid JSON, schema, trigger, runAfter, cycle-free
 *   Completeness (30pts)  -- intent steps covered, error handling present
 *   Best Practices (20pts) -- retry policies, KVS_ secrets, tracked properties
 *   Naming (10pts)        -- PascalCase, no generics
 */

import { collectAllActions, buildRunAfterGraph, detectCycle } from './workflow-validator.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QualityDimension {
  name: string;
  score: number;
  maxScore: number;
  percentage: number;
  issues: string[];
}

export interface QualityReport {
  totalScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  dimensions: QualityDimension[];
  summary: string;
  recommendations: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

const WDL_SCHEMA_URL = 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#';
const VALID_RUNAFTER_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMEDOUT', 'SKIPPED']);
const GENERIC_NAME_PATTERN = /^(Action|Step|Untitled|Unnamed)\d*$/i;
const PASCAL_CASE_PATTERN = /^[A-Z][a-zA-Z0-9_]*$/;

/** True if a value looks like raw C# code rather than a WDL expression or plain string. */
function looksCSharp(val: string): boolean {
  if (val.startsWith('@{')) return false; // WDL inline expression
  if (val.startsWith('@')) return false;  // WDL reference like @variables('x')
  // C# statement terminator, object construction, or chained method call
  return /;/.test(val) ||
    /\bnew\s+[A-Z]/.test(val) ||
    /\b\w+\.\w+\(/.test(val);
}

/** True if an If-action expression is a tautology placeholder (@true / @false literal). */
function isTautologyExpression(expr: unknown): boolean {
  const s = JSON.stringify(expr);
  return s.includes('"@true"') || s.includes('"@false"');
}

function getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ─── Scorer ───────────────────────────────────────────────────────────────────

export function scoreWorkflowQuality(workflowJson: unknown, intentJson?: unknown): QualityReport {
  const recommendations: string[] = [];

  // ─── Structural (40pts) ──────────────────────────────────────────────
  let structuralScore = 0;
  const structuralMax = 40;
  const structuralIssues: string[] = [];

  // Valid JSON object: +10
  if (isRecord(workflowJson)) {
    structuralScore += 10;
  } else {
    structuralIssues.push('Input is not a valid JSON object');
  }

  const definition = isRecord(workflowJson) ? workflowJson['definition'] : undefined;
  const kind = isRecord(workflowJson) ? workflowJson['kind'] : undefined;

  // Has correct $schema: +5
  if (isRecord(definition) && definition['$schema'] === WDL_SCHEMA_URL) {
    structuralScore += 5;
  } else {
    structuralIssues.push('Missing or incorrect $schema');
  }

  // Has at least one trigger: +5
  const triggers = isRecord(definition) ? definition['triggers'] : undefined;
  if (isRecord(triggers) && Object.keys(triggers).length > 0) {
    structuralScore += 5;
  } else {
    structuralIssues.push('No triggers found');
  }

  // All runAfter values are ALL CAPS: +10
  const actions = isRecord(definition) ? definition['actions'] : undefined;
  if (isRecord(actions)) {
    const allActions = collectAllActions(actions);
    let allCapsOk = true;
    for (const [, action] of allActions) {
      const runAfter = action['runAfter'];
      if (!isRecord(runAfter)) continue;
      for (const statuses of Object.values(runAfter)) {
        if (!Array.isArray(statuses)) continue;
        for (const status of statuses) {
          if (typeof status === 'string' && !VALID_RUNAFTER_STATUSES.has(status)) {
            allCapsOk = false;
          }
        }
      }
    }
    if (allCapsOk) {
      structuralScore += 10;
    } else {
      structuralIssues.push('Some runAfter status values are not ALL CAPS');
      recommendations.push('Change all runAfter status values to ALL CAPS (SUCCEEDED, FAILED, TIMEDOUT, SKIPPED)');
    }

    // No cycles in runAfter graph: +5
    const graph = buildRunAfterGraph(actions);
    const cycle = detectCycle(graph);
    if (cycle === null) {
      structuralScore += 5;
    } else {
      structuralIssues.push(`Circular dependency: ${cycle}`);
      recommendations.push('Remove circular runAfter dependencies');
    }

    // ServiceProvider actions have connectionName: +5
    let allSpHaveConn = true;
    for (const [, action] of allActions) {
      if (action['type'] === 'ServiceProvider') {
        const inputs = action['inputs'];
        if (!isRecord(inputs) ||
          !isRecord(inputs['serviceProviderConfiguration']) ||
          typeof (inputs['serviceProviderConfiguration'] as Record<string, unknown>)['connectionName'] !== 'string') {
          allSpHaveConn = false;
        }
      }
    }
    if (allSpHaveConn) {
      structuralScore += 5;
    } else {
      structuralIssues.push('Some ServiceProvider actions missing connectionName');
    }
  }

  // ─── Completeness (30pts) ────────────────────────────────────────────
  let completenessScore = 0;
  const completenessMax = 30;
  const completenessIssues: string[] = [];

  // Has at least one action: +5
  if (isRecord(actions) && Object.keys(actions).length > 0) {
    completenessScore += 5;
  } else {
    completenessIssues.push('No actions found');
  }

  // Has error handling (Scope with FAILED runAfter): +10
  if (isRecord(actions)) {
    const allActions = collectAllActions(actions);
    const hasErrorHandling = allActions.some(([, action]) => {
      const runAfter = action['runAfter'];
      if (!isRecord(runAfter)) return false;
      return Object.values(runAfter).some(statuses => {
        if (!Array.isArray(statuses)) return false;
        return statuses.includes('FAILED');
      });
    });
    if (hasErrorHandling) {
      completenessScore += 10;
    } else {
      completenessIssues.push('No error handling detected (no FAILED runAfter)');
      recommendations.push('Add a Scope with runAfter FAILED for error handling');
    }
  }

  // Intent coverage: +15 if all covered, proportional otherwise
  if (intentJson !== undefined && isRecord(intentJson) && isRecord(actions)) {
    const steps = intentJson['steps'];
    if (Array.isArray(steps) && steps.length > 0) {
      // Count recursively so Scope-wrapped workflows aren't penalised for having 1 top-level action
      const actionCount = collectAllActions(actions).length;
      const stepCount = steps.length;
      const coverage = Math.min(actionCount / stepCount, 1);
      const intentPoints = Math.round(coverage * 15);
      completenessScore += intentPoints;
      if (coverage < 1) {
        completenessIssues.push(`Only ${actionCount} actions for ${stepCount} intent steps (${Math.round(coverage * 100)}% coverage)`);
        recommendations.push('Ensure all intent steps have corresponding workflow actions');
      }
    } else {
      completenessScore += 15;
    }
  }

  // Has outputs field: +5
  if (isRecord(definition) && definition['outputs'] !== undefined) {
    completenessScore += 5;
  } else {
    completenessIssues.push('No outputs field defined');
  }

  // ─── Best Practices (20pts) ──────────────────────────────────────────
  let bestPracticesScore = 0;
  const bestPracticesMax = 20;
  const bestPracticesIssues: string[] = [];

  if (isRecord(actions)) {
    const allActions = collectAllActions(actions);

    // HTTP actions have retryPolicy: +5
    const httpActions = allActions.filter(([, a]) => a['type'] === 'Http');
    if (httpActions.length === 0) {
      bestPracticesScore += 5;
    } else {
      const withRetry = httpActions.filter(([, a]) => a['retryPolicy'] !== undefined).length;
      const retryPoints = Math.round((withRetry / httpActions.length) * 5);
      bestPracticesScore += retryPoints;
      if (withRetry < httpActions.length) {
        bestPracticesIssues.push(`${httpActions.length - withRetry} HTTP actions missing retryPolicy`);
        recommendations.push('Add retryPolicy to all HTTP actions');
      }
    }

    // @appsetting references use KVS_ prefix: +5
    const workflowStr = JSON.stringify(workflowJson);
    const appsettingMatches = [...workflowStr.matchAll(/@appsetting\('([^']+)'\)/g)];
    const sensitiveWithoutKvs = appsettingMatches.filter(m => {
      const key = m[1]!;
      return !key.startsWith('KVS_') && /connection|secret|password|key/i.test(key);
    });
    if (sensitiveWithoutKvs.length === 0) {
      bestPracticesScore += 5;
    } else {
      bestPracticesIssues.push(`${sensitiveWithoutKvs.length} @appsetting references missing KVS_ prefix`);
      recommendations.push('Use KVS_ prefix for sensitive @appsetting keys');
    }

    // Has Terminate_On_Error or equivalent: +5
    const hasTerminate = allActions.some(([name, a]) =>
      a['type'] === 'Terminate' || /terminate.*error/i.test(name) || /error.*terminate/i.test(name)
    );
    if (hasTerminate) {
      bestPracticesScore += 5;
    } else {
      bestPracticesIssues.push('No Terminate action for error handling');
    }
  }

  // Stateful kind: +5
  if (kind === 'Stateful') {
    bestPracticesScore += 5;
  } else {
    bestPracticesIssues.push('Workflow is not Stateful');
    if (kind === 'Stateless') {
      recommendations.push('Consider using Stateful kind for BizTalk migration');
    }
  }

  // ─── Naming (10pts) ─────────────────────────────────────────────────
  let namingScore = 0;
  const namingMax = 10;
  const namingIssues: string[] = [];

  if (isRecord(actions)) {
    const topLevelNames = Object.keys(actions);

    // All top-level action names use PascalCase: +5
    const nonPascal = topLevelNames.filter(n => !PASCAL_CASE_PATTERN.test(n));
    if (nonPascal.length === 0) {
      namingScore += 5;
    } else {
      namingIssues.push(`${nonPascal.length} action names not in PascalCase`);
      recommendations.push('Use PascalCase for all action names');
    }

    // No generic names: +5
    const allActions = collectAllActions(actions);
    const genericNames = allActions.filter(([name]) => GENERIC_NAME_PATTERN.test(name));
    if (genericNames.length === 0) {
      namingScore += 5;
    } else {
      namingIssues.push(`${genericNames.length} actions with generic names`);
      recommendations.push('Replace generic action names (Action1, Step1) with descriptive PascalCase names');
    }
  }

  // ─── Fidelity Penalties (applied to Completeness) ───────────────────
  // Penalize workflows with unresolved TODO markers or placeholder logic,
  // ensuring the quality score reflects actual translation completeness.
  if (isRecord(actions)) {
    const workflowStr = JSON.stringify(workflowJson);

    // Penalty: Unresolved TODO_CLAUDE markers (-5 each, max -15)
    const todoMatches = workflowStr.match(/TODO_CLAUDE/g);
    const todoCount = todoMatches ? todoMatches.length : 0;
    if (todoCount > 0) {
      const penalty = Math.min(todoCount * 5, 15);
      completenessScore = Math.max(0, completenessScore - penalty);
      completenessIssues.push(`${todoCount} unresolved TODO_CLAUDE marker(s) — AI enrichment incomplete`);
      recommendations.push('Resolve all TODO_CLAUDE markers with valid WDL expressions');
    }

    // Penalty: Empty SetVariable values (-3 each, max -9)
    const allActionsForPenalty = collectAllActions(actions);
    const emptySetVars = allActionsForPenalty.filter(([, a]) => {
      if (a['type'] !== 'SetVariable') return false;
      const inputs = a['inputs'];
      if (!isRecord(inputs)) return false;
      const val = inputs['value'];
      return val === '' || val === undefined || val === null;
    });
    if (emptySetVars.length > 0) {
      const penalty = Math.min(emptySetVars.length * 3, 9);
      completenessScore = Math.max(0, completenessScore - penalty);
      completenessIssues.push(`${emptySetVars.length} SetVariable action(s) with empty values`);
      recommendations.push('Translate C# expressions to WDL @{...} syntax for all SetVariable values');
    }

    // Penalty: Untranslated C# code in SetVariable values (-5 each, max -20)
    const csharpSetVars = allActionsForPenalty.filter(([, a]) => {
      if (a['type'] !== 'SetVariable') return false;
      const inputs = a['inputs'];
      if (!isRecord(inputs)) return false;
      const val = inputs['value'];
      return typeof val === 'string' && val !== '' && looksCSharp(val);
    });
    if (csharpSetVars.length > 0) {
      const penalty = Math.min(csharpSetVars.length * 5, 20);
      completenessScore = Math.max(0, completenessScore - penalty);
      completenessIssues.push(`${csharpSetVars.length} SetVariable action(s) contain untranslated C# code — replace with WDL @{...} expressions or Local Code Functions`);
      recommendations.push('Replace raw C# code in SetVariable values with WDL @{...} expressions or Local Code Function calls');
    }

    // Penalty: Tautology If conditions (-5 each, max -15)
    // Placeholder conditions like {"equals": ["@true", true]} mean the XLANG/s condition was never translated.
    const tautologyIfs = allActionsForPenalty.filter(([, a]) => {
      if (a['type'] !== 'If') return false;
      const expr = a['expression'];
      return expr !== undefined && expr !== null && isTautologyExpression(expr);
    });
    if (tautologyIfs.length > 0) {
      const penalty = Math.min(tautologyIfs.length * 5, 15);
      completenessScore = Math.max(0, completenessScore - penalty);
      completenessIssues.push(`${tautologyIfs.length} If action(s) have placeholder conditions (@true/@false) — original XLANG/s conditions must be translated to WDL`);
      recommendations.push('Translate XLANG/s conditions to WDL JSON predicate objects for all If actions');
    }
  }

  // Cap each dimension at its declared maximum (prevents overcounting from bonus checks)
  completenessScore  = Math.min(completenessScore,  completenessMax);
  bestPracticesScore = Math.min(bestPracticesScore,  bestPracticesMax);
  structuralScore    = Math.min(structuralScore,     structuralMax);
  namingScore        = Math.min(namingScore,         namingMax);

  // ─── Assemble Report ────────────────────────────────────────────────
  const dimensions: QualityDimension[] = [
    {
      name: 'Structural',
      score: structuralScore,
      maxScore: structuralMax,
      percentage: Math.round((structuralScore / structuralMax) * 100),
      issues: structuralIssues,
    },
    {
      name: 'Completeness',
      score: completenessScore,
      maxScore: completenessMax,
      percentage: Math.round((completenessScore / completenessMax) * 100),
      issues: completenessIssues,
    },
    {
      name: 'Best Practices',
      score: bestPracticesScore,
      maxScore: bestPracticesMax,
      percentage: Math.round((bestPracticesScore / bestPracticesMax) * 100),
      issues: bestPracticesIssues,
    },
    {
      name: 'Naming',
      score: namingScore,
      maxScore: namingMax,
      percentage: Math.round((namingScore / namingMax) * 100),
      issues: namingIssues,
    },
  ];

  const totalScore = structuralScore + completenessScore + bestPracticesScore + namingScore;
  const grade = getGrade(totalScore);

  const allIssueCount = structuralIssues.length + completenessIssues.length + bestPracticesIssues.length + namingIssues.length;
  const summary = allIssueCount === 0
    ? `Workflow quality score: ${totalScore}/100 (${grade}) — no issues found`
    : `Workflow quality score: ${totalScore}/100 (${grade}) — ${allIssueCount} issue${allIssueCount > 1 ? 's' : ''} found`;

  return {
    totalScore,
    grade,
    dimensions,
    summary,
    recommendations,
  };
}
