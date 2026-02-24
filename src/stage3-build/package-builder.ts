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
} from '../types/logicapps.js';
import type { IntegrationIntent } from '../shared/integration-intent.js';
import type { BizTalkApplication } from '../types/biztalk.js';
import type { MigrationResult } from '../types/migration.js';
import { generateWorkflow }              from './workflow-generator.js';
import { convertMap }                    from './map-converter.js';
import { generateConnectionsFromApp, generateConnectionsFromIntent } from './connection-generator.js';
import { generateArmTemplate, generateLocalSettings } from './infrastructure-generator.js';
import { generateTestSpec, generateMsTestScaffold }  from './test-spec-generator.js';

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
  for (const orch of app.orchestrations) {
    const orchIntent = buildOrchestrationIntent(intent, orch.name);
    const wf = generateWorkflow(orchIntent, {
      workflowName: orch.name,
      kind:         'Stateful',
      wrapInScope:  options.wrapInScope ?? true,
    });
    workflows.push({ name: orch.name, workflow: wf });
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
  const { connections, appSettings } = generateConnectionsFromApp(app);

  // ── 4. Generate host.json ─────────────────────────────────────────────────
  const host: HostJson = buildHostJson(app);

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
  const localSettings = generateLocalSettings(appSettings);

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

  const summary: BuildSummary = {
    workflowCount:     workflows.length,
    mapCount:          Object.keys(xsltMaps).length + Object.keys(lmlMaps).length,
    functionStubCount: Object.keys(functionStubs).length,
    connectionCount:
      Object.keys(connections.serviceProviderConnections).length +
      Object.keys(connections.managedApiConnections).length,
    testCaseCount:     totalTestCases,
    warnings:          warnings.length,
  };

  return { project, armTemplate, armParameters, localSettings, testSpecs, warnings, summary };
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

  return { project, armTemplate, armParameters, localSettings, testSpecs, warnings, summary };
}

// ─── Host.json Builder ────────────────────────────────────────────────────────

function buildHostJson(app: BizTalkApplication): HostJson {
  const retentionDays = app.complexityClassification === 'simple' ? '30' : '90';

  return {
    version:         '2.0',
    extensionBundle: {
      id:      'Microsoft.Azure.Functions.ExtensionBundle.Workflows',
      version: '[1.*, 2.0.0)',
    },
    extensions: {
      workflow: {
        settings: {
          'Runtime.FlowRetentionDays':
            '[[[concat(\'{\', string(parameters(\'retentionDays\')), \'}\')]]]',
          'Runtime.Backend.FlowRunRetentionInDays': retentionDays,
        },
      },
    },
    logging: {
      applicationInsights: {
        samplingSettings: { isEnabled: true },
      },
    },
  };
}

function buildDefaultHostJson(): HostJson {
  return {
    version:         '2.0',
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
 * Each orchestration gets its own workflow.json, so we need per-orch intents.
 */
function buildOrchestrationIntent(
  appIntent: IntegrationIntent,
  orchName: string
): IntegrationIntent {
  // For now, return the app-level intent with the orchestration name noted.
  // In Stage G2 (Greenfield Design) or via more detailed orchestration analysis,
  // this can be refined to produce orchestration-specific step sets.
  return {
    ...appIntent,
    metadata: {
      ...appIntent.metadata,
      sourceOrchestrationName: orchName,
    },
  };
}


function sanitizeAppName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
