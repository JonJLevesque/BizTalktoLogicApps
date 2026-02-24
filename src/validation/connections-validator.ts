/**
 * Connections Validator -- Logic Apps connections.json validation
 */

import type { ValidationIssue } from './workflow-validator.js';
import { collectAllActions } from './workflow-validator.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConnectionsValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

const SENSITIVE_PATTERNS = /DefaultEndpointsProtocol|AccountKey|password|secret/i;

/**
 * Walk all actions recursively to find serviceProviderConfiguration.connectionName values.
 */
export function extractConnectionNamesFromWorkflow(workflowJson: unknown): Set<string> {
  const names = new Set<string>();
  if (!isRecord(workflowJson)) return names;

  const definition = workflowJson['definition'];
  if (!isRecord(definition)) return names;

  const actions = definition['actions'];
  if (!isRecord(actions)) return names;

  const allActions = collectAllActions(actions);
  for (const [, action] of allActions) {
    const inputs = action['inputs'];
    if (!isRecord(inputs)) continue;
    const spc = inputs['serviceProviderConfiguration'];
    if (!isRecord(spc)) continue;
    const connName = spc['connectionName'];
    if (typeof connName === 'string') {
      names.add(connName);
    }
  }

  // Also check triggers
  const triggers = definition['triggers'];
  if (isRecord(triggers)) {
    for (const trigger of Object.values(triggers)) {
      if (!isRecord(trigger)) continue;
      const inputs = trigger['inputs'];
      if (!isRecord(inputs)) continue;
      const spc = inputs['serviceProviderConfiguration'];
      if (!isRecord(spc)) continue;
      const connName = spc['connectionName'];
      if (typeof connName === 'string') {
        names.add(connName);
      }
    }
  }

  return names;
}

// ─── Validator ────────────────────────────────────────────────────────────────

export function validateConnections(
  connectionsJson: unknown,
  workflowJson?: unknown
): ConnectionsValidationResult {
  const issues: ValidationIssue[] = [];

  function addIssue(severity: ValidationIssue['severity'], rule: string, message: string, path?: string | undefined): void {
    issues.push({ severity, rule, message, ...(path !== undefined ? { path } : {}) });
  }

  // Rule 1: valid-structure
  if (!isRecord(connectionsJson)) {
    addIssue('error', 'valid-structure', 'connections.json must be a non-null object');
    return { valid: false, issues };
  }

  const spc = connectionsJson['serviceProviderConnections'];
  const mac = connectionsJson['managedApiConnections'];

  if (!isRecord(spc) && !isRecord(mac)) {
    addIssue('error', 'valid-structure', 'connections.json must have serviceProviderConnections or managedApiConnections');
    return { valid: false, issues };
  }

  // Rule 2: appsetting-format — check parameterValues for literal sensitive strings
  if (isRecord(spc)) {
    for (const [connName, conn] of Object.entries(spc)) {
      if (!isRecord(conn)) continue;
      const paramValues = conn['parameterValues'];
      if (!isRecord(paramValues)) continue;
      for (const [paramKey, paramVal] of Object.entries(paramValues)) {
        if (typeof paramVal === 'string' && SENSITIVE_PATTERNS.test(paramVal) && !paramVal.startsWith('@appsetting(')) {
          addIssue('error', 'appsetting-format', `Connection "${connName}" parameterValues.${paramKey} contains a literal sensitive value — use @appsetting('...') format instead`, `serviceProviderConnections.${connName}.parameterValues.${paramKey}`);
        }
      }
    }
  }

  if (isRecord(mac)) {
    for (const [connName, conn] of Object.entries(mac)) {
      if (!isRecord(conn)) continue;
      const paramValues = conn['parameterValues'];
      if (!isRecord(paramValues)) continue;
      for (const [paramKey, paramVal] of Object.entries(paramValues)) {
        if (typeof paramVal === 'string' && SENSITIVE_PATTERNS.test(paramVal) && !paramVal.startsWith('@appsetting(')) {
          addIssue('error', 'appsetting-format', `Connection "${connName}" parameterValues.${paramKey} contains a literal sensitive value — use @appsetting('...') format instead`, `managedApiConnections.${connName}.parameterValues.${paramKey}`);
        }
      }
    }
  }

  // Rule 6: service-provider-id-format
  if (isRecord(spc)) {
    for (const [connName, conn] of Object.entries(spc)) {
      if (!isRecord(conn)) continue;
      const sp = conn['serviceProvider'];
      if (!isRecord(sp)) continue;
      const spId = sp['id'];
      if (typeof spId === 'string' && !spId.startsWith('/serviceProviders/')) {
        addIssue('error', 'service-provider-id-format', `Connection "${connName}" serviceProvider.id must start with /serviceProviders/, got "${spId}"`, `serviceProviderConnections.${connName}.serviceProvider.id`);
      }
    }
  }

  // Cross-validation with workflow (rules 3, 4)
  if (workflowJson !== undefined) {
    const workflowConnNames = extractConnectionNamesFromWorkflow(workflowJson);
    const spcKeys = isRecord(spc) ? new Set(Object.keys(spc)) : new Set<string>();

    // Rule 3: connection-name-refs — workflow references must exist in connections
    for (const connName of workflowConnNames) {
      if (!spcKeys.has(connName)) {
        addIssue('error', 'connection-name-refs', `Workflow references connectionName "${connName}" but no matching entry in serviceProviderConnections`, `serviceProviderConnections.${connName}`);
      }
    }

    // Rule 4: no-orphan-connections — connections not referenced by workflow
    for (const connName of spcKeys) {
      if (!workflowConnNames.has(connName)) {
        addIssue('warning', 'no-orphan-connections', `Connection "${connName}" in serviceProviderConnections is not referenced by any workflow action`, `serviceProviderConnections.${connName}`);
      }
    }
  }

  // Rule 5: kvs-prefix — @appsetting values for connections should use KVS_ prefix
  if (isRecord(spc)) {
    for (const [connName, conn] of Object.entries(spc)) {
      if (!isRecord(conn)) continue;
      const paramValues = conn['parameterValues'];
      if (!isRecord(paramValues)) continue;
      for (const [paramKey, paramVal] of Object.entries(paramValues)) {
        if (typeof paramVal === 'string') {
          const appsettingMatch = paramVal.match(/@appsetting\('([^']+)'\)/);
          if (appsettingMatch) {
            const settingKey = appsettingMatch[1]!;
            if (!settingKey.startsWith('KVS_') && /connection|secret|password|key/i.test(settingKey)) {
              addIssue('suggestion', 'kvs-prefix', `Connection "${connName}" uses @appsetting('${settingKey}') — consider using a KVS_ prefix for Key Vault references`, `serviceProviderConnections.${connName}.parameterValues.${paramKey}`);
            }
          }
        }
      }
    }
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;
  return { valid: errorCount === 0, issues };
}
