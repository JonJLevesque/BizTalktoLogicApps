/**
 * Package Builder — Stage 3 (Build)
 *
 * Assembles all generated artifacts into a complete, zip-deployable
 * Logic Apps Standard project structure:
 *
 *   {appName}/
 *     host.json
 *     connections.json
 *     local.settings.json          (local dev, gitignored in real projects)
 *     {WorkflowName}/
 *       workflow.json
 *     Maps/
 *       {MapName}.xslt             (or .lml for Data Mapper maps)
 *     AzureFunctions/
 *       {FunctionName}/
 *         run.csx                  (function stub for scripting/database functoids)
 *     arm-template.json            (ARM deployment template)
 *     arm-parameters.json          (ARM parameters file)
 *     tests/
 *       {WorkflowName}.tests.json  (test specs)
 *       {WorkflowName}Tests.cs     (MSTest scaffold)
 *
 * The package output is a LogicAppsProject which can then be:
 *   - Written to disk by the CLI
 *   - Serialized to JSON by the MCP server
 *   - Deployed directly via ARM template deployment
 */

import type {
  LogicAppsProject,
  WorkflowJson,
  HostJson,
  ResponseAction,
  RunAfterMap,
  WdlAction,
} from '../types/logicapps.js';
import type { IntegrationIntent, IntegrationStep } from '../shared/integration-intent.js';
import { createIntegrationIntent } from '../shared/integration-intent.js';
import type { BizTalkApplication, ParsedPipeline, BtpComponent } from '../types/biztalk.js';
import type { MigrationResult } from '../types/migration.js';
import { generateWorkflow }              from './workflow-generator.js';
import { convertMap }                    from './map-converter.js';
import { generateConnectionsFromApp, generateConnectionsFromIntent } from './connection-generator.js';
import { generateArmTemplate, generateLocalSettings } from './infrastructure-generator.js';
import { generateTestSpec, generateMsTestScaffold }  from './test-spec-generator.js';
import { isComplexCSharpCall, extractMethodCallInfo } from './csharp-translator.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface BuildOptions {
  /** Base name for the Logic Apps Standard app */
  appName?: string;
  /** Whether to wrap workflows in a top-level error-handling Scope */
  wrapInScope?: boolean;
  /** Whether to include MSTest C# scaffolds in the package */
  includeTests?: boolean;
  /** Whether to include ARM infrastructure template */
  includeInfrastructure?: boolean;
}

export interface BuildResult {
  project:         LogicAppsProject;
  armTemplate:     Record<string, unknown>;
  armParameters:   Record<string, unknown>;
  localSettings:   Record<string, unknown>;
  testSpecs:       Record<string, string>;  // filename → content (JSON or .cs)
  warnings:        string[];
  /** Absolute paths to source XSD schema files that should be copied to output Artifacts/Schemas/ */
  schemaFiles:     string[];
  /** Local code function .cs stubs: filename → content */
  localCodeFunctions: Record<string, string>;
  /** Summary of what was generated */
  summary:         BuildSummary;
}

