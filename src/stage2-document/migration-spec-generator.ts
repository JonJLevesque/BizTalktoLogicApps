/**
 * Migration Spec Generator — Stage 2 (Document)
 *
 * The main entry point for Stage 2. Orchestrates all Stage 2 analyzers
 * and produces a complete MigrationPlan and MigrationResult.
 *
 * Calls:
 *   1. analyzeGaps()         — gap-analyzer
 *   2. assessRisk()          — risk-assessor
 *   3. recommendArchitecture() — architecture-recommender
 *
 * Then synthesizes:
 *   - componentMappings: per-artifact source → target mapping table
 *   - summary: plain English description of the integration and migration approach
 *   - Full MigrationPlan consumed by Stage 3 (Build)
 *
 * The componentMappings cover:
 *   - Each orchestration (artifact-level) + each distinct shape type used
 *   - Each map (with migration path)
 *   - Each pipeline and its components
 *   - Each distinct adapter type used in binding files
 */

import type {
  BizTalkApplication,
  ParsedOrchestration,
} from '../types/biztalk.js';
import type {
  MigrationPlan,
  MigrationResult,
  ComponentMigrationMapping,
  MigrationStatus,
  EffortEstimate,
  TargetComponentType,
} from '../types/migration.js';
import type { IntegrationIntent } from '../shared/integration-intent.js';
import { analyzeGaps } from './gap-analyzer.js';
import { assessRisk } from './risk-assessor.js';
import { recommendArchitecture } from './architecture-recommender.js';

// ─── Shape → Action lookup ────────────────────────────────────────────────────

interface ShapeMapping {
  target:     string;
  targetType: TargetComponentType;
  status:     MigrationStatus;
  effort:     EffortEstimate;
  notes?:     string;
}

