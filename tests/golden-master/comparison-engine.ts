/**
 * Golden Master Comparison Engine
 *
 * Compares two Logic Apps workflow.json or connections.json objects at
 * three levels of strictness:
 *
 *   Level 1 — "exact":    deep-equal ignoring JSON key order
 *   Level 2 — "semantic": same trigger type, same action counts/types, same connectors
 *   Level 3 — "topology": DAG isomorphism of runAfter dependency graph
 *   Level 4 — "mismatch": structurally incompatible
 *
 * The engine is used by golden-master tests to compare generated artifacts
 * against stored golden master files.
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ComparisonResult {
  level: 'exact' | 'semantic' | 'topology' | 'mismatch';
  similarityScore: number;   // 0.0 to 1.0
  differences: ComparisonDifference[];
}

export interface ComparisonDifference {
  path: string;
  expected: unknown;
  actual: unknown;
  severity: 'critical' | 'warning' | 'cosmetic';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Recursive deep-equal that ignores key insertion order.
 * Returns true if the two values are structurally identical.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    if (!keysA.every((k, i) => k === keysB[i])) return false;
    return keysA.every(k => deepEqual(a[k], b[k]));
  }

  return false;
}

/**
 * Collect differences between two values at the given path.
 * Only reports leaf-level differences (does not recurse when values differ at
 * a node level — reports the node-level difference instead).
 */
function collectDiffs(
  expected: unknown,
  actual: unknown,
  path: string,
  diffs: ComparisonDifference[]
): void {
  if (deepEqual(expected, actual)) return;

  if (isRecord(expected) && isRecord(actual)) {
    const allKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of allKeys) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in expected)) {
        diffs.push({ path: childPath, expected: undefined, actual: actual[key], severity: 'warning' });
      } else if (!(key in actual)) {
        diffs.push({ path: childPath, expected: expected[key], actual: undefined, severity: 'warning' });
      } else {
        collectDiffs(expected[key], actual[key], childPath, diffs);
      }
    }
    return;
  }

  // Leaf-level mismatch
  const severity = path.includes('type') || path.includes('$schema') || path.includes('kind')
    ? 'critical'
    : path.includes('name') || path.includes('connectionName') || path.includes('serviceProviderId')
    ? 'warning'
    : 'cosmetic';

  diffs.push({ path, expected, actual, severity });
}

// ─── Semantic Analysis ────────────────────────────────────────────────────────

interface WorkflowSemantics {
  triggerCount: number;
  triggerTypes: string[];
  triggerConnectors: string[];
  topLevelActionCount: number;
  allActionTypes: string[];
  connectors: string[];
  hasErrorHandling: boolean;
  kind: string;
}

/**
 * Recursively collect all action types from an actions record,
 * including those nested inside If/Scope/Switch/ForEach/Until actions.
 */
function collectActionTypes(actionsObj: Record<string, unknown>): string[] {
  const types: string[] = [];
  for (const action of Object.values(actionsObj)) {
    if (!isRecord(action)) continue;
    const t = action['type'];
    if (typeof t === 'string') types.push(t);

    // Nested actions (If true branch)
    if (isRecord(action['actions'])) {
      types.push(...collectActionTypes(action['actions'] as Record<string, unknown>));
    }
    // If else branch
    if (isRecord(action['else'])) {
      const elseBlock = action['else'] as Record<string, unknown>;
      if (isRecord(elseBlock['actions'])) {
        types.push(...collectActionTypes(elseBlock['actions'] as Record<string, unknown>));
      }
    }
    // Scope inner actions
    // (already handled above via action['actions'])
  }
  return types;
}

/**
 * Collect all serviceProviderConfiguration.connectionName values used
 * in actions and triggers.
 */