export interface BuildSummary {
  workflowCount:     number;
  mapCount:          number;
  functionStubCount: number;
  connectionCount:   number;
  testCaseCount:     number;
  warnings:          number;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Builds a complete Logic Apps Standard package from a MigrationResult.
 * This is the primary Stage 3 function — it ties together all sub-generators.
 */
export function buildPackage(
  migrationResult: MigrationResult,
  options: BuildOptions = {}
): BuildResult {
  const { biztalkApplication: app, integrationIntent: intent, migrationPlan: plan } = migrationResult;
  const appName = options.appName ?? sanitizeAppName(app.name);
  const warnings: string[] = [];

  // ── 1. Generate workflows (one per orchestration) ─────────────────────────
  const workflows: LogicAppsProject['workflows'] = [];
  const seenOrchNames = new Set<string>();
  for (const orch of app.orchestrations) {
    if (seenOrchNames.has(orch.name)) {
      warnings.push(`Skipped duplicate orchestration "${orch.name}" (likely a backup copy — remove the duplicate .odx file)`);
      continue;
    }
    seenOrchNames.add(orch.name);
    const orchIntent = buildOrchestrationIntent(intent, orch.name);
    // FIX-10: Sanitize workflow names — must start with letter, no consecutive separators
    const workflowName = sanitizeWorkflowName(orch.name);
    const wf = generateWorkflow(orchIntent, {
      workflowName,
      kind:         'Stateful',
      wrapInScope:  options.wrapInScope ?? true,
    });
    workflows.push({ name: workflowName, workflow: wf });
  }

  // ── 1b. Generate pipeline workflows (one per .btp pipeline file) ────────────
  // Sandro's architecture: each pipeline is a reusable standalone workflow with a
  // Request trigger. Orchestration workflows call pipeline workflows when needed.
  const pipelineWorkflowNames: string[] = [];
  const seenPipelineNames = new Set<string>();
  for (const pipeline of app.pipelines) {
    if (seenPipelineNames.has(pipeline.name)) {
      warnings.push(`Skipped duplicate pipeline "${pipeline.name}"`);
      continue;
    }
    seenPipelineNames.add(pipeline.name);
    const pipelineIntent = buildPipelineIntent(pipeline);
    const workflowName = sanitizeWorkflowName(`Pipeline_${pipeline.name}`);
    const wf = generateWorkflow(pipelineIntent, {
      workflowName,
      kind:        'Stateful',
      wrapInScope: options.wrapInScope ?? true,
    });
    // Pipeline workflows are always called as children — ensure Response action
    ensureResponseAction(wf, warnings);
    workflows.push({ name: workflowName, workflow: wf });
    pipelineWorkflowNames.push(workflowName);
  }

  // If no orchestrations, generate a single workflow from the intent
  if (workflows.length === 0) {
    const wf = generateWorkflow(intent, {
      workflowName: appName,
      kind:         'Stateful',
      wrapInScope:  options.wrapInScope ?? true,
    });
    workflows.push({ name: appName, workflow: wf });
  }

  // ── 1b. FIX-02: Ensure child workflows have a Response action ─────────────
  // A workflow invoked via the Workflow action (invoke-child pattern) MUST contain
  // a Response action — otherwise the parent fails at runtime:
  // "To wait on nested workflow '{name}', it must contain a response action."
  const childWorkflowNames = collectChildWorkflowNames(intent);
  for (const wf of workflows) {
    if (childWorkflowNames.has(wf.name) || childWorkflowNames.has(sanitizeWorkflowName(wf.name))) {
      ensureResponseAction(wf.workflow, warnings);
    }
  }

  // ── 2. Convert maps ───────────────────────────────────────────────────────
  const xsltMaps: Record<string, string> = {};
  const lmlMaps:  Record<string, string> = {};
  const functionStubs: Record<string, string> = {};

  for (const map of app.maps) {
    const converted = convertMap(map);
    warnings.push(...converted.warnings);

    switch (converted.format) {
      case 'xslt':
        xsltMaps[`${converted.name}.xslt`] = converted.content;
        break;
      case 'lml':
        lmlMaps[`${converted.name}.lml`] = converted.content;
        break;
      case 'function-stub':
        functionStubs[`${converted.name}.csx`] = converted.content;
        break;
    }
  }

  // ── 3. Generate connections ───────────────────────────────────────────────
  // Merge connections from two sources:
  //   (a) Adapter types discovered in BizTalk binding files
  //   (b) Connector references in the enriched IntegrationIntent steps
  // This ensures adapters not fully resolved by the binding analyzer are still captured.
  const appConn    = generateConnectionsFromApp(app);
  const intentConn = generateConnectionsFromIntent(intent);
  const connections = {
    serviceProviderConnections: {
      ...appConn.connections.serviceProviderConnections,
      ...intentConn.connections.serviceProviderConnections,
    },
    managedApiConnections: {
      ...appConn.connections.managedApiConnections,
      ...intentConn.connections.managedApiConnections,
    },
  };
  const appSettings = { ...appConn.appSettings, ...intentConn.appSettings };

  // ── 4. Generate host.json ─────────────────────────────────────────────────
  const host: HostJson = buildDefaultHostJson();

  // ── 5. Build LogicAppsProject ─────────────────────────────────────────────
  const project: LogicAppsProject = {
    appName,
    workflows,
    connections,
    host,
    appSettings,
    xsltMaps,
    lmlMaps,
  };

  // ── 6. Generate ARM template ──────────────────────────────────────────────
  const armTemplate = options.includeInfrastructure !== false
    ? generateArmTemplate(plan.architectureRecommendation) as unknown as Record<string, unknown>
    : {} as Record<string, unknown>;

  const armParameters = buildArmParameters(appName, plan.architectureRecommendation.integrationAccountTier);

  // ── 7. Generate local.settings.json ──────────────────────────────────────
  // Defer until after step 10 so we know whether C# functions exist.
  // (moved below localCodeFunctions computation — see step 10a)

  // ── 8. Generate tests ─────────────────────────────────────────────────────
  const testSpecs: Record<string, string> = {};
  let totalTestCases = 0;

  if (options.includeTests !== false) {
    for (const wf of workflows) {
      const orchIntent = buildOrchestrationIntent(intent, wf.name);
      const spec       = generateTestSpec(orchIntent, wf.name);
      totalTestCases  += spec.testCases.length;

      testSpecs[`${wf.name}.tests.json`]  = JSON.stringify(spec, null, 2);
      testSpecs[`${wf.name}Tests.cs`]     = generateMsTestScaffold(spec, appName);
    }
  }

  // ── 9. Add function stub warnings ─────────────────────────────────────────
  if (Object.keys(functionStubs).length > 0) {
    warnings.push(
      `${Object.keys(functionStubs).length} Azure Function stub(s) generated. ` +
      `Implement the transformation logic before deploying: ${Object.keys(functionStubs).join(', ')}.`
    );
  }

  // ── 10. Generate local code function stubs ────────────────────────────────
  const localCodeFunctions = collectLocalCodeFunctionStubs(intent, appName);
  if (Object.keys(localCodeFunctions).length > 0) {
    warnings.push(
      `${Object.keys(localCodeFunctions).length} local code function stub(s) generated. ` +
      `Implement custom logic in the .cs files before deploying.`
    );
  }

  // ── 10a. Generate local.settings.json (now that we know if C# functions exist) ──
  const hasLocalCodeFunctions = Object.keys(localCodeFunctions).some(k => k.endsWith('.cs'));
  const localSettings = generateLocalSettings(appSettings, hasLocalCodeFunctions);

  const summary: BuildSummary = {
    workflowCount:     workflows.length,
    mapCount:          Object.keys(xsltMaps).length + Object.keys(lmlMaps).length,
    functionStubCount: Object.keys(functionStubs).length + Object.keys(localCodeFunctions).length,
    connectionCount:
      Object.keys(connections.serviceProviderConnections).length +
      Object.keys(connections.managedApiConnections).length,
    testCaseCount:     totalTestCases,
    warnings:          warnings.length,
  };

  return { project, armTemplate, armParameters, localSettings, testSpecs, warnings, schemaFiles: [], localCodeFunctions, summary };
}

/**
 * Builds a package from just an IntegrationIntent (Greenfield NLP mode).
 * No BizTalk application artifacts — generates a single workflow.
 */
export function buildPackageFromIntent(
  intent: IntegrationIntent,
  options: BuildOptions = {}
): BuildResult {
  const appName = options.appName ?? 'logicapps-app';
  const warnings: string[] = [];

  const wf = generateWorkflow(intent, {
    workflowName: appName,
    kind:         'Stateful',
    wrapInScope:  options.wrapInScope ?? true,
  });

  const workflows: LogicAppsProject['workflows'] = [{ name: appName, workflow: wf }];

  // No maps in NLP greenfield mode — maps require schema definitions
  const xsltMaps: Record<string, string> = {};
  const lmlMaps:  Record<string, string> = {};

  const { connections, appSettings } = generateConnectionsFromIntent(intent);
  const host = buildDefaultHostJson();

  const project: LogicAppsProject = {
    appName,
    workflows,
    connections,
    host,
    appSettings,
    xsltMaps,
    lmlMaps,
  };

  const testSpecs: Record<string, string> = {};
  let totalTestCases = 0;

  if (options.includeTests !== false) {
    const spec     = generateTestSpec(intent, appName);
    totalTestCases = spec.testCases.length;
    testSpecs[`${appName}.tests.json`] = JSON.stringify(spec, null, 2);
    testSpecs[`${appName}Tests.cs`]    = generateMsTestScaffold(spec, appName);
  }

  // Minimal ARM template for greenfield
  const armTemplate    = {} as Record<string, unknown>;
  const armParameters  = buildArmParameters(appName);
  const localSettings  = generateLocalSettings(appSettings);

  const summary: BuildSummary = {
    workflowCount:     1,
    mapCount:          0,
    functionStubCount: 0,
    connectionCount:   Object.keys(connections.serviceProviderConnections).length +
                       Object.keys(connections.managedApiConnections).length,
    testCaseCount:     totalTestCases,
    warnings:          0,
  };

  return { project, armTemplate, armParameters, localSettings, testSpecs, warnings, schemaFiles: [], localCodeFunctions: {}, summary };
}

// ─── Host.json Builder ────────────────────────────────────────────────────────

function buildDefaultHostJson(): HostJson {
  return {
    version: '2.0',
    logging: {
      applicationInsights: {
        samplingSettings: {
          isEnabled:     true,
          excludedTypes: 'Request',
        },
      },
    },
    extensionBundle: {
      id:      'Microsoft.Azure.Functions.ExtensionBundle.Workflows',
      version: '[1.*, 2.0.0)',
    },
  };
}

// ─── ARM Parameters Builder ───────────────────────────────────────────────────

function buildArmParameters(
  appName: string,
  integrationAccountTier?: string
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    $schema:        'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
    contentVersion: '1.0.0.0',
    parameters: {
      appName:            { value: appName },
      appServicePlanSku:  { value: 'WS1' },
      tags: {
        value: {
          'migrated-from': 'biztalk',
          environment:     'production',
          'migration-tool': 'biztalk-to-logicapps',
        },
      },
    },
  };