const SHAPE_MAP: Record<string, ShapeMapping> = {
  ReceiveShape:           { target: 'Trigger (type determined by adapter)',        targetType: 'trigger',       status: 'direct',  effort: 'low' },
  SendShape:              { target: 'HTTP / Service Provider action',               targetType: 'action',        status: 'direct',  effort: 'low' },
  ConstructShape:         { target: 'Compose action',                               targetType: 'action',        status: 'direct',  effort: 'low' },
  MessageAssignmentShape: { target: 'Compose / Initialize Variable action',         targetType: 'action',        status: 'direct',  effort: 'low' },
  TransformShape:         { target: 'Transform XML action',                         targetType: 'action',        status: 'direct',  effort: 'low' },
  DecisionShape:          { target: 'If / Condition action',                        targetType: 'action',        status: 'direct',  effort: 'low' },
  LoopShape:              { target: 'Until action (inverted condition)',             targetType: 'action',        status: 'partial', effort: 'low',
    notes: 'BizTalk loops while condition is TRUE; Logic Apps Until loops until condition is TRUE — invert the expression.' },
  ListenShape:            { target: 'Parallel branches or Switch on message type',  targetType: 'action',        status: 'partial', effort: 'medium',
    notes: 'Listen branches map to competing triggers or a Switch action evaluating a message-type property.' },
  ParallelActionsShape:   { target: 'Actions with shared runAfter predecessor',     targetType: 'action',        status: 'direct',  effort: 'medium',
    notes: 'Parallel execution is achieved by having multiple actions with the same runAfter predecessor. No explicit parallel action needed.' },
  ScopeShape:             { target: 'Scope action',                                 targetType: 'action',        status: 'partial', effort: 'medium',
    notes: 'Inner catch/compensate handlers map to actions with runAfter ["FAILED"] on the Scope action.' },
  CompensateShape:        { target: 'Child workflow invocation (compensation)',     targetType: 'action',        status: 'partial', effort: 'high',
    notes: 'No built-in compensation — implement as a separate rollback workflow called from a Scope error handler.' },
  ThrowShape:             { target: 'Terminate action',                             targetType: 'action',        status: 'direct',  effort: 'low' },
  TerminateShape:         { target: 'Terminate action',                             targetType: 'action',        status: 'direct',  effort: 'low' },
  DelayShape:             { target: 'Delay action',                                 targetType: 'action',        status: 'direct',  effort: 'trivial' },
  ExpressionShape:        { target: 'Initialize/Set Variable + WDL expression',    targetType: 'action',        status: 'partial', effort: 'low',
    notes: 'XLANG/s C# expressions require translation to WDL @{...} syntax — review auto-translated expressions carefully.' },
  CallOrchestrationShape: { target: 'Workflow action (synchronous child workflow)',  targetType: 'action',        status: 'direct',  effort: 'low',
    notes: 'Maps to WDL type "Workflow" with host.workflow.id set to the child workflow name. Synchronous — caller waits for child to complete.' },
  StartOrchestrationShape:{ target: 'HTTP POST to child workflow Request trigger',  targetType: 'action',        status: 'direct',  effort: 'low',
    notes: 'Fire-and-forget: use HTTP action to POST to the child workflow\'s Request trigger URL. Caller does not wait for completion.' },
  CallRulesShape:         { target: 'Azure Logic Apps Rules Engine (BRE-compatible)',targetType: 'action',        status: 'direct',  effort: 'low',
    notes: 'Azure Logic Apps Rules Engine uses the same BRE runtime as BizTalk. .brl policy files can be migrated with minimal rework. ' +
           'Alternatively, port to Azure Functions (for complex stateful policies) or inline WDL expressions (for simple rules).' },
  SuspendShape:           { target: 'Approval workflow (HTTP Request callback)',    targetType: 'action',        status: 'partial', effort: 'medium',
    notes: 'No built-in suspend — use an HTTP Request trigger waiting for an external resume signal, or a Service Bus message.' },
  ForEachShape:           { target: 'For Each action',                              targetType: 'action',        status: 'direct',  effort: 'low' },
  GroupShape:             { target: '(visual grouping — no action generated)',      targetType: 'not-applicable',status: 'direct',  effort: 'trivial' },
  RoleLinkShape:          { target: '(partner endpoint selection — no action)',     targetType: 'not-applicable',status: 'direct',  effort: 'trivial',
    notes: 'Role Links select partner endpoints at runtime. Migrate to custom connector configuration or parameter-driven HTTP action URIs.' },
  CommentShape:           { target: '(omitted from output)',                        targetType: 'not-applicable',status: 'direct',  effort: 'trivial' },
};

// ─── Adapter → Connector lookup ───────────────────────────────────────────────

interface AdapterMapping {
  target:     string;
  targetType: TargetComponentType;
  status:     MigrationStatus;
  effort:     EffortEstimate;
  notes?:     string;
}

