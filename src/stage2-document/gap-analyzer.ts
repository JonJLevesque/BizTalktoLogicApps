/**
 * Gap Analyzer — Stage 2 (Document)
 *
 * Identifies BizTalk capabilities that have no direct equivalent in Azure Logic
 * Apps and recommends mitigation strategies.
 *
 * Gaps are derived from:
 *   - Orchestration-level flags (atomic transactions, BRE calls, compensation, etc.)
 *   - Adapter types in binding files (WCF-NetNamedPipe, WCF-NetTcp)
 *   - Map complexity (scripting functoids, database functoids)
 *   - Pipeline components (custom .NET components)
 *   - Multiple activating receive shapes
 *   - EDI/AS2 pipelines (require Integration Account — low risk but worth flagging)
 *
 * Each gap is rated by severity (critical / high / medium / low) and includes
 * a concrete mitigation strategy with an effort estimate.
 */

import type {
  BizTalkApplication,
  OdxShape,
  ParsedOrchestration,
  ParsedMap,
  ParsedPipeline,
} from '../types/biztalk.js';
import type { MigrationGap, RiskSeverity } from '../types/migration.js';

// ─── Gap Definitions ──────────────────────────────────────────────────────────
// All static gap metadata lives here — no business logic in the definitions.

interface GapDefinition {
  capability: string;
  severity: RiskSeverity;
  description: string;
  mitigation: string;
  baseEffortDays: number;
}