function collectConnectors(workflowJson: unknown): string[] {
  const connectors: string[] = [];
  if (!isRecord(workflowJson)) return connectors;

  const definition = workflowJson['definition'];
  if (!isRecord(definition)) return connectors;

  function extractFromObj(obj: Record<string, unknown>): void {
    for (const item of Object.values(obj)) {
      if (!isRecord(item)) continue;
      const inputs = item['inputs'];
      if (isRecord(inputs)) {
        const spc = inputs['serviceProviderConfiguration'];
        if (isRecord(spc)) {
          const connName = spc['connectionName'];
          if (typeof connName === 'string') connectors.push(connName);
        }
      }
      // Recurse into nested actions
      if (isRecord(item['actions'])) {
        extractFromObj(item['actions'] as Record<string, unknown>);
      }
      if (isRecord(item['else'])) {
        const e = item['else'] as Record<string, unknown>;
        if (isRecord(e['actions'])) extractFromObj(e['actions'] as Record<string, unknown>);
      }
    }
  }

  const triggers = definition['triggers'];
  const actions = definition['actions'];

  if (isRecord(triggers)) extractFromObj(triggers);
  if (isRecord(actions)) extractFromObj(actions);

  return connectors;
}

function extractSemantics(workflowJson: unknown): WorkflowSemantics | null {
  if (!isRecord(workflowJson)) return null;
  const definition = workflowJson['definition'];
  if (!isRecord(definition)) return null;

  const triggers = definition['triggers'];
  const actions = definition['actions'];
  const kind = typeof workflowJson['kind'] === 'string' ? workflowJson['kind'] : 'unknown';

  const triggerTypes: string[] = [];
  const triggerConnectors: string[] = [];

  if (isRecord(triggers)) {
    for (const trigger of Object.values(triggers)) {
      if (!isRecord(trigger)) continue;
      const t = trigger['type'];
      if (typeof t === 'string') triggerTypes.push(t);
      const inputs = trigger['inputs'];
      if (isRecord(inputs)) {
        const spc = inputs['serviceProviderConfiguration'];
        if (isRecord(spc)) {
          const conn = spc['connectionName'];
          if (typeof conn === 'string') triggerConnectors.push(conn);
        }
      }
    }
  }

  const allActionTypes = isRecord(actions)
    ? collectActionTypes(actions as Record<string, unknown>)
    : [];

  const topLevelActionCount = isRecord(actions) ? Object.keys(actions).length : 0;

  const connectors = collectConnectors(workflowJson);

  // Check for error handling: any runAfter that includes "FAILED"
  const hasErrorHandling = allActionTypes.length > 0 && (() => {
    const actObj = isRecord(actions) ? actions : {};
    function hasFailedRunAfter(obj: Record<string, unknown>): boolean {
      for (const action of Object.values(obj)) {
        if (!isRecord(action)) continue;
        const runAfter = action['runAfter'];
        if (isRecord(runAfter)) {
          for (const statuses of Object.values(runAfter)) {
            if (Array.isArray(statuses) && statuses.includes('FAILED')) return true;
          }
        }
        if (isRecord(action['actions']) && hasFailedRunAfter(action['actions'] as Record<string, unknown>)) return true;
        if (isRecord(action['else'])) {
          const e = action['else'] as Record<string, unknown>;
          if (isRecord(e['actions']) && hasFailedRunAfter(e['actions'] as Record<string, unknown>)) return true;
        }
      }
      return false;
    }
    return hasFailedRunAfter(actObj as Record<string, unknown>);
  })();

  return {
    triggerCount: triggerTypes.length,
    triggerTypes: [...triggerTypes].sort(),
    triggerConnectors: [...new Set(triggerConnectors)].sort(),
    topLevelActionCount,
    allActionTypes: [...allActionTypes].sort(),
    connectors: [...new Set(connectors)].sort(),
    hasErrorHandling,
    kind,
  };
}