const ADAPTER_MAP: Record<string, AdapterMapping> = {
  FILE:              { target: 'Azure Blob Storage built-in connector',                   targetType: 'connector',      status: 'direct',  effort: 'low' },
  MSMQ:             { target: 'Azure Service Bus built-in connector',                     targetType: 'connector',      status: 'direct',  effort: 'low' },
  HTTP:             { target: 'HTTP built-in trigger / action',                           targetType: 'connector',      status: 'direct',  effort: 'trivial' },
  HTTPS:            { target: 'HTTP built-in trigger / action',                           targetType: 'connector',      status: 'direct',  effort: 'trivial' },
  FTP:              { target: 'FTP managed connector',                                     targetType: 'connector',      status: 'direct',  effort: 'low' },
  SFTP:             { target: 'SFTP-SSH managed connector',                               targetType: 'connector',      status: 'direct',  effort: 'low' },
  SMTP:             { target: 'Office 365 Outlook or SMTP built-in connector',            targetType: 'connector',      status: 'direct',  effort: 'trivial' },
  POP3:             { target: 'Office 365 Outlook managed connector',                     targetType: 'connector',      status: 'direct',  effort: 'low' },
  IMAP:             { target: 'IMAP managed connector',                                   targetType: 'connector',      status: 'direct',  effort: 'low' },
  SQL:              { target: 'SQL Server built-in connector (on-prem gateway)',           targetType: 'connector',      status: 'direct',  effort: 'low' },
  SAP:              { target: 'SAP built-in connector (on-prem gateway)',                 targetType: 'connector',      status: 'direct',  effort: 'medium' },
  Oracle:           { target: 'Oracle DB managed connector (on-prem gateway)',            targetType: 'connector',      status: 'direct',  effort: 'medium' },
  'WCF-BasicHttp':  { target: 'HTTP built-in action',                                     targetType: 'connector',      status: 'direct',  effort: 'trivial' },
  'WCF-WSHttp':     { target: 'HTTP built-in action',                                     targetType: 'connector',      status: 'direct',  effort: 'low' },
  'WCF-WebHttp':    { target: 'HTTP built-in trigger / action',                           targetType: 'connector',      status: 'direct',  effort: 'trivial' },
  'WCF-NetTcp':     { target: 'Azure Relay → HTTP (requires WCF service update)',         targetType: 'connector',      status: 'partial', effort: 'high',
    notes: 'Update the WCF service to expose a REST endpoint, or deploy Azure Relay Hybrid Connections.' },
  'WCF-NetNamedPipe':{ target: '(no equivalent — architectural redesign required)',       targetType: 'not-applicable', status: 'none',    effort: 'very-high',
    notes: 'In-process IPC cannot be used in a cloud deployment. The named-pipe service must expose a REST or Service Bus interface.' },
  'WCF-Custom':     { target: 'HTTP built-in action (review WCF binding config)',        targetType: 'connector',      status: 'partial', effort: 'medium' },
  'WCF-CustomIsolated':{ target: 'HTTP built-in action (review WCF binding config)',     targetType: 'connector',      status: 'partial', effort: 'medium' },
  'WCF-NetMsmq':    { target: 'Azure Service Bus built-in connector',                    targetType: 'connector',      status: 'direct',  effort: 'low' },
  MQSeries:         { target: 'IBM MQ built-in connector (on-prem gateway)',             targetType: 'connector',      status: 'direct',  effort: 'medium' },
  'WebSphere MQ':   { target: 'IBM MQ built-in connector (on-prem gateway)',             targetType: 'connector',      status: 'direct',  effort: 'medium' },
  'IBM MQ':         { target: 'IBM MQ built-in connector',                               targetType: 'connector',      status: 'direct',  effort: 'medium' },
  FTPS:             { target: 'FTP managed connector (supports FTPS)',                   targetType: 'connector',      status: 'direct',  effort: 'low' },
  MLLP:             { target: 'MLLP built-in connector (HL7)',                           targetType: 'connector',      status: 'direct',  effort: 'medium',
    notes: 'Requires Integration Account for HL7 schema validation. MLLP connector is built-in to Logic Apps Standard.' },
  AS2:              { target: 'AS2 built-in connector + Integration Account',            targetType: 'connector',      status: 'direct',  effort: 'medium',
    notes: 'Requires Integration Account (Basic or Standard tier) for partner agreements and certificates.' },
  X12:              { target: 'X12 built-in connector + Integration Account',            targetType: 'connector',      status: 'direct',  effort: 'medium',
    notes: 'Requires Integration Account for X12 schemas and trading partner agreements.' },
  EDIFACT:          { target: 'EDIFACT built-in connector + Integration Account',        targetType: 'connector',      status: 'direct',  effort: 'medium',
    notes: 'Requires Integration Account for EDIFACT schemas and trading partner agreements.' },
  RosettaNet:       { target: 'RosettaNet built-in connector + Integration Account',     targetType: 'connector',      status: 'direct',  effort: 'high',
    notes: 'RosettaNet connector available in Logic Apps Standard. Requires Integration Account (Standard tier).' },
  SWIFT:            { target: 'SWIFT built-in connector + Integration Account',          targetType: 'connector',      status: 'direct',  effort: 'high',
    notes: 'SWIFT connector available in Logic Apps Standard. Requires Integration Account and SWIFT BIC configuration.' },
  'DB2':            { target: 'IBM Db2 built-in connector',                              targetType: 'connector',      status: 'direct',  effort: 'low' },
  'IBM CICS':       { target: 'IBM CICS built-in connector',                             targetType: 'connector',      status: 'direct',  effort: 'medium' },
  'IBM IMS':        { target: 'IBM IMS built-in connector',                              targetType: 'connector',      status: 'direct',  effort: 'medium' },
};

