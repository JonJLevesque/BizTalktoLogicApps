/**
 * Package Validator -- Cross-file Logic Apps package validation
 */

import type { ValidationIssue, WorkflowValidationResult } from './workflow-validator.js';
import type { ConnectionsValidationResult } from './connections-validator.js';
import { validateWorkflow, collectAllActions } from './workflow-validator.js';
import { validateConnections } from './connections-validator.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PackageInput {
  workflowJson?: unknown;
  connectionsJson?: unknown;
  appSettings?: Record<string, string>;
  mapFiles?: string[];
}

export interface PackageValidationResult {
  valid: boolean;
  workflowIssues: WorkflowValidationResult | null;
  connectionIssues: ConnectionsValidationResult | null;
  crossIssues: ValidationIssue[];
  totalErrors: number;
  totalWarnings: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Extract all @appsetting('KEY') references from a JSON value.
 */
function extractAppSettingRefs(value: unknown): Set<string> {
  const refs = new Set<string>();
  const jsonStr = JSON.stringify(value);
  const matches = jsonStr.matchAll(/@appsetting\('([^']+)'\)/g);
  for (const match of matches) {
    refs.add(match[1]!);
  }
  return refs;
}

/**
 * Extract map names from workflow (Integration Account XSLT actions).
 */
function extractMapReferences(workflowJson: unknown): Set<string> {
  const maps = new Set<string>();
  if (!isRecord(workflowJson)) return maps;
  const definition = workflowJson['definition'];
  if (!isRecord(definition)) return maps;
  const actions = definition['actions'];
  if (!isRecord(actions)) return maps;

  walkActions(actions, maps);
  return maps;
}

function walkActions(actions: Record<string, unknown>, maps: Set<string>): void {
  for (const action of Object.values(actions)) {
    if (!isRecord(action)) continue;

    // Check for XSLT/transform map references
    const inputs = action['inputs'];
    if (isRecord(inputs)) {
      const ia = inputs['integrationAccount'];
      if (isRecord(ia)) {
        const mapRef = ia['map'];
        if (isRecord(mapRef)) {
          const mapName = mapRef['name'];
          if (typeof mapName === 'string') {
            maps.add(mapName);
          }
        }
      }
    }

    // Recurse into nested actions
    if (isRecord(action['actions'])) {
      walkActions(action['actions'] as Record<string, unknown>, maps);
    }
    if (isRecord(action['else'])) {
      const elseBlock = action['else'] as Record<string, unknown>;
      if (isRecord(elseBlock['actions'])) {
        walkActions(elseBlock['actions'] as Record<string, unknown>, maps);
      }
    }
    if (isRecord(action['cases'])) {
      for (const caseObj of Object.values(action['cases'] as Record<string, unknown>)) {
        if (isRecord(caseObj) && isRecord((caseObj as Record<string, unknown>)['actions'])) {
          walkActions((caseObj as Record<string, unknown>)['actions'] as Record<string, unknown>, maps);
        }
      }
    }
    if (isRecord(action['default'])) {
      const defaultBlock = action['default'] as Record<string, unknown>;
      if (isRecord(defaultBlock['actions'])) {
        walkActions(defaultBlock['actions'] as Record<string, unknown>, maps);
      }
    }
  }
}

// ─── Validator ────────────────────────────────────────────────────────────────

export function validatePackage(pkg: PackageInput): PackageValidationResult {
  const crossIssues: ValidationIssue[] = [];

  // Validate individual parts
  const workflowIssues = pkg.workflowJson !== undefined
    ? validateWorkflow(pkg.workflowJson)
    : null;

  const connectionIssues = pkg.connectionsJson !== undefined
    ? validateConnections(pkg.connectionsJson, pkg.workflowJson)
    : null;

  // Cross-validation rule 1: app-settings-covered
  if (pkg.appSettings !== undefined) {
    const allRefs = new Set<string>();

    if (pkg.workflowJson !== undefined) {
      for (const ref of extractAppSettingRefs(pkg.workflowJson)) {
        allRefs.add(ref);
      }
    }
    if (pkg.connectionsJson !== undefined) {
      for (const ref of extractAppSettingRefs(pkg.connectionsJson)) {
        allRefs.add(ref);
      }
    }

    for (const key of allRefs) {
      if (!(key in pkg.appSettings)) {
        crossIssues.push({
          severity: 'error',
          rule: 'app-settings-covered',
          message: `@appsetting('${key}') is referenced but not found in appSettings`,
          path: `appSettings.${key}`,
        });
      }
    }
  }

  // Cross-validation rule 2: map-references-exist
  if (pkg.mapFiles !== undefined && pkg.workflowJson !== undefined) {
    const mapRefs = extractMapReferences(pkg.workflowJson);
    const mapFileSet = new Set(pkg.mapFiles);

    for (const mapName of mapRefs) {
      if (!mapFileSet.has(mapName)) {
        crossIssues.push({
          severity: 'error',
          rule: 'map-references-exist',
          message: `Workflow references map "${mapName}" but it is not in mapFiles`,
          path: `mapFiles.${mapName}`,
        });
      }
    }
  }

  // Cross-validation rule 3: consistent-connection-names
  if (pkg.workflowJson !== undefined && pkg.connectionsJson !== undefined && isRecord(pkg.connectionsJson)) {
    const spc = pkg.connectionsJson['serviceProviderConnections'];
    if (isRecord(spc)) {
      const spcKeys = new Set(Object.keys(spc));

      if (isRecord(pkg.workflowJson)) {
        const definition = pkg.workflowJson['definition'];
        if (isRecord(definition)) {
          const actions = definition['actions'];
          if (isRecord(actions)) {
            const allActions = collectAllActions(actions);
            for (const [actionName, action] of allActions) {
              const inputs = action['inputs'];
              if (!isRecord(inputs)) continue;
              const spcConfig = inputs['serviceProviderConfiguration'];
              if (!isRecord(spcConfig)) continue;
              const connName = spcConfig['connectionName'];
              if (typeof connName === 'string' && !spcKeys.has(connName)) {
                crossIssues.push({
                  severity: 'error',
                  rule: 'consistent-connection-names',
                  message: `Action "${actionName}" references connectionName "${connName}" not found in serviceProviderConnections`,
                  path: `serviceProviderConnections.${connName}`,
                });
              }
            }
          }
        }
      }
    }
  }

  // Calculate totals
  const workflowErrors = workflowIssues?.errorCount ?? 0;
  const connectionErrors = connectionIssues ? connectionIssues.issues.filter(i => i.severity === 'error').length : 0;
  const crossErrors = crossIssues.filter(i => i.severity === 'error').length;

  const workflowWarnings = workflowIssues?.warningCount ?? 0;
  const connectionWarnings = connectionIssues ? connectionIssues.issues.filter(i => i.severity === 'warning').length : 0;
  const crossWarnings = crossIssues.filter(i => i.severity === 'warning').length;

  const totalErrors = workflowErrors + connectionErrors + crossErrors;
  const totalWarnings = workflowWarnings + connectionWarnings + crossWarnings;

  return {
    valid: totalErrors === 0,
    workflowIssues,
    connectionIssues,
    crossIssues,
    totalErrors,
    totalWarnings,
  };
}