  if (integrationAccountTier) {
    (params['parameters'] as Record<string, unknown>)['integrationAccountSku'] =
      { value: capitalizeFirst(integrationAccountTier) };
  }

  return params;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Builds an orchestration-specific intent from the application-level intent.
 * Filters steps to only those tagged with this orchestration's name.
 * Removes cross-orchestration runAfter references that would be dangling.
 */
function buildOrchestrationIntent(
  appIntent: IntegrationIntent,
  orchName: string
): IntegrationIntent {
  // Filter to steps belonging to this orchestration (tagged by intent-constructor)
  const orchSteps = appIntent.steps.filter(
    s => !s.sourceOrchestration || s.sourceOrchestration === orchName
  );

  // Build a set of valid step IDs within this orchestration
  const validIds = new Set(orchSteps.map(s => s.id));

  // Remove runAfter references to steps from other orchestrations
  const fixedSteps = orchSteps.map(s => ({
    ...s,
    runAfter: s.runAfter.filter(id => validIds.has(id)),
  }));

  return {
    ...appIntent,
    steps: fixedSteps,
    metadata: {
      ...appIntent.metadata,
      sourceOrchestrationName: orchName,
    },
  };
}


// ─── Pipeline Workflow Builder ────────────────────────────────────────────────

/**
 * Maps a BizTalk pipeline component short name to its Logic Apps step description.
 * Used in mapPipelineComponentToAction().
 */
const COMPONENT_ACTION_MAP: Record<string, { type: IntegrationStep['type']; actionType: string; config: Record<string, unknown>; needsFunction: boolean }> = {
  // Receive pipeline components
  'XmlDasmComp':          { type: 'set-variable', actionType: 'Compose', config: { value: '@xml(triggerBody())' }, needsFunction: false },
  'FlatFileDasmComp':     { type: 'invoke-function', actionType: 'InvokeFunction', config: { functionName: 'FlatFileDecode', expression: 'Decode flat file message to XML' }, needsFunction: true },
  'FFDasmComp':           { type: 'invoke-function', actionType: 'InvokeFunction', config: { functionName: 'FlatFileDecode', expression: 'Decode flat file message to XML' }, needsFunction: true },
  'XmlValidator':         { type: 'set-variable', actionType: 'Compose', config: { value: '@triggerBody()', note: 'TODO: Add XML validation via Integration Account schema' }, needsFunction: false },
  'JsonDecoder':          { type: 'set-variable', actionType: 'Compose', config: { value: '@json(string(triggerBody()))' }, needsFunction: false },
  'PartyRes':             { type: 'set-variable', actionType: 'Compose', config: { value: '@triggerBody()', note: 'Party resolution: replace with Azure Table lookup' }, needsFunction: false },
  // Send pipeline components
  'XmlAsmComp':           { type: 'set-variable', actionType: 'Compose', config: { value: '@string(triggerBody())' }, needsFunction: false },
  'FlatFileAsmComp':      { type: 'invoke-function', actionType: 'InvokeFunction', config: { functionName: 'FlatFileEncode', expression: 'Encode XML to flat file format' }, needsFunction: true },
  'FFAsmComp':            { type: 'invoke-function', actionType: 'InvokeFunction', config: { functionName: 'FlatFileEncode', expression: 'Encode XML to flat file format' }, needsFunction: true },
  'JsonEncoder':          { type: 'set-variable', actionType: 'Compose', config: { value: '@json(string(triggerBody()))' }, needsFunction: false },
  // EDI / AS2 — require Integration Account
  'EDIDisassemblerComp':  { type: 'invoke-function', actionType: 'InvokeFunction', config: { functionName: 'EdiDecode', expression: 'EDI decode requires Integration Account connector' }, needsFunction: true },
  'EDIAssemblerComp':     { type: 'invoke-function', actionType: 'InvokeFunction', config: { functionName: 'EdiEncode', expression: 'EDI encode requires Integration Account connector' }, needsFunction: true },
  'BatchMarkerPipelineComponent': { type: 'set-variable', actionType: 'Compose', config: { value: '@triggerBody()', note: 'Batch marker: handle via Service Bus batching pattern' }, needsFunction: false },
  'AS2Decoder':           { type: 'invoke-function', actionType: 'InvokeFunction', config: { functionName: 'As2Decode', expression: 'AS2 decode requires Integration Account connector' }, needsFunction: true },
  'AS2Encoder':           { type: 'invoke-function', actionType: 'InvokeFunction', config: { functionName: 'As2Encode', expression: 'AS2 encode requires Integration Account connector' }, needsFunction: true },
  'MIME_SMIME_Decoder':   { type: 'invoke-function', actionType: 'InvokeFunction', config: { functionName: 'MimeDecode', expression: 'MIME/S-MIME decode requires custom Azure Function' }, needsFunction: true },
  'MIME_SMIME_Encoder':   { type: 'invoke-function', actionType: 'InvokeFunction', config: { functionName: 'MimeEncode', expression: 'MIME/S-MIME encode requires custom Azure Function' }, needsFunction: true },
};

/**
 * Maps a known BizTalk pipeline component to an IntegrationStep action descriptor.
 */
function mapPipelineComponentToAction(
  component: BtpComponent,
  stepId: string
): IntegrationStep {
  const mapped = COMPONENT_ACTION_MAP[component.componentType];
  if (mapped) {
    return {
      id: stepId,
      type: mapped.type,
      description: `${component.stage}: ${component.componentType}`,
      actionType: mapped.actionType,
      config: { ...mapped.config },
      runAfter: [],
    };
  }

  // Unknown component → treat as custom requiring InvokeFunction
  return {
    id: stepId,
    type: 'invoke-function',
    description: `${component.stage}: ${component.fullTypeName} (unknown component)`,
    actionType: 'InvokeFunction',
    config: { functionName: component.componentType || 'CustomPipelineComponent', expression: component.fullTypeName },
    runAfter: [],
  };
}

/**
 * Detects the primary data format handled by a pipeline based on its components.
 */
function detectFormatFromComponents(pipeline: ParsedPipeline): 'xml' | 'json' | 'flat-file' | 'edi-x12' | 'as2' | 'unknown' {
  for (const comp of pipeline.components) {
    const lower = comp.componentType.toLowerCase();
    if (lower.includes('flatfile') || lower.includes('ff')) return 'flat-file';
    if (lower.includes('edi') || lower.includes('x12') || lower.includes('edifact')) return 'edi-x12';
    if (lower.includes('as2')) return 'as2';
    if (lower.includes('json')) return 'json';
    if (lower.includes('xml')) return 'xml';
  }
  return 'xml'; // default
}

/**
 * Builds an IntegrationIntent for a pipeline workflow.
 * Each .btp pipeline becomes a reusable standalone Logic Apps workflow with a
 * Request trigger so it can be called from any orchestration workflow.
 *
 * Sandro's principle: pipelines are shared — putting them into separate workflows
 * allows re-use across orchestrations without duplication.
 */
function buildPipelineIntent(pipeline: ParsedPipeline): IntegrationIntent {
  const steps: IntegrationStep[] = [];
  let stepIndex = 0;

  for (const component of pipeline.components) {
    stepIndex++;
    const stepId = `step_pipeline_${stepIndex}`;

    if (component.isCustom) {
      // Custom (third-party) component → generate InvokeFunction stub
      steps.push({
        id: stepId,
        type: 'invoke-function',
        description: `Custom pipeline component: ${component.fullTypeName}`,
        actionType: 'InvokeFunction',
        config: { functionName: component.componentType || 'CustomPipelineComponent', expression: component.fullTypeName },
        runAfter: [],
      });
    } else {
      steps.push(mapPipelineComponentToAction(component, stepId));
    }
  }

  // Default/empty pipelines get a simple pass-through step
  if (steps.length === 0) {
    steps.push({
      id: 'step_passthrough',
      type: 'set-variable',
      description: 'Pass-through: forward message unchanged',
      actionType: 'Compose',
      config: { value: '@triggerBody()' },
      runAfter: [],
    });
  }

  const format = detectFormatFromComponents(pipeline);

  return createIntegrationIntent('biztalk-migration', {
    trigger: {
      type: 'webhook',
      source: `Called by ${pipeline.direction === 'receive' ? 'orchestration (receive pipeline)' : 'orchestration (send pipeline)'}`,
      connector: 'request',
      config: {},
    },
    steps,
    errorHandling: { strategy: 'terminate' },
    systems: [],
    dataFormats: {
      input: pipeline.direction === 'receive' ? format : 'xml',
      output: pipeline.direction === 'send'    ? format : 'xml',
    },
    patterns: [],
    metadata: {
      source: 'biztalk-migration',
      complexity: 'simple',
      estimatedActions: steps.length + 2,
      requiresIntegrationAccount: false,
      requiresOnPremGateway: false,
    },
  });
}

/**
 * Collects all `invoke-function` steps from the intent and generates
 * local code function .cs stubs for Logic Apps Standard in-process execution.
 * Returns a map of filename → C# source content.
 */
function collectLocalCodeFunctionStubs(
  intent: IntegrationIntent,
  appName: string
): Record<string, string> {
  const stubs: Record<string, string> = {};
  const namespace = appName.replace(/[^A-Za-z0-9]/g, '');

  const allSteps = flattenIntentSteps(intent.steps);
  for (const step of allSteps) {
    if (step.type === 'invoke-function') {
      const cfg = step.config as Record<string, unknown>;
      const functionName = (cfg['functionName'] as string)
        ?? step.id.replace(/^step_/, '').replace(/[^A-Za-z0-9_]/g, '_')
        ?? 'CustomFunction';
      const originalExpression = (cfg['expression'] as string) ?? '';
      const filename = `${functionName}.cs`;
      if (stubs[filename]) continue; // deduplicate
      stubs[filename] = generateLocalCodeFunctionStub(functionName, namespace, originalExpression);
      continue;
    }

    // Also generate stubs for set-variable steps that contain complex C# helper calls.
    // These are promoted to InvokeFunction actions by buildSetVariableAction() in workflow-generator.
    if (step.type === 'set-variable') {
      const cfg = step.config as Record<string, unknown>;
      const expr = (cfg['expression'] as string | undefined) ?? '';
      if (!expr || !isComplexCSharpCall(expr)) continue;
      const info = extractMethodCallInfo(expr);
      if (!info) continue;
      const functionName = info.methodName;
      const filename = `${functionName}.cs`;
      if (stubs[filename]) continue; // deduplicate
      stubs[filename] = generateLocalCodeFunctionStub(functionName, namespace, expr);
    }
  }
  return stubs;
}

function generateLocalCodeFunctionStub(
  functionName: string,
  namespace: string,
  originalExpression: string
): string {
  const exprComment = originalExpression
    ? originalExpression.split('\n').map(l => `            // ${l}`).join('\n')
    : `            // TODO: implement transformation logic`;

  return `//------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
//------------------------------------------------------------

namespace ${namespace}
{
    using System.Threading.Tasks;
    using Microsoft.Azure.Functions.Extensions.Workflows;
    using Microsoft.Azure.WebJobs;
    using Microsoft.Extensions.Logging;

    /// <summary>
    /// Local code function stub generated from BizTalk migration.
    /// Implement the body of Run() before deploying.
    /// </summary>
    public class ${functionName}
    {
        private readonly ILogger<${functionName}> logger;

        public ${functionName}(ILoggerFactory loggerFactory)
        {
            logger = loggerFactory.CreateLogger<${functionName}>();
        }

        /// <summary>
        /// Executes the logic app workflow action.
        /// </summary>
        [FunctionName("${functionName}")]
        public Task<object> Run([WorkflowActionTrigger] object requestBody)
        {
            this.logger.LogInformation("${functionName}: starting.");

            // Original BizTalk expression:
${exprComment}

            // TODO: implement transformation logic and return result
            throw new System.NotImplementedException("Implement ${functionName} logic here.");
        }
    }
}
`;
}

/** Recursively flattens all steps including branch children */
function flattenIntentSteps(steps: IntegrationIntent['steps']): IntegrationIntent['steps'] {
  const result: IntegrationIntent['steps'] = [];
  for (const step of steps) {
    result.push(step);
    if (step.branches) {
      if (step.branches.trueBranch) result.push(...flattenIntentSteps(step.branches.trueBranch));
      if (step.branches.falseBranch) result.push(...flattenIntentSteps(step.branches.falseBranch));
      if (step.branches.cases) {
        for (const c of step.branches.cases) result.push(...flattenIntentSteps(c.steps));
      }
      if (step.branches.defaultSteps) result.push(...flattenIntentSteps(step.branches.defaultSteps));
    }
  }
  return result;
}

function sanitizeAppName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

/**
 * FIX-10: Logic Apps Standard workflow name rules:
 *  - Must start with a letter (prefix "W" if starts with digit or non-letter)
 *  - Must end with a letter or number (trim trailing separators)
 *  - Cannot have consecutive "--" or "__"
 *  - Max 255 characters
 *
 * Applied to orchestration-derived workflow names.
 */
export function sanitizeWorkflowName(name: string): string {
  let result = name
    .replace(/[^a-zA-Z0-9_\-]/g, '_')   // only letters, digits, underscores, hyphens
    .replace(/-{2,}/g, '-')              // collapse consecutive hyphens
    .replace(/_{2,}/g, '_')             // collapse consecutive underscores
    .replace(/^[-_]+/, '')              // trim leading separators
    .replace(/[-_]+$/, '');             // trim trailing separators

  // Must start with a letter
  if (result && !/^[a-zA-Z]/.test(result)) {
    result = 'W' + result;
  }

  return (result || 'Workflow').substring(0, 255);
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ─── FIX-02: Child Workflow Response Action ───────────────────────────────────

/**
 * Collects the names of all workflows that are invoked as child workflows
 * (i.e., targets of invoke-child / Workflow action steps in any intent step tree).
 */
function collectChildWorkflowNames(intent: IntegrationIntent): Set<string> {
  const names = new Set<string>();
  for (const step of collectAllSteps(intent.steps)) {
    if (step.type === 'invoke-child') {
      const cfg = step.config as Record<string, unknown>;
      const name = cfg['workflowName'] as string | undefined;
      if (name) names.add(name);
    }
  }
  return names;
}

/** Recursively collects all steps from the intent step tree (including branch steps). */
function collectAllSteps(steps: IntegrationIntent['steps']): IntegrationIntent['steps'] {
  const result: IntegrationIntent['steps'] = [];
  for (const step of steps) {
    result.push(step);
    if (step.branches) {
      if (step.branches.trueBranch)   result.push(...collectAllSteps(step.branches.trueBranch));
      if (step.branches.falseBranch)  result.push(...collectAllSteps(step.branches.falseBranch));
      if (step.branches.cases) {
        for (const c of step.branches.cases) result.push(...collectAllSteps(c.steps));
      }
    }
  }
  return result;
}

/**
 * Ensures a workflow.json contains a Response action at root level.
 * Required for all child workflows invoked via the Workflow action.
 * If missing, appends a Response_200 action after the last root-level action.
 */
function ensureResponseAction(wf: WorkflowJson, warnings: string[]): void {
  const rootActions = wf.definition.actions as Record<string, WdlAction>;

  // Check if a Response action already exists
  const hasResponse = Object.values(rootActions).some(a => a.type === 'Response');
  if (hasResponse) return;

  // If wrapped in Scope_Main, check inside the Scope too
  const scopeMain = rootActions['Scope_Main'] as ({ type: string; actions?: Record<string, WdlAction> } | undefined);
  if (scopeMain?.type === 'Scope' && scopeMain.actions) {
    const hasScopeResponse = Object.values(scopeMain.actions).some(a => a.type === 'Response');
    if (hasScopeResponse) return;
  }

  // Find the last root-level action to set as predecessor for the Response
  const rootActionNames = Object.keys(rootActions);
  const lastActionName  = rootActionNames[rootActionNames.length - 1];
  const runAfter: RunAfterMap = lastActionName ? { [lastActionName]: ['SUCCEEDED'] } : {};

  // Append Response_200 action
  const responseAction: ResponseAction = {
    type:     'Response',
    kind:     'Http',
    inputs:   { statusCode: 200, body: '@outputs()' },
    runAfter,
  };
  rootActions['Response_200'] = responseAction;

  warnings.push(
    'Response_200 action added to child workflow — required for Workflow action invocation. ' +
    'Update the response body if the parent expects specific output.'
  );
}
