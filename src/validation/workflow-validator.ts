/**
 * Workflow Validator -- WDL structural and semantic rule checking
 *
 * Validates Logic Apps workflow.json files against:
 * - 14 structural rules (produce errors)
 * - 5 semantic rules (produce warnings)
 * - 7 best-practice rules (produce suggestions)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'suggestion';
  rule: string;
  message: string;
  path?: string | undefined;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  suggestionCount: number;
}

const WDL_SCHEMA_URL = 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#';
const VALID_RUNAFTER_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMEDOUT', 'SKIPPED']);
const KNOWN_LOWERCASE_STATUSES = new Set([
  'Succeeded', 'Failed', 'TimedOut', 'Skipped',
  'succeeded', 'failed', 'timedout', 'skipped',
]);

const VALID_TRIGGER_TYPES = new Set([
  'ServiceProvider', 'Request', 'Recurrence', 'Http', 'ApiConnection',
  'ApiConnectionWebhook', 'EventHub', 'manual',
]);

const GENERIC_NAME_PATTERN = /^(Action|Step|Untitled|Unnamed)\d*$/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Recursively collect all action name+object pairs including those inside
 * If.actions, If.else.actions, Switch cases, Scope.actions, ForEach.actions, Until.actions.
 */
export function collectAllActions(
  actionsObj: Record<string, unknown>
): Array<[string, Record<string, unknown>]> {
  const result: Array<[string, Record<string, unknown>]> = [];

  for (const [name, action] of Object.entries(actionsObj)) {
    if (!isRecord(action)) continue;
    result.push([name, action]);

    // If action — actions and else.actions
    if (isRecord(action['actions'])) {
      result.push(...collectAllActions(action['actions'] as Record<string, unknown>));
    }
    if (isRecord(action['else'])) {
      const elseBlock = action['else'] as Record<string, unknown>;
      if (isRecord(elseBlock['actions'])) {
        result.push(...collectAllActions(elseBlock['actions'] as Record<string, unknown>));
      }
    }

    // Switch action — cases and default
    if (isRecord(action['cases'])) {
      for (const caseObj of Object.values(action['cases'] as Record<string, unknown>)) {
        if (isRecord(caseObj) && isRecord((caseObj as Record<string, unknown>)['actions'])) {
          result.push(...collectAllActions((caseObj as Record<string, unknown>)['actions'] as Record<string, unknown>));
        }
      }
    }
    if (isRecord(action['default'])) {
      const defaultBlock = action['default'] as Record<string, unknown>;
      if (isRecord(defaultBlock['actions'])) {
        result.push(...collectAllActions(defaultBlock['actions'] as Record<string, unknown>));
      }
    }
  }

  return result;
}

/**
 * Build adjacency list for cycle detection (name -> runAfter names).
 */
export function buildRunAfterGraph(actions: Record<string, unknown>): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const [name, action] of Object.entries(actions)) {
    if (!isRecord(action)) {
      graph.set(name, []);
      continue;
    }
    const runAfter = action['runAfter'];
    if (isRecord(runAfter)) {
      graph.set(name, Object.keys(runAfter));
    } else {
      graph.set(name, []);
    }
  }
  return graph;
}

/**
 * DFS cycle detection. Returns first cycle as string "A -> B -> A" or null.
 */
export function detectCycle(graph: Map<string, string[]>): string | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string>();

  for (const node of graph.keys()) {
    color.set(node, WHITE);
  }

  for (const startNode of graph.keys()) {
    if (color.get(startNode) !== WHITE) continue;

    const stack: string[] = [startNode];
    while (stack.length > 0) {
      const node = stack[stack.length - 1]!;

      if (color.get(node) === WHITE) {
        color.set(node, GRAY);
        const deps = graph.get(node) ?? [];
        for (const dep of deps) {
          if (!graph.has(dep)) continue;
          if (color.get(dep) === GRAY) {
            // Build cycle path
            const path: string[] = [dep, node];
            let cur = node;
            while (cur !== dep) {
              const p = parent.get(cur);
              if (p === undefined) break;
              path.push(p);
              cur = p;
            }
            path.reverse();
            return path.join(' -> ');
          }
          if (color.get(dep) === WHITE) {
            parent.set(dep, node);
            stack.push(dep);
          }
        }
      } else {
        color.set(node, BLACK);
        stack.pop();
      }
    }
  }

  return null;
}

// ─── Main Validator ───────────────────────────────────────────────────────────