const GAP_DEFS = {
  atomicTransaction: {
    capability: 'MSDTC Atomic Transactions',
    severity: 'critical' as RiskSeverity,
    description:
      'Atomic transaction scopes use MSDTC (Microsoft Distributed Transaction Coordinator) for ' +
      'two-phase commit across multiple systems. Logic Apps has no equivalent and cannot enlist ' +
      'in distributed transactions.',
    mitigation:
      'Redesign using the Saga pattern: decompose the atomic operation into a sequence of local ' +
      'transactions, each paired with a compensating action that reverses its effects if a later ' +
      'step fails. Implement compensation via a dedicated Logic Apps workflow invoked from a ' +
      'Scope action with runAfter ["FAILED"].',
    baseEffortDays: 5,
  },

  longRunningTransaction: {
    capability: 'Long-Running Transactions',
    severity: 'high' as RiskSeverity,
    description:
      'Long-running transaction scopes with custom compensation handlers have no direct equivalent. ' +
      'Logic Apps Standard supports stateful workflow persistence but not BizTalk-style compensation handlers.',
    mitigation:
      'Use Scope actions with runAfter ["FAILED", "TIMEDOUT"] to implement error recovery. For ' +
      'compensation logic, call a separate rollback workflow via HTTP action. Consider Service Bus ' +
      'dead-letter queues for failed-message handling in multi-step processes.',
    baseEffortDays: 3,
  },

  compensation: {
    capability: 'Compensate Shape',
    severity: 'high' as RiskSeverity,
    description:
      'Compensate shapes trigger explicit rollback logic in BizTalk long-running transactions. ' +
      'Logic Apps has no built-in compensation mechanism.',
    mitigation:
      'Implement compensation as a separate rollback workflow. Invoke it from Scope action ' +
      'error handlers using an HTTP action. Document each compensating action pair (forward + ' +
      'undo) and implement them as independently invokable Logic Apps workflows.',
    baseEffortDays: 4,
  },

  brePolicy: {
    capability: 'Business Rules Engine (BRE)',
    severity: 'medium' as RiskSeverity,
    description:
      'BizTalk BRE policies execute complex business rules maintained separately from ' +
      'orchestrations in .brl files. Azure Logic Apps now has a direct equivalent: the ' +
      'Azure Logic Apps Rules Engine uses the SAME BRE runtime as BizTalk, meaning .brl ' +
      'policy files can be migrated with minimal rework.',
    mitigation:
      'Recommended path: migrate policies to the Azure Logic Apps Rules Engine (same BRE ' +
      'runtime — closest structural equivalent, lowest effort). Alternatively: (2) Azure ' +
      'Functions with business logic ported to C# or JavaScript (for complex stateful policies), ' +
      '(3) Inline Logic Apps WDL expressions for simple, stateless rule sets. ' +
      'Each CallRules shape should still be reviewed for runtime dependencies.',
    baseEffortDays: 2,
  },

  suspend: {
    capability: 'Suspend Shape',
    severity: 'medium' as RiskSeverity,
    description:
      'Suspend shapes halt orchestration execution until an administrator manually resumes ' +
      'the instance via BizTalk Admin Console. Logic Apps has no manual-resume capability ' +
      'at the action level.',
    mitigation:
      'Replace with an approval workflow: send a notification (email / Teams) to an operator, ' +
      'then wait for a callback using the HTTP Request trigger pattern. For automated resumption, ' +
      'use a Service Bus message as the resume signal and an Until loop waiting for it.',
    baseEffortDays: 2,
  },

  wcfNetNamedPipe: {
    capability: 'WCF-NetNamedPipe Adapter',
    severity: 'critical' as RiskSeverity,
    description:
      'WCF-NetNamedPipe is an in-process, machine-local IPC transport. It is fundamentally ' +
      'incompatible with cloud deployment — Logic Apps cannot communicate via named pipes ' +
      'and this adapter has no equivalent whatsoever in Azure.',
    mitigation:
      'Redesign required: the system communicating via named pipes must be updated. ' +
      'Options: (1) Expose the service via WCF-BasicHttp/WCF-WSHttp and use the Logic Apps ' +
      'HTTP connector, (2) Migrate the service to expose a REST API, ' +
      '(3) Use Azure Service Bus as the decoupled communication channel.',
    baseEffortDays: 8,
  },

  wcfNetTcp: {
    capability: 'WCF-NetTcp Adapter',
    severity: 'high' as RiskSeverity,
    description:
      'WCF-NetTcp uses TCP binary encoding which is not supported by standard HTTP-based ' +
      'connectors. Standard Logic Apps HTTP actions cannot connect to NetTcp endpoints directly.',
    mitigation:
      'Option A (preferred): Update the WCF service to also expose a REST/HTTP endpoint; ' +
      'use the Logic Apps HTTP connector with managed identity authentication. ' +
      'Option B: Deploy Azure Relay Hybrid Connections to proxy the NetTcp endpoint — ' +
      'this requires Azure Relay to be added to the required services.',
    baseEffortDays: 5,
  },

  customCSharpCode: {
    capability: 'Custom C# Helper Assemblies',
    severity: 'high' as RiskSeverity,
    description:
      'ExpressionShape or MessageAssignmentShape blocks call helper assembly methods ' +
      '(e.g., HelperClass.DoWork(msg)) that do not have direct WDL equivalents. The C# code ' +
      'cannot run inside a Logic Apps workflow without a host.',
    mitigation:
      'Use Logic Apps Local Code Functions (preferred): add a .NET class to the lib/custom folder ' +
      'of your Logic Apps project and invoke it via the Execute Code Function action. This runs ' +
      'in-process with the Logic Apps runtime — no separate deployment, no HTTP latency. ' +
      'Only use Azure Functions for code that is very large, needs its own scaling, ' +
      'or must be shared across multiple applications. ' +
      'For each ExpressionShape marked TODO in the workflow, create a corresponding local function stub.',
    baseEffortDays: 3,
  },

  scriptingFunctoid: {
    capability: 'Scripting Functoids (msxsl:script)',
    severity: 'medium' as RiskSeverity,
    description:
      'Scripting functoids compile to msxsl:script C# blocks embedded in XSLT. The Logic Apps ' +
      'Transform XML action uses .NET XSLT without the msxsl extension — scripts will cause ' +
      'transformation failures at runtime.',
    mitigation:
      'Option A (preferred): Rewrite as standard XSLT templates using built-in XSLT string/math ' +
      'functions. Option B: Extract the C# logic into a Logic Apps Local Code Function ' +
      '(runs in-process, no separate service) and call it before the Transform XML action. ' +
      'Option C (last resort): Azure Function only if the logic requires external dependencies. ' +
      'Each scripting functoid requires individual analysis.',
    baseEffortDays: 2,
  },

  databaseFunctoid: {
    capability: 'Database Functoids',
    severity: 'medium' as RiskSeverity,
    description:
      'Database functoids (DB Lookup, Value Extractor) execute SQL queries during map ' +
      'transformation. The Logic Apps Transform XML action cannot make database calls ' +
      'during transformation.',
    mitigation:
      'Decouple data enrichment from transformation: (1) Before the Transform action, ' +
      'call an Azure Function or SQL Server built-in connector to fetch reference data ' +
      'and store in a Logic Apps variable, (2) Pass the enrichment data as XSLT parameters ' +
      'or embed it into the input message before transformation.',
    baseEffortDays: 3,
  },

  customPipelineComponent: {
    capability: 'Custom Pipeline Components',
    severity: 'medium' as RiskSeverity,
    description:
      'Custom pipeline components implement IPipelineComponent and execute .NET code within ' +
      'the BizTalk pipeline. Logic Apps has no pipeline execution model — each stage must ' +
      'be an explicit action.',
    mitigation:
      'Three migration options depending on complexity: (1) Inline Code action (JavaScript, ' +
      'C#, or PowerShell) for simple transformations that fit in ~50 lines, (2) Local Functions ' +
      '(.NET code running in-process with the Logic Apps runtime) for moderate complexity with ' +
      'shared libraries, (3) Azure Function (separate service) for heavy compute or shared-across-workflows ' +
      'logic. Map pipeline stages: Decode → before trigger, Disassemble → Parse JSON/XML, ' +
      'Validate → Condition action, Assemble → Compose/Transform, Encode → after main logic.',
    baseEffortDays: 3,
  },

  flatFilePipelineOutput: {
    capability: 'Flat File Pipeline Component Output Difference',
    severity: 'low' as RiskSeverity,
    description:
      'The Logic Apps built-in Flat File Decode action produces a different XML structure than ' +
      'the BizTalk FlatFileDisassembler pipeline component. BizTalk generates XML using the ' +
      'flat file schema\'s element names; Logic Apps produces a generic schema-agnostic structure. ' +
      'Downstream maps and validation expecting BizTalk\'s output XML will fail.',
    mitigation:
      'After switching to the Logic Apps Flat File Decode action, run the migration test suite ' +
      'against golden-master outputs. Update any downstream XSLT maps or XSD schemas that reference ' +
      'element names specific to BizTalk\'s flat file XML format. The VS Code Data Mapper extension ' +
      'can help visually remap between the old and new structures.',
    baseEffortDays: 1,
  },

  bamTracking: {
    capability: 'Business Activity Monitoring (BAM)',
    severity: 'low' as RiskSeverity,
    description:
      'BizTalk BAM uses a SQL-based BAMPrimaryImport database and interceptors to track ' +
      'business-level KPIs and milestones. The Azure equivalent is Azure Business Process ' +
      'Tracking (now generally available), backed by Application Insights and Log Analytics.',
    mitigation:
      'Configure Azure Business Process Tracking: define tracking profiles that map to your ' +
      'existing BAM activity definitions. Business milestones become tracked properties on ' +
      'workflow runs. Existing BAM views can be recreated in Power BI connecting to the ' +
      'Log Analytics workspace. BAM alerts map to Azure Monitor alert rules.',
    baseEffortDays: 2,
  },

  multipleActivatingReceives: {
    capability: 'Multiple Activating Receive Shapes',
    severity: 'medium' as RiskSeverity,
    description:
      'Multiple activating Receive shapes create multiple entry points into the same ' +
      'orchestration instance. Logic Apps workflows have a single trigger — multiple entry ' +
      'points require separate workflows or a message dispatcher pattern.',
    mitigation:
      'Create one workflow per activating receive, OR create a dispatcher workflow that accepts ' +
      'all message types and routes to the appropriate sub-workflow via Switch action. ' +
      'The multi-entry pattern maps well to Fan-Out / multiple workflows sharing a common ' +
      'process workflow.',
    baseEffortDays: 3,
  },

  ediProcessing: {
    capability: 'EDI/AS2 Processing',
    severity: 'low' as RiskSeverity,
    description:
      'BizTalk EDI/AS2 uses built-in schemas and runtime support. Logic Apps handles EDI ' +
      'through an Integration Account with X12/EDIFACT schemas — functionally equivalent ' +
      'but requires Integration Account configuration and partner setup. ' +
      'NOTE: Integration Accounts are always billable once created: Free (~dev only), ' +
      'Basic (~$300/month), Standard (~$1,000/month). Include this in migration cost planning.',
    mitigation:
      'Create an Integration Account at the appropriate tier (Basic for typical B2B, Standard ' +
      'for large EDI schema sets or RosettaNet). Upload X12/EDIFACT schemas and configure ' +
      'trading partner agreements. Use Logic Apps X12/EDIFACT encode/decode actions which are ' +
      'direct equivalents. Partner agreements replace BizTalk party configuration. BizTalk EDI ' +
      'schemas are available in Microsoft\'s GitHub repository and can be uploaded directly.',
    baseEffortDays: 2,
  },
} satisfies Record<string, GapDefinition>;