// ─── Map migration path → description ────────────────────────────────────────

interface MapPathInfo {
  target: string;
  effort: EffortEstimate;
  status: MigrationStatus;
  notes:  string;
}

const MAP_PATH_INFO: Record<string, MapPathInfo> = {
  lml:             { target: 'Logic Apps Data Mapper (LML)',            effort: 'low',      status: 'direct',
    notes: 'Simple map — use the VS Code Data Mapper extension for visual drag-and-drop migration. Produces .lml format natively supported by Logic Apps Standard.' },
  xslt:            { target: 'Transform XML action (XSLT)',             effort: 'low',      status: 'direct',
    notes: 'Standard XSLT without scripting extensions — compatible with Logic Apps. Consider also using the VS Code Data Mapper extension for visual validation.' },
  'xslt-rewrite':  { target: 'Transform XML action (XSLT — rewrite)',  effort: 'medium',   status: 'partial',
    notes: 'Scripting functoids use msxsl:script C# blocks which are NOT supported in Logic Apps XSLT. Rewrite as standard XSLT templates, ' +
           'or extract to an Azure Function / Local Function called before the Transform action.' },
  'azure-function':{ target: 'Azure Function (complex logic)',          effort: 'high',     status: 'partial',
    notes: 'Contains C# scripting or database functoids — extract logic to an Azure Function or Local Function and invoke via HTTP action.' },
  manual:          { target: '(manual conversion required)',            effort: 'very-high', status: 'none',
    notes: 'Cannot be auto-converted. Requires manual analysis and rebuild from scratch using the VS Code Data Mapper extension.' },
};

// ─── Pipeline component → action mapping ─────────────────────────────────────

interface ComponentMapping {
  target:     string;
  status:     MigrationStatus;
  effort:     EffortEstimate;
}

const PIPELINE_COMPONENT_MAP: Record<string, ComponentMapping> = {
  XmlDasmComp:                  { target: 'Parse JSON/XML inline (no explicit action)',          status: 'direct',  effort: 'trivial' },
  XmlAsmComp:                   { target: 'Compose action or Transform XML',                     status: 'direct',  effort: 'trivial' },
  FlatFileDasmComp:             { target: 'Flat File decode (Azure Function or custom connector)', status: 'partial', effort: 'medium' },
  FlatFileAsmComp:              { target: 'Flat File encode (Azure Function or custom connector)', status: 'partial', effort: 'medium' },
  XmlValidator:                 { target: 'Condition + inline schema validation',                 status: 'partial', effort: 'low' },
  MIME_SMIME_Decoder:           { target: 'HTTP connector (MIME) + custom decode Azure Function', status: 'partial', effort: 'medium' },
  MIME_SMIME_Encoder:           { target: 'HTTP connector (MIME) + custom encode Azure Function', status: 'partial', effort: 'medium' },
  PartyRes:                     { target: 'Integration Account partner configuration',            status: 'partial', effort: 'medium' },
  EDIDisassemblerComp:          { target: 'X12/EDIFACT decode action (Integration Account)',      status: 'direct',  effort: 'medium' },
  EDIAssemblerComp:             { target: 'X12/EDIFACT encode action (Integration Account)',      status: 'direct',  effort: 'medium' },
  BatchMarkerPipelineComponent: { target: 'Service Bus batching or Integration Account batch',   status: 'partial', effort: 'high' },
  JsonDecoder:                  { target: 'Parse JSON action',                                    status: 'direct',  effort: 'trivial' },
  JsonEncoder:                  { target: 'Compose action',                                       status: 'direct',  effort: 'trivial' },
  AS2Decoder:                   { target: 'AS2 decode action (Integration Account)',              status: 'direct',  effort: 'medium' },
  AS2Encoder:                   { target: 'AS2 encode action (Integration Account)',              status: 'direct',  effort: 'medium' },
};