function semanticScore(expected: WorkflowSemantics, actual: WorkflowSemantics): number {
  let matches = 0;
  let total = 0;

  // trigger count (critical)
  total += 3;
  if (expected.triggerCount === actual.triggerCount) matches += 3;

  // trigger types
  total += 3;
  const sortedExpT = expected.triggerTypes.join(',');
  const sortedActT = actual.triggerTypes.join(',');
  if (sortedExpT === sortedActT) matches += 3;

  // top-level action count (±1 tolerance)
  total += 2;
  if (Math.abs(expected.topLevelActionCount - actual.topLevelActionCount) <= 1) matches += 2;

  // action type multiset similarity
  total += 4;
  const expTypes = new Map<string, number>();
  const actTypes = new Map<string, number>();
  for (const t of expected.allActionTypes) expTypes.set(t, (expTypes.get(t) ?? 0) + 1);
  for (const t of actual.allActionTypes) actTypes.set(t, (actTypes.get(t) ?? 0) + 1);
  const allTypeKeys = new Set([...expTypes.keys(), ...actTypes.keys()]);
  let typeIntersection = 0;
  let typeUnion = 0;
  for (const key of allTypeKeys) {
    const e = expTypes.get(key) ?? 0;
    const a = actTypes.get(key) ?? 0;
    typeIntersection += Math.min(e, a);
    typeUnion += Math.max(e, a);
  }
  const jaccardTypes = typeUnion === 0 ? 1 : typeIntersection / typeUnion;
  matches += jaccardTypes * 4;

  // connectors
  total += 3;
  const expConns = new Set(expected.connectors);
  const actConns = new Set(actual.connectors);
  const connIntersection = [...expConns].filter(c => actConns.has(c)).length;
  const connUnion = new Set([...expConns, ...actConns]).size;
  const jaccardConns = connUnion === 0 ? 1 : connIntersection / connUnion;
  matches += jaccardConns * 3;

  // error handling
  total += 2;
  if (expected.hasErrorHandling === actual.hasErrorHandling) matches += 2;

  // kind
  total += 2;
  if (expected.kind === actual.kind) matches += 2;

  return matches / total;
}

// ─── Topology Analysis ────────────────────────────────────────────────────────

/**
 * Build an adjacency list (dependency DAG) from the top-level actions'
 * runAfter fields. Node labels = action names.
 */
function buildDag(workflowJson: unknown): Map<string, string[]> {
  const dag = new Map<string, string[]>();
  if (!isRecord(workflowJson)) return dag;
  const definition = workflowJson['definition'];
  if (!isRecord(definition)) return dag;
  const actions = definition['actions'];
  if (!isRecord(actions)) return dag;

  for (const [name, action] of Object.entries(actions)) {
    if (!isRecord(action)) { dag.set(name, []); continue; }
    const runAfter = action['runAfter'];
    dag.set(name, isRecord(runAfter) ? Object.keys(runAfter) : []);
  }
  return dag;
}

/**
 * Compute the in-degree sequence of a DAG — a topology fingerprint that
 * is invariant to node renaming.
 */
function degreeSequence(dag: Map<string, string[]>): number[] {
  const inDegree = new Map<string, number>();
  for (const node of dag.keys()) inDegree.set(node, 0);
  for (const deps of dag.values()) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }
  return [...inDegree.values()].sort((a, b) => a - b);
}

