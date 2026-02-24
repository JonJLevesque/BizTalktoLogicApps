/**
 * MCP Tool Handler — Dispatches tool calls to the appropriate engine functions
 *
 * Each tool call receives validated input (already parsed against the Zod schema)
 * and returns a ToolResult with either content or an isError flag.
 *
 * Handler pattern:
 *   1. Parse JSON inputs (applicationJson, intentJson, etc.)
 *   2. Call the appropriate engine function
 *   3. Return the result as JSON string content
 *   4. Catch and return errors gracefully
 *
 * License gating:
 *   Standard and Premium tools check the feature gate before executing.
 *   If the feature is not available, a descriptive error is returned.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { analyzeOrchestrationXml }              from '../../stage1-understand/orchestration-analyzer.js';
import { analyzeMapXml }                        from '../../stage1-understand/map-analyzer.js';
import { analyzePipelineXml }                   from '../../stage1-understand/pipeline-analyzer.js';
import { analyzeBindingsXml }                   from '../../stage1-understand/binding-analyzer.js';
import { detectPatterns }                       from '../../stage1-understand/pattern-detector.js';
import { scoreApplication }                     from '../../stage1-understand/complexity-scorer.js';
import { analyzeGaps }                          from '../../stage2-document/gap-analyzer.js';
import { recommendArchitecture }                from '../../stage2-document/architecture-recommender.js';
import { generateMigrationSpec, generateMigrationResult } from '../../stage2-document/migration-spec-generator.js';
import { generateWorkflow }                     from '../../stage3-build/workflow-generator.js';
import { convertMap }                           from '../../stage3-build/map-converter.js';
import { generateConnectionsFromApp, generateConnectionsFromIntent } from '../../stage3-build/connection-generator.js';
import { generateArmTemplate, generateLocalSettings } from '../../stage3-build/infrastructure-generator.js';
import { generateTestSpec, generateMsTestScaffold } from '../../stage3-build/test-spec-generator.js';
import { buildPackage, buildPackageFromIntent } from '../../stage3-build/package-builder.js';
import { interpretNlp }                         from '../../greenfield/nlp-interpreter.js';
import { inferSchema }                          from '../../greenfield/schema-inferrer.js';
import { recommendConnectors }                  from '../../greenfield/connector-recommender.js';
import { generateDesign }                       from '../../greenfield/design-generator.js';
import { listTemplates, getTemplate, cloneTemplateIntent } from '../../greenfield/template-library.js';
import { refineIntent }                         from '../../greenfield/refinement-engine.js';
import { isFeatureAvailable }                   from '../../licensing/index.js';
import type { BizTalkApplication }              from '../../types/biztalk.js';
import type { IntegrationIntent }               from '../../shared/integration-intent.js';

// ─── Handler Registry ─────────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

export const TOOL_HANDLERS: Record<string, ToolHandler> = {

  // ── Stage 1: Understand ────────────────────────────────────────────────────

  analyze_orchestration: async (args) => {
    const result = analyzeOrchestrationXml(String(args['xmlContent']));
    return ok(result);
  },

  analyze_map: async (args) => {
    const result = analyzeMapXml(String(args['xmlContent']));
    return ok(result);
  },

  analyze_pipeline: async (args) => {
    const result = analyzePipelineXml(String(args['xmlContent']));
    return ok(result);
  },

  analyze_bindings: async (args) => {
    const result = analyzeBindingsXml(String(args['xmlContent']));
    return ok(result);
  },

  analyze_biztalk_application: async (args) => {
    const orchXmls    = (args['orchestrationXmls'] as string[]) ?? [];
    const mapXmls     = (args['mapXmls'] as string[] | undefined) ?? [];
    const pipelineXmls = (args['pipelineXmls'] as string[] | undefined) ?? [];
    const bindingXml   = args['bindingXml'] as string | undefined;
    const appName      = String(args['applicationName']);

    const orchestrations = orchXmls.map(xml => analyzeOrchestrationXml(xml));
    const maps           = mapXmls.map(xml => analyzeMapXml(xml));
    const pipelines      = pipelineXmls.map(xml => analyzePipelineXml(xml));
    const bindingFiles   = bindingXml ? [analyzeBindingsXml(bindingXml)] : [];

    // Detect patterns and score complexity
    const app: BizTalkApplication = {
      name:                    appName,
      biztalkVersion:          'unknown',
      orchestrations,
      maps,
      pipelines,
      schemas:                 [],
      bindingFiles,
      complexityScore:         0,
      complexityClassification: 'moderate',
    };

    const complexity = scoreApplication(app);
    app.complexityScore          = complexity.totalScore;
    app.complexityClassification = complexity.classification;

    return ok({ ...app, complexityReport: complexity });
  },

  detect_patterns: async (args) => {
    const app = parseJson<BizTalkApplication>(args['applicationJson'] as string);
    const patterns = detectPatterns(app);
    return ok(patterns);
  },

  assess_complexity: async (args) => {
    const app = parseJson<BizTalkApplication>(args['applicationJson'] as string);
    const report = scoreApplication(app);
    return ok(report);
  },

  // ── Stage 2: Document ──────────────────────────────────────────────────────

  generate_migration_spec: async (args) => {
    const app    = parseJson<BizTalkApplication>(args['applicationJson'] as string);
    const intent = parseJson<IntegrationIntent>(args['intentJson'] as string);
    const plan   = generateMigrationSpec(app, intent);
    return ok(plan);
  },

  generate_gap_analysis: async (args) => {
    const app  = parseJson<BizTalkApplication>(args['applicationJson'] as string);
    const gaps = analyzeGaps(app);
    return ok(gaps);
  },

  generate_architecture: async (args) => {
    const app      = parseJson<BizTalkApplication>(args['applicationJson'] as string);
    const gaps     = parseJson<ReturnType<typeof analyzeGaps>>(args['gapAnalysisJson'] as string);
    const patterns = (args['detectedPatterns'] as import('../../shared/integration-intent.js').IntegrationPattern[] | undefined) ?? [];
    const arch     = recommendArchitecture(app, gaps, patterns);
    return ok(arch);
  },

  // ── Stage 3: Build ─────────────────────────────────────────────────────────

  generate_workflow: async (args) => {
    if (!isFeatureAvailable('build')) return featureGated('build');
    const intent = parseJson<IntegrationIntent>(args['intentJson'] as string);
    const wf = generateWorkflow(intent, {
      ...(args['workflowName'] ? { workflowName: args['workflowName'] as string } : {}),
      kind:        (args['kind'] as 'Stateful' | 'Stateless') ?? 'Stateful',
      wrapInScope: (args['wrapInScope'] as boolean) ?? true,
    });
    return ok(wf);
  },

  convert_map: async (args) => {
    if (!isFeatureAvailable('build')) return featureGated('build');
    const map    = parseJson<Parameters<typeof convertMap>[0]>(args['mapJson'] as string);
    const result = convertMap(map);
    return ok(result);
  },

  generate_connections: async (args) => {
    if (!isFeatureAvailable('build')) return featureGated('build');
    if (args['applicationJson']) {
      const app    = parseJson<BizTalkApplication>(args['applicationJson'] as string);
      return ok(generateConnectionsFromApp(app));
    }
    if (args['intentJson']) {
      const intent = parseJson<IntegrationIntent>(args['intentJson'] as string);
      return ok(generateConnectionsFromIntent(intent));
    }
    return err('Provide either applicationJson or intentJson');
  },

  generate_infrastructure: async (args) => {
    if (!isFeatureAvailable('build')) return featureGated('build');
    const arch        = parseJson<Parameters<typeof generateArmTemplate>[0]>(args['architectureJson'] as string);
    const appSettings = (args['appSettings'] as Record<string, string>) ?? {};
    const armTemplate = generateArmTemplate(arch);
    const localSettings = generateLocalSettings(appSettings);
    return ok({ armTemplate, localSettings });
  },

  generate_tests: async (args) => {
    if (!isFeatureAvailable('build')) return featureGated('build');
    const intent       = parseJson<IntegrationIntent>(args['intentJson'] as string);
    const workflowName = String(args['workflowName']);
    const logicAppName = (args['logicAppName'] as string) ?? workflowName;
    const spec         = generateTestSpec(intent, workflowName);
    const msTest       = generateMsTestScaffold(spec, logicAppName);
    return ok({ spec, msTestScaffold: msTest });
  },

  build_package: async (args) => {
    if (!isFeatureAvailable('build')) return featureGated('build');

    const options = {
      ...(args['appName'] ? { appName: args['appName'] as string } : {}),
      includeTests:         (args['includeTests'] as boolean) ?? true,
      includeInfrastructure: (args['includeInfrastructure'] as boolean) ?? true,
      wrapInScope:          (args['wrapInScope'] as boolean) ?? true,
    };

    if (args['migrationResultJson']) {
      const mr = parseJson<Parameters<typeof buildPackage>[0]>(args['migrationResultJson'] as string);
      return ok(buildPackage(mr, options));
    }
    if (args['intentJson']) {
      const intent = parseJson<IntegrationIntent>(args['intentJson'] as string);
      return ok(buildPackageFromIntent(intent, options));
    }
    return err('Provide either migrationResultJson or intentJson');
  },

  // ── Greenfield NLP (Premium) ───────────────────────────────────────────────

  interpret_nlp: async (args) => {
    if (!isFeatureAvailable('greenfield')) return featureGated('greenfield');
    const result = interpretNlp(String(args['description']));
    return ok(result);
  },

  generate_design: async (args) => {
    if (!isFeatureAvailable('greenfield')) return featureGated('greenfield');
    const intent = parseJson<IntegrationIntent>(args['intentJson'] as string);
    const design = generateDesign(intent);
    return ok(design);
  },

  infer_schema: async (args) => {
    if (!isFeatureAvailable('greenfield')) return featureGated('greenfield');
    const schema = inferSchema(
      String(args['description']),
      args['schemaName'] as string | undefined
    );
    return ok(schema);
  },

  recommend_connectors: async (args) => {
    if (!isFeatureAvailable('greenfield')) return featureGated('greenfield');
    const systems = parseJson<Parameters<typeof recommendConnectors>[0]>(args['systemsJson'] as string);
    return ok(recommendConnectors(systems));
  },

  list_templates: async (args) => {
    if (!isFeatureAvailable('greenfield')) return featureGated('greenfield');
    const templates = listTemplates({
      ...(args['category'] ? { category: args['category'] as import('../../greenfield/template-library.js').TemplateCategory } : {}),
      ...(args['search'] ? { search: args['search'] as string } : {}),
    });
    return ok(templates);
  },

  apply_template: async (args) => {
    if (!isFeatureAvailable('greenfield')) return featureGated('greenfield');
    const templateId = String(args['templateId']);
    const template   = getTemplate(templateId);
    if (!template) return err(`Template '${templateId}' not found. Use list_templates to browse available templates.`);

    let intent = cloneTemplateIntent(templateId)!;

    // Apply NLP customizations if provided
    if (args['customizations']) {
      const { refineIntent: refine } = await import('../../greenfield/refinement-engine.js');
      const refinement = refine(intent, String(args['customizations']));
      intent = refinement.intent;
      return ok({ intent, template: { id: template.id, name: template.name }, appliedOps: refinement.appliedOps });
    }

    return ok({ intent, template: { id: template.id, name: template.name } });
  },

  refine_workflow: async (args) => {
    if (!isFeatureAvailable('greenfield')) return featureGated('greenfield');
    const intent      = parseJson<IntegrationIntent>(args['intentJson'] as string);
    const instruction = String(args['instruction']);
    const result      = refineIntent(intent, instruction);
    return ok(result);
  },

  create_workflow_from_description: async (args) => {
    if (!isFeatureAvailable('greenfield')) return featureGated('greenfield');

    const description     = String(args['description']);
    const appName         = args['appName'] as string | undefined;
    const skipDesignReview = (args['skipDesignReview'] as boolean) ?? false;

    // Step 1: Interpret NLP
    const nlpResult = interpretNlp(description);
    const intent    = nlpResult.intent;

    if (!skipDesignReview) {
      // Step 2: Return design for user review — do NOT build yet
      const design = generateDesign(intent);
      return ok({
        stage:          'design-review',
        intent,
        design,
        ambiguities:    nlpResult.ambiguities,
        confidence:     nlpResult.confidence,
        message:
          design.readyToBuild
            ? 'Design is ready. Review the above specification. Call build_package with the intentJson to generate the workflow package.'
            : `Design has ${design.clarifyingQuestions.filter(q => q.impact === 'blocking').length} blocking question(s) that need answers before building.`,
      });
    }

    // Step 3: Build immediately (skipDesignReview=true)
    const buildResult = buildPackageFromIntent(intent, {
      ...(appName ? { appName } : {}),
      includeTests:          true,
      includeInfrastructure: true,
      wrapInScope:           true,
    });

    return ok({
      stage:    'built',
      intent,
      package:  buildResult,
    });
  },

};

// ─── Utilities ────────────────────────────────────────────────────────────────

function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError: false,
  };
}

function err(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function featureGated(feature: string): CallToolResult {
  return err(
    `This feature ('${feature}') requires a higher license tier. ` +
    `Please upgrade your BizTalk to Logic Apps license to access this functionality.`
  );
}

function parseJson<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error(`Invalid JSON input: ${json.substring(0, 100)}...`);
  }
}

/**
 * Dispatch a tool call to its handler. Returns error result if handler not found.
 */
export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return err(`Unknown tool: ${toolName}`);
  }

  try {
    return await handler(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(`Tool '${toolName}' failed: ${message}`);
  }
}