// ─── Main Entry Points ────────────────────────────────────────────────────────

/**
 * Generates a complete MigrationPlan for a BizTalk application.
 * This is the primary Stage 2 function used by MCP tools and CLI commands.
 */
export function generateMigrationSpec(
  app: BizTalkApplication,
  intent: IntegrationIntent
): MigrationPlan {
  const gaps         = analyzeGaps(app);
  const risk         = assessRisk(gaps, app);
  const architecture = recommendArchitecture(app, gaps, intent.patterns);

  const componentMappings: ComponentMigrationMapping[] = [
    ...buildOrchestrationMappings(app),
    ...buildMapMappings(app),
    ...buildPipelineMappings(app),
    ...buildAdapterMappings(app),
  ];

  const summary = buildSummary(app, intent, risk, architecture);

  return {
    summary,
    componentMappings,
    gapAnalysis: {
      gaps,
      overallRisk:          risk.overallRisk,
      estimatedEffortDays:  risk.estimatedEffortDays,
    },
    architectureRecommendation: architecture,
    manualInterventionPoints:   risk.manualInterventionPoints,
  };
}

/**
 * Generates a complete MigrationResult — the aggregate output of Stage 1 + Stage 2.
 * Stage 3 (Build) consumes this as input.
 */
export function generateMigrationResult(
  app: BizTalkApplication,
  intent: IntegrationIntent
): MigrationResult {
  return {
    schemaVersion:   '1.0.0',
    analysisDate:    new Date().toISOString(),
    biztalkApplication: app,
    integrationIntent:  intent,
    migrationPlan:   generateMigrationSpec(app, intent),
  };
}

// ─── Orchestration Mappings ───────────────────────────────────────────────────

function buildOrchestrationMappings(app: BizTalkApplication): ComponentMigrationMapping[] {
  const mappings: ComponentMigrationMapping[] = [];

  for (const orch of app.orchestrations) {
    // Artifact-level mapping (one entry per orchestration)
    mappings.push({
      sourceComponent:              `Orchestration: ${orch.name}`,
      sourceType:                   'artifact',
      migrationStatus:              orch.hasAtomicTransactions ? 'partial' : 'direct',
      targetComponent:              `Logic Apps Stateful Workflow: ${orch.name}`,
      targetType:                   'action',
      effort:                       orchestrationEffort(orch),
      expressionTranslationRequired: orch.shapes.some(s => s.codeExpression || s.conditionExpression),
      ...(buildOrchestrationNotes(orch) ? { configNotes: buildOrchestrationNotes(orch)! } : {}),
    });

    // Shape-type-level mappings (deduplicated within this orchestration)
    const seenShapeTypes = new Set<string>();
    for (const shape of orch.shapes) {
      const key = `${orch.name}: ${shape.shapeType}`;
      if (seenShapeTypes.has(key)) continue;
      seenShapeTypes.add(key);

      const m = SHAPE_MAP[shape.shapeType];
      if (!m || m.targetType === 'not-applicable') continue;

      mappings.push({
        sourceComponent: key,
        sourceType:      'shape',
        migrationStatus: m.status,
        targetComponent: m.target,
        targetType:      m.targetType,
        effort:          m.effort,
        ...(m.notes ? { configNotes: m.notes } : {}),
      });
    }
  }

  return mappings;
}

// ─── Map Mappings ─────────────────────────────────────────────────────────────