// ─── Adapters with known gaps ─────────────────────────────────────────────────

const ADAPTER_GAPS: Record<string, GapDefinition> = {
  'WCF-NetNamedPipe': GAP_DEFS.wcfNetNamedPipe,
  'WCF-NetTcp':       GAP_DEFS.wcfNetTcp,
  'WCF-Custom': {
    capability: 'WCF-Custom Adapter',
    severity: 'medium' as RiskSeverity,
    description:
      'WCF-Custom is a wrapper adapter that hosts an arbitrary WCF binding (NetTcp, NetNamedPipe, ' +
      'or a custom binding element chain). The actual transport cannot be determined without parsing ' +
      'TransportTypeData — it may hide a non-migratable binding (e.g. NetNamedPipe).',
    mitigation:
      'Inspect the binding type in TransportTypeData of the adapter configuration. ' +
      'If the inner binding is HTTP-based, use the Logic Apps HTTP connector. ' +
      'If NetTcp, follow the WCF-NetTcp mitigation. ' +
      'If NetNamedPipe, redesign is required — no Azure equivalent.',
    baseEffortDays: 1,
  },
};

// ─── Gap factory ──────────────────────────────────────────────────────────────

function makeGap(def: GapDefinition, effortDays: number, artifacts: string[]): MigrationGap {
  return {
    capability:           def.capability,
    severity:             def.severity,
    description:          def.description,
    mitigation:           def.mitigation,
    estimatedEffortDays:  effortDays,
    affectedArtifacts:    artifacts,
  };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Identifies all migration gaps in a BizTalk application.
 * Returns gaps sorted by severity (critical first).
 */
export function analyzeGaps(app: BizTalkApplication): MigrationGap[] {
  const gapMap = new Map<string, MigrationGap>();

  function merge(def: GapDefinition, effortDelta: number, artifact: string): void {
    const existing = gapMap.get(def.capability);
    if (existing) {
      if (!existing.affectedArtifacts.includes(artifact)) {
        existing.affectedArtifacts.push(artifact);
        existing.estimatedEffortDays += effortDelta;
      }
    } else {
      gapMap.set(def.capability, makeGap(def, def.baseEffortDays, [artifact]));
    }
  }

  // ── Orchestration gaps ───────────────────────────────────────────────────
  for (const orch of app.orchestrations) {
    for (const gap of orchestrationGaps(orch)) {
      merge(gap.def, gap.effortDelta, orch.name);
    }
  }

  // ── Map gaps ─────────────────────────────────────────────────────────────
  for (const map of app.maps) {
    for (const gap of mapGaps(map)) {
      merge(gap.def, gap.effortDelta, map.name);
    }
  }

  // ── Pipeline gaps ────────────────────────────────────────────────────────
  for (const pipeline of app.pipelines) {
    for (const gap of pipelineGaps(pipeline)) {
      merge(gap.def, gap.effortDelta, pipeline.name);
    }
  }

  // ── Adapter gaps (from binding files) ────────────────────────────────────
  for (const binding of app.bindingFiles) {
    for (const rl of binding.receiveLocations) {
      const def = ADAPTER_GAPS[rl.adapterType];
      if (def) merge(def, 0, rl.name);
    }
    for (const sp of binding.sendPorts) {
      const def = ADAPTER_GAPS[sp.adapterType];
      if (def) merge(def, 0, sp.name);
    }
  }

  // ── Multiple activating receives ─────────────────────────────────────────
  const multiActivating = app.orchestrations.filter(o => o.activatingReceiveCount > 1);
  if (multiActivating.length > 0) {
    const gap = makeGap(
      GAP_DEFS.multipleActivatingReceives,
      GAP_DEFS.multipleActivatingReceives.baseEffortDays,
      multiActivating.map(o => o.name)
    );
    gapMap.set(gap.capability, gap);
  }

  // ── Flat file pipeline components ─────────────────────────────────────────
  function isFlatFileComponent(c: { fullTypeName: string; componentType: string }): boolean {
    const tn = c.fullTypeName.toLowerCase();
    return (
      tn.includes('flatfile') ||
      tn.includes('ffdasm') ||
      tn.includes('ffasm') ||
      c.componentType === 'FlatFileDasmComp' ||
      c.componentType === 'FlatFileAsmComp' ||
      c.componentType === 'FFDasmComp' ||
      c.componentType === 'FFAsmComp'
    );
  }

  const flatFileInUse = app.pipelines.some(p => p.components.some(isFlatFileComponent));
  if (flatFileInUse && !gapMap.has(GAP_DEFS.flatFilePipelineOutput.capability)) {
    gapMap.set(
      GAP_DEFS.flatFilePipelineOutput.capability,
      makeGap(
        GAP_DEFS.flatFilePipelineOutput,
        GAP_DEFS.flatFilePipelineOutput.baseEffortDays,
        app.pipelines
          .filter(p => p.components.some(isFlatFileComponent))
          .map(p => p.name)
      )
    );
  }

  // ── BAM tracking (heuristic: orchestrations with correlation sets or long-running txns) ──
  const bamLikely =
    app.orchestrations.some(o => o.correlationSets.length > 0 || o.hasLongRunningTransactions) ||
    app.pipelines.some(p =>
      p.components.some(c =>
        c.fullTypeName.toLowerCase().includes('bam') ||
        c.fullTypeName.toLowerCase().includes('tracking')
      )
    );
  if (bamLikely && !gapMap.has(GAP_DEFS.bamTracking.capability)) {
    gapMap.set(
      GAP_DEFS.bamTracking.capability,
      makeGap(GAP_DEFS.bamTracking, GAP_DEFS.bamTracking.baseEffortDays, ['BAM tracking configuration'])
    );
  }

  // ── EDI/AS2 pipelines ────────────────────────────────────────────────────
  const ediInUse =
    app.bindingFiles.flatMap(b => b.receiveLocations).some(rl =>
      rl.pipelineName.toLowerCase().includes('edi') ||
      rl.pipelineName.toLowerCase().includes('as2')
    ) ||
    app.pipelines.some(p =>
      p.components.some(c =>
        c.fullTypeName.toLowerCase().includes('edi') ||
        c.fullTypeName.toLowerCase().includes('as2') ||
        c.fullTypeName.toLowerCase().includes('x12') ||
        c.fullTypeName.toLowerCase().includes('edifact')
      )
    ) ||
    app.schemas.some(s => s.isEDISchema);

  if (ediInUse && !gapMap.has(GAP_DEFS.ediProcessing.capability)) {
    gapMap.set(
      GAP_DEFS.ediProcessing.capability,
      makeGap(GAP_DEFS.ediProcessing, GAP_DEFS.ediProcessing.baseEffortDays, ['EDI/AS2 configuration'])
    );
  }

  // Sort: critical → high → medium → low
  const ORDER: RiskSeverity[] = ['critical', 'high', 'medium', 'low'];
  return Array.from(gapMap.values()).sort(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity)
  );
}