export function validateWorkflow(workflowJson: unknown): WorkflowValidationResult {
  const issues: ValidationIssue[] = [];

  function addIssue(severity: ValidationIssue['severity'], rule: string, message: string, path?: string | undefined): void {
    issues.push({ severity, rule, message, ...(path !== undefined ? { path } : {}) });
  }

  // Accept JSON string input — parse it
  let parsed = workflowJson;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      addIssue('error', 'valid-json', 'Input is a string but not valid JSON');
      return buildResult(issues);
    }
  }

  // Rule 1: valid-json
  if (!isRecord(parsed)) {
    addIssue('error', 'valid-json', 'Input must be a non-null object');
    return buildResult(issues);
  }

  const wf = parsed;

  const definition = wf['definition'];
  const kind = wf['kind'];

  if (!isRecord(definition)) {
    addIssue('error', 'valid-json', 'Input must have a "definition" object');
    return buildResult(issues);
  }

  // Rule 2: has-schema
  if (definition['$schema'] !== WDL_SCHEMA_URL) {
    addIssue('error', 'has-schema', `definition.$schema must be "${WDL_SCHEMA_URL}", got "${String(definition['$schema'] ?? 'undefined')}"`, 'definition.$schema');
  }

  // Rule 11: has-content-version
  if (!definition['contentVersion']) {
    addIssue('error', 'has-content-version', 'definition.contentVersion must be present', 'definition.contentVersion');
  }

  // Rule 12: workflow-kind-valid
  if (kind !== undefined && kind !== 'Stateful' && kind !== 'Stateless') {
    addIssue('error', 'workflow-kind-valid', `kind must be "Stateful" or "Stateless", got "${String(kind)}"`, 'kind');
  }

  // Rule 3: has-triggers
  const triggers = definition['triggers'];
  if (!isRecord(triggers) || Object.keys(triggers).length === 0) {
    addIssue('error', 'has-triggers', 'definition.triggers must exist and have at least one trigger', 'definition.triggers');
  }

  // Rule 4: has-actions
  const actions = definition['actions'];
  if (!isRecord(actions)) {
    addIssue('error', 'has-actions', 'definition.actions must exist as an object', 'definition.actions');
    return buildResult(issues);
  }

  // Rule 13: actions-not-empty
  if (Object.keys(actions).length === 0) {
    addIssue('error', 'actions-not-empty', 'definition.actions must not be empty', 'definition.actions');
  }

  // Rule 10: triggers-are-valid
  if (isRecord(triggers)) {
    for (const [triggerName, trigger] of Object.entries(triggers)) {
      if (isRecord(trigger)) {
        const triggerType = trigger['type'];
        if (typeof triggerType !== 'string' || !VALID_TRIGGER_TYPES.has(triggerType)) {
          addIssue('error', 'triggers-are-valid', `Trigger "${triggerName}" has invalid type "${String(triggerType)}"`, `definition.triggers.${triggerName}.type`);
        }
      }
    }
  }

  // Collect all actions for deeper checks
  const allActions = collectAllActions(actions);
  const topLevelActionNames = new Set(Object.keys(actions));

  // Rule 14: no-duplicate-action-names
  const seenNames = new Map<string, number>();
  for (const [name] of allActions) {
    seenNames.set(name, (seenNames.get(name) ?? 0) + 1);
  }
  for (const [name, count] of seenNames) {
    if (count > 1) {
      addIssue('error', 'no-duplicate-action-names', `Action name "${name}" appears ${count} times across all scopes`, `definition.actions.${name}`);
    }
  }

  // Rules 5, 6, 8, 9 — iterate all actions
  for (const [actionName, action] of allActions) {
    const actionType = action['type'] as string | undefined;
    const runAfter = action['runAfter'];

    // Rule 5: runafter-case
    if (isRecord(runAfter)) {
      for (const [depName, statusArr] of Object.entries(runAfter)) {
        if (Array.isArray(statusArr)) {
          for (const status of statusArr) {
            if (typeof status === 'string') {
              if (!VALID_RUNAFTER_STATUSES.has(status)) {
                if (KNOWN_LOWERCASE_STATUSES.has(status)) {
                  addIssue('error', 'runafter-case', `Action "${actionName}" runAfter["${depName}"] uses lowercase status "${status}" — must be ALL CAPS (e.g. "SUCCEEDED")`, `definition.actions.${actionName}.runAfter.${depName}`);
                } else {
                  addIssue('error', 'runafter-case', `Action "${actionName}" runAfter["${depName}"] has unknown status "${status}"`, `definition.actions.${actionName}.runAfter.${depName}`);
                }
              }
            }
          }
        }
      }
    }

    // Rule 6: runafter-refs-exist (only for top-level actions in their scope)
    if (isRecord(runAfter)) {
      for (const depName of Object.keys(runAfter)) {
        if (!topLevelActionNames.has(depName)) {
          addIssue('error', 'runafter-refs-exist', `Action "${actionName}" has runAfter referencing "${depName}" which does not exist in definition.actions`, `definition.actions.${actionName}.runAfter`);
        }
      }
    }

    // Rule 8: serviceprovider-has-config
    if (actionType === 'ServiceProvider') {
      const inputs = action['inputs'];
      if (!isRecord(inputs) ||
        !isRecord(inputs['serviceProviderConfiguration']) ||
        typeof (inputs['serviceProviderConfiguration'] as Record<string, unknown>)['connectionName'] !== 'string') {
        addIssue('error', 'serviceprovider-has-config', `ServiceProvider action "${actionName}" must have inputs.serviceProviderConfiguration.connectionName`, `definition.actions.${actionName}.inputs.serviceProviderConfiguration.connectionName`);
      }
    }

    // Rule 9: if-has-expression
    if (actionType === 'If') {
      if (action['expression'] === undefined) {
        addIssue('error', 'if-has-expression', `If action "${actionName}" must have an "expression" field`, `definition.actions.${actionName}.expression`);
      }
    }
  }

  // Rule 7: no-cycles
  const graph = buildRunAfterGraph(actions);
  const cycle = detectCycle(graph);
  if (cycle !== null) {
    addIssue('error', 'no-cycles', `Circular runAfter dependency detected: ${cycle}`, 'definition.actions');
  }

  // ─── Warnings ────────────────────────────────────────────────────────

  // Rule 15: single-trigger
  if (isRecord(triggers) && Object.keys(triggers).length > 1) {
    addIssue('warning', 'single-trigger', `Workflow has ${Object.keys(triggers).length} triggers — most Logic Apps workflows use a single trigger`, 'definition.triggers');
  }

  // Rule 16: no-error-handling
  const hasErrorHandling = allActions.some(([, action]) => {
    const runAfter = action['runAfter'];
    if (!isRecord(runAfter)) return false;
    return Object.values(runAfter).some(statuses => {
      if (!Array.isArray(statuses)) return false;
      return statuses.includes('FAILED');
    });
  });
  if (!hasErrorHandling) {
    addIssue('warning', 'no-error-handling', 'No error handling detected — consider adding a Scope with runAfter FAILED for resilience', 'definition.actions');
  }

  // Rule 17: has-terminate-status
  for (const [actionName, action] of allActions) {
    if (action['type'] === 'Terminate') {
      const inputs = action['inputs'];
      if (!isRecord(inputs) || typeof inputs['runStatus'] !== 'string') {
        addIssue('warning', 'has-terminate-status', `Terminate action "${actionName}" is missing inputs.runStatus`, `definition.actions.${actionName}.inputs.runStatus`);
      }
    }
  }

  // Rule 18: initialize-variable-top-level
  for (const [actionName, action] of allActions) {
    if (action['type'] === 'InitializeVariable' && !topLevelActionNames.has(actionName)) {
      addIssue('warning', 'initialize-variable-top-level', `InitializeVariable action "${actionName}" is inside a nested scope — should be top-level`, `definition.actions.${actionName}`);
    }
  }

  // Rule 19: missing-outputs
  if (definition['outputs'] === undefined) {
    addIssue('warning', 'missing-outputs', 'definition.outputs field is absent — consider adding outputs for observability', 'definition.outputs');
  }

  // Rule: expression-syntax — check for common expression issues
  const wfStr = JSON.stringify(wf);
  const openBraces = (wfStr.match(/@\{/g) ?? []).length;
  const closeBraces = (wfStr.match(/\}/g) ?? []).length;
  // Simple heuristic: if @{ count exceeds } count significantly, likely unbalanced
  if (openBraces > 0 && openBraces > closeBraces) {
    addIssue('warning', 'expression-syntax', `Potentially unbalanced expressions: found ${openBraces} @{ openers but only ${closeBraces} } closers`, 'definition');
  }

  // Rule: unreachable-actions — actions whose runAfter deps only have FAILED/TIMEDOUT
  // but the action itself only expects SUCCEEDED
  for (const [actionName, action] of allActions) {
    const runAfter = action['runAfter'];
    if (!isRecord(runAfter)) continue;
    for (const [depName, statusArr] of Object.entries(runAfter)) {
      if (!Array.isArray(statusArr)) continue;
      // If the dep action itself only runs after FAILED, and this action expects SUCCEEDED from it,
      // that chain is potentially unreachable
      const depAction = allActions.find(([n]) => n === depName);
      if (!depAction) continue;
      const depRunAfter = depAction[1]['runAfter'];
      if (!isRecord(depRunAfter)) continue;
      const depExpectsOnlyFailed = Object.values(depRunAfter).every(s => {
        if (!Array.isArray(s)) return false;
        return s.length === 1 && s[0] === 'FAILED';
      });
      const thisExpectsSucceeded = statusArr.length === 1 && statusArr[0] === 'SUCCEEDED';
      if (depExpectsOnlyFailed && thisExpectsSucceeded && Object.keys(depRunAfter).length > 0) {
        addIssue('warning', 'unreachable-actions', `Action "${actionName}" expects SUCCEEDED from "${depName}", but "${depName}" only runs on FAILED — may be unreachable`, `definition.actions.${actionName}.runAfter.${depName}`);
      }
    }
  }

  // Rule: no-empty-description
  for (const [actionName, action] of allActions) {
    const desc = action['description'];
    if (typeof desc === 'string' && desc.trim() === '') {
      addIssue('suggestion', 'no-empty-description', `Action "${actionName}" has an empty description — either add a meaningful description or remove the field`, `definition.actions.${actionName}.description`);
    }
  }

  // ─── Suggestions ─────────────────────────────────────────────────────

  // Rule 20: retry-policy-missing
  for (const [actionName, action] of allActions) {
    if (action['type'] === 'Http' && action['retryPolicy'] === undefined) {
      addIssue('suggestion', 'retry-policy-missing', `HTTP action "${actionName}" has no retryPolicy — consider adding one for resilience`, `definition.actions.${actionName}.retryPolicy`);
    }
  }

  // Rule 21: prefer-builtin-connectors
  for (const [actionName, action] of allActions) {
    if (action['type'] === 'ApiConnection') {
      addIssue('suggestion', 'prefer-builtin-connectors', `Action "${actionName}" uses ApiConnection — consider using a built-in ServiceProvider connector for better performance`, `definition.actions.${actionName}`);
    }
  }

  // Rule 22: tracked-properties
  const hasTrackedProperties = allActions.some(([, action]) => action['trackedProperties'] !== undefined);
  if (!hasTrackedProperties && allActions.length > 0) {
    addIssue('suggestion', 'tracked-properties', 'No tracked properties found in any action — consider adding them for monitoring and diagnostics', 'definition.actions');
  }

  // Rule 23: naming-conventions
  for (const [actionName] of allActions) {
    if (GENERIC_NAME_PATTERN.test(actionName)) {
      addIssue('suggestion', 'naming-conventions', `Action name "${actionName}" looks generic — use a descriptive PascalCase name`, `definition.actions.${actionName}`);
    }
  }

  // Rule 24: kvs-for-secrets
  const workflowStr = JSON.stringify(wf);
  const appsettingMatches = workflowStr.matchAll(/@appsetting\('([^']+)'\)/g);
  for (const match of appsettingMatches) {
    const key = match[1]!;
    if (!key.startsWith('KVS_') && /connection|secret|password|key/i.test(key)) {
      addIssue('suggestion', 'kvs-for-secrets', `@appsetting('${key}') looks like a sensitive setting — consider using a KVS_ prefix for Key Vault references`, `@appsetting('${key}')`);
    }
  }

  // Rule 25: stateful-recommended
  if (kind === 'Stateless') {
    addIssue('suggestion', 'stateful-recommended', 'Workflow kind is "Stateless" — for BizTalk migration, "Stateful" is recommended for run history and resubmit support', 'kind');
  }

  // Rule 26: scope-wrap-all
  for (const actionName of topLevelActionNames) {
    const action = actions[actionName];
    if (isRecord(action)) {
      const actionType = action['type'];
      if ((actionType === 'Http' || actionType === 'ServiceProvider') &&
        !isInsideScope(actionName, actions)) {
        addIssue('suggestion', 'scope-wrap-all', `Top-level action "${actionName}" (${String(actionType)}) is not inside a Scope — consider wrapping in a Scope for error handling`, `definition.actions.${actionName}`);
      }
    }
  }

  return buildResult(issues);
}

function isInsideScope(actionName: string, actions: Record<string, unknown>): boolean {
  for (const [, action] of Object.entries(actions)) {
    if (!isRecord(action)) continue;
    if (action['type'] === 'Scope' && isRecord(action['actions'])) {
      const scopeActions = action['actions'] as Record<string, unknown>;
      if (actionName in scopeActions) return true;
    }
  }
  return false;
}

function buildResult(issues: ValidationIssue[]): WorkflowValidationResult {
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const suggestionCount = issues.filter(i => i.severity === 'suggestion').length;
  return {
    valid: errorCount === 0,
    issues,
    errorCount,
    warningCount,
    suggestionCount,
  };
}