function buildMapMappings(app: BizTalkApplication): ComponentMigrationMapping[] {
  return app.maps.map(map => {
    const path = map.recommendedMigrationPath ?? 'xslt';
    const info = (MAP_PATH_INFO[path] ?? MAP_PATH_INFO['xslt'])!;
    return {
      sourceComponent:     `Map: ${map.name}`,
      sourceType:          'artifact' as const,
      migrationStatus:     info.status,
      targetComponent:     info.target,
      targetType:          'action' as const,
      effort:              info.effort,
      mapConversionRequired: true,
      ...(info.notes ? { configNotes: info.notes } : {}),
    };
  });
}

// ─── Pipeline Mappings ────────────────────────────────────────────────────────

function buildPipelineMappings(app: BizTalkApplication): ComponentMigrationMapping[] {
  const mappings: ComponentMigrationMapping[] = [];

  for (const pipeline of app.pipelines) {
    if (pipeline.isDefault) {
      mappings.push({
        sourceComponent: `Pipeline: ${pipeline.name} (default)`,
        sourceType:      'artifact',
        migrationStatus: 'direct',
        targetComponent: 'No equivalent — Logic Apps parses XML/JSON inline',
        targetType:      'not-applicable',
        effort:          'trivial',
        configNotes:     'Default BizTalk pipelines have no Logic Apps equivalent. XML/JSON parsing is handled inline by trigger and Parse JSON actions.',
      });
      continue;
    }

    for (const comp of pipeline.components) {
      if (comp.isCustom) {
        mappings.push({
          sourceComponent: `${pipeline.name}: ${comp.componentType} (custom)`,
          sourceType:      'pipeline-component',
          migrationStatus: 'partial',
          targetComponent: 'Azure Function',
          targetType:      'azure-function',
          effort:          'high',
          configNotes:     'Custom pipeline component — port business logic to an Azure Function and invoke via HTTP action in the workflow.',
        });
      } else {
        const known = PIPELINE_COMPONENT_MAP[comp.componentType];
        mappings.push({
          sourceComponent: `${pipeline.name}: ${comp.componentType}`,
          sourceType:      'pipeline-component',
          migrationStatus: known?.status ?? 'partial',
          targetComponent: known?.target ?? 'Review required',
          targetType:      'action',
          effort:          known?.effort ?? 'medium',
        });
      }
    }
  }

  return mappings;
}

// ─── Adapter Mappings ─────────────────────────────────────────────────────────

function buildAdapterMappings(app: BizTalkApplication): ComponentMigrationMapping[] {
  const seen    = new Set<string>();
  const mappings: ComponentMigrationMapping[] = [];

  for (const binding of app.bindingFiles) {
    for (const port of [...binding.receiveLocations, ...binding.sendPorts]) {
      if (seen.has(port.adapterType)) continue;
      seen.add(port.adapterType);

      const m = ADAPTER_MAP[port.adapterType];
      if (m) {
        mappings.push({
          sourceComponent: `Adapter: ${port.adapterType}`,
          sourceType:      'adapter',
          migrationStatus: m.status,
          targetComponent: m.target,
          targetType:      m.targetType,
          effort:          m.effort,
          configNotes:     m.notes ?? `Example port: ${port.name}`,
        });
      } else {
        mappings.push({
          sourceComponent: `Adapter: ${port.adapterType}`,
          sourceType:      'adapter',
          migrationStatus: 'partial',
          targetComponent: 'No standard mapping — review Logic Apps connector catalog',
          targetType:      'connector',
          effort:          'medium',
          configNotes:     `No standard mapping for ${port.adapterType}. Review the Logic Apps connector catalog for an equivalent.`,
        });
      }
    }
  }

  return mappings;
}

// ─── Summary Builder ──────────────────────────────────────────────────────────