// ─── Per-artifact gap extractors ──────────────────────────────────────────────

interface GapHit { def: GapDefinition; effortDelta: number }

/** Returns true if the C# expression looks like a helper assembly method call. */
function isComplexCSharp(expr: string): boolean {
  return (
    /\w+\.\w+\(/.test(expr) ||       // method calls like Helper.Process(msg)
    expr.includes('namespace ') ||    // namespace declarations
    expr.includes('using ') ||        // using statements
    expr.split('\n').length > 3        // multi-line code blocks
  );
}

/** Recursively collects all ExpressionShape/MessageAssignmentShape code expressions. */
function collectExpressions(shapes: OdxShape[]): string[] {
  const exprs: string[] = [];
  for (const shape of shapes) {
    if (
      (shape.shapeType === 'ExpressionShape' || shape.shapeType === 'MessageAssignmentShape') &&
      shape.codeExpression
    ) {
      exprs.push(shape.codeExpression);
    }
    if (shape.children) exprs.push(...collectExpressions(shape.children));
  }
  return exprs;
}

function orchestrationGaps(orch: ParsedOrchestration): GapHit[] {
  const hits: GapHit[] = [];
  if (orch.hasAtomicTransactions)     hits.push({ def: GAP_DEFS.atomicTransaction,     effortDelta: 2 });
  if (orch.hasLongRunningTransactions) hits.push({ def: GAP_DEFS.longRunningTransaction, effortDelta: 1 });
  if (orch.hasCompensation)            hits.push({ def: GAP_DEFS.compensation,           effortDelta: 2 });
  if (orch.hasBRECalls)                hits.push({ def: GAP_DEFS.brePolicy,              effortDelta: 1 });
  if (orch.hasSuspend)                 hits.push({ def: GAP_DEFS.suspend,                effortDelta: 1 });

  // Detect ExpressionShapes with complex C# code (helper assembly calls)
  const complexExprs = collectExpressions(orch.shapes).filter(isComplexCSharp);
  if (complexExprs.length > 0) {
    hits.push({ def: GAP_DEFS.customCSharpCode, effortDelta: Math.min(complexExprs.length, 5) });
  }

  return hits;
}

function mapGaps(map: ParsedMap): GapHit[] {
  const hits: GapHit[] = [];
  if (map.hasScriptingFunctoids) {
    const count = map.functoids.filter(f => f.isScripting).length;
    hits.push({ def: GAP_DEFS.scriptingFunctoid, effortDelta: Math.max(1, count) });
  }
  if (map.hasDatabaseFunctoids) {
    hits.push({ def: GAP_DEFS.databaseFunctoid, effortDelta: 1 });
  }
  return hits;
}

function pipelineGaps(pipeline: ParsedPipeline): GapHit[] {
  if (!pipeline.hasCustomComponents) return [];
  const customCount = pipeline.components.filter(c => c.isCustom).length;
  return [{ def: GAP_DEFS.customPipelineComponent, effortDelta: customCount }];
}