function topologyScore(expected: unknown, actual: unknown): number {
  const expDag = buildDag(expected);
  const actDag = buildDag(actual);

  if (expDag.size === 0 && actDag.size === 0) return 1;
  if (expDag.size === 0 || actDag.size === 0) return 0;

  // Compare degree sequences
  const expSeq = degreeSequence(expDag);
  const actSeq = degreeSequence(actDag);

  // Jaccard similarity of degree sequence arrays
  const len = Math.max(expSeq.length, actSeq.length);
  let matches = 0;
  for (let i = 0; i < len; i++) {
    if (expSeq[i] === actSeq[i]) matches++;
  }
  const seqSimilarity = matches / len;

  // Also compare edge count ratio
  const expEdges = [...expDag.values()].reduce((n, deps) => n + deps.length, 0);
  const actEdges = [...actDag.values()].reduce((n, deps) => n + deps.length, 0);
  const edgeRatio = expEdges === 0 && actEdges === 0
    ? 1
    : Math.min(expEdges, actEdges) / Math.max(expEdges, actEdges);

  return (seqSimilarity * 0.6 + edgeRatio * 0.4);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compare two workflow.json objects at multiple levels.
 *
 * Level determination:
 *   - "exact"    → deep-equal (score = 1.0)
 *   - "semantic" → same structural signature (score = semanticScore)
 *   - "topology" → same DAG topology, different names/config (score = topologyScore)
 *   - "mismatch" → fundamentally different (score = low)
 */
export function compareWorkflows(expected: unknown, actual: unknown): ComparisonResult {
  const differences: ComparisonDifference[] = [];

  // Level 1: Exact
  if (deepEqual(expected, actual)) {
    return { level: 'exact', similarityScore: 1.0, differences: [] };
  }

  // Collect all structural differences
  collectDiffs(expected, actual, '', differences);

  // Level 2: Semantic
  const expSem = extractSemantics(expected);
  const actSem = extractSemantics(actual);

  if (expSem !== null && actSem !== null) {
    const semScore = semanticScore(expSem, actSem);

    if (semScore >= 0.85) {
      return {
        level: 'semantic',
        similarityScore: 0.7 + semScore * 0.25,  // maps to 0.7–0.95 range
        differences,
      };
    }

    // Level 3: Topology
    const topoScore = topologyScore(expected, actual);
    if (topoScore >= 0.7) {
      return {
        level: 'topology',
        similarityScore: 0.4 + topoScore * 0.3,  // maps to 0.4–0.7 range
        differences,
      };
    }

    // Level 4: Mismatch — compute a low blended score
    const blendedScore = semScore * 0.5 + topoScore * 0.3;
    return {
      level: 'mismatch',
      similarityScore: Math.min(blendedScore, 0.4),
      differences,
    };
  }

  return {
    level: 'mismatch',
    similarityScore: 0,
    differences,
  };
}

/**
 * Compare two connections.json objects.
 *
 * Checks:
 *   - Same set of connector names in serviceProviderConnections
 *   - @appsetting() references present (not literal values)
 *   - Same serviceProvider.id values
 */
export function compareConnections(expected: unknown, actual: unknown): ComparisonResult {
  const differences: ComparisonDifference[] = [];

  // Level 1: Exact
  if (deepEqual(expected, actual)) {
    return { level: 'exact', similarityScore: 1.0, differences: [] };
  }

  collectDiffs(expected, actual, '', differences);

  if (!isRecord(expected) || !isRecord(actual)) {
    return { level: 'mismatch', similarityScore: 0, differences };
  }

  const expSpc = expected['serviceProviderConnections'];
  const actSpc = actual['serviceProviderConnections'];

  if (!isRecord(expSpc) || !isRecord(actSpc)) {
    return {
      level: 'mismatch',
      similarityScore: 0,
      differences: [
        {
          path: 'serviceProviderConnections',
          expected: expSpc,
          actual: actSpc,
          severity: 'critical',
        },
      ],
    };
  }

  const expKeys = new Set(Object.keys(expSpc));
  const actKeys = new Set(Object.keys(actSpc));

  // Connector name overlap (Jaccard)
  const intersection = [...expKeys].filter(k => actKeys.has(k)).length;
  const union = new Set([...expKeys, ...actKeys]).size;
  const connectorJaccard = union === 0 ? 1 : intersection / union;

  // Check @appsetting() usage in actual
  const actStr = JSON.stringify(actual);
  const hasAppsettings = actStr.includes('@appsetting(');

  // Check serviceProvider.id values match
  let spIdScore = 0;
  let spIdTotal = 0;
  for (const key of expKeys) {
    if (!actKeys.has(key)) continue;
    spIdTotal++;
    const expConn = expSpc[key];
    const actConn = actSpc[key];
    if (isRecord(expConn) && isRecord(actConn)) {
      const expSp = expConn['serviceProvider'];
      const actSp = actConn['serviceProvider'];
      if (isRecord(expSp) && isRecord(actSp) && expSp['id'] === actSp['id']) {
        spIdScore++;
      }
    }
  }
  const spIdRatio = spIdTotal === 0 ? 1 : spIdScore / spIdTotal;

  const score = connectorJaccard * 0.5 + (hasAppsettings ? 0.2 : 0) + spIdRatio * 0.3;

  const level = score >= 0.95
    ? 'semantic'
    : score >= 0.7
    ? 'topology'
    : 'mismatch';

  return { level, similarityScore: score, differences };
}