function buildSummary(
  app: BizTalkApplication,
  intent: IntegrationIntent,
  risk: ReturnType<typeof assessRisk>,
  arch: ReturnType<typeof recommendArchitecture>
): string {
  const parts: string[] = [];

  parts.push(
    `This BizTalk application "${app.name}" contains ` +
    `${app.orchestrations.length} orchestration(s), ${app.maps.length} map(s), ` +
    `${app.pipelines.length} pipeline(s), and ` +
    `${app.bindingFiles.flatMap(b => b.receiveLocations).length} receive location(s).`
  );

  if (intent.trigger.source !== 'unknown') {
    const destinations = intent.systems
      .filter(s => s.role === 'destination')
      .map(s => s.name)
      .join(', ');

    parts.push(
      `The integration is triggered by ${intent.trigger.source}` +
      (destinations ? ` and delivers to ${destinations}` : '') +
      (intent.steps.length > 0 ? `, processing data through ${intent.steps.length} step(s).` : '.')
    );
  }

  if (intent.patterns.length > 0) {
    parts.push(`Detected enterprise integration patterns: ${intent.patterns.join(', ')}.`);
  }

  parts.push(
    `Target architecture: Logic Apps Standard producing approximately ${arch.workflowCount} workflow(s).` +
    (arch.requiresIntegrationAccount ? ' Integration Account required (EDI/AS2).' : '') +
    (arch.requiresOnPremGateway ? ' On-premises data gateway required.' : '')
  );

  parts.push(
    `Overall migration risk: ${risk.overallRisk.toUpperCase()}. ` +
    `Estimated effort: ${risk.estimatedEffortDays} person-day(s).`
  );

  if (arch.requiresIntegrationAccount) {
    parts.push(
      'Integration Account cost: Basic ~$300/month, Standard ~$1,000/month. ' +
      'Integration Accounts are always billable once created — include this in the migration budget.'
    );
  }

  parts.push(
    'Recommended naming convention: Logic Apps resource "LAStd-{BU}-{Dept}-{Env}", ' +
    'workflows "Process-{name}", connections "CN-{ConnectorType}-{Workflow}". ' +
    'Consistent naming enables policy-driven governance and cost allocation by department. ' +
    'App setting naming convention (Pascal_Snake_Case): [Type]_[Category]_[ServiceName]_[SettingName]. ' +
    'Categories: API (endpoints/keys), DB (databases/messaging), KVS (Key Vault secrets), ' +
    'Workflow (global logic settings), Storage (containers). ' +
    'Use "Common" type for shared settings; use the process name (e.g. "Plum005") for dedicated settings. ' +
    'Sensitive values (connection strings, passwords, API keys) must use the KVS_ prefix and ' +
    'reference Key Vault via @Microsoft.KeyVault(SecretUri=...). ' +
    'Examples: KVS_DB_ServiceBus_ConnectionString, Common_API_Sftp_Host, KVS_API_Smtp_Password.'
  );

  return parts.join(' ');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function orchestrationEffort(orch: ParsedOrchestration): EffortEstimate {
  if (orch.hasAtomicTransactions || orch.hasCompensation)    return 'very-high';
  if (orch.hasBRECalls || orch.shapes.length > 20)           return 'high';
  if (orch.hasLongRunningTransactions || orch.shapes.length > 10) return 'medium';
  if (orch.shapes.length > 5)                                return 'low';
  return 'trivial';
}

function buildOrchestrationNotes(orch: ParsedOrchestration): string {
  const notes: string[] = [];
  if (orch.hasAtomicTransactions)
    notes.push('Atomic scopes → Saga pattern redesign required');
  if (orch.hasBRECalls)
    notes.push('BRE policy calls → migrate to Azure Logic Apps Rules Engine (same BRE runtime, recommended) or Azure Functions');
  if (orch.correlationSets.length > 0)
    notes.push(`${orch.correlationSets.length} correlation set(s) → Service Bus sessions`);
  if (orch.activatingReceiveCount > 1)
    notes.push(`${orch.activatingReceiveCount} activating receives → produce multiple workflows`);
  return notes.join('; ');
}
