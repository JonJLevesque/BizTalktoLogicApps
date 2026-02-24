/**
 * MCP Tool Definitions
 *
 * All tools exposed to Claude through the MCP server.
 * Each tool has:
 *   - name:        machine identifier (snake_case)
 *   - description: what Claude should understand about when/how to use it
 *   - inputSchema: JSON Schema derived from Zod schemas in schemas.ts
 *
 * Tool groups:
 *   Stage 1 — Understand (7 tools)
 *   Stage 2 — Document  (3 tools)
 *   Stage 3 — Build     (7 tools)
 *   Greenfield NLP      (7 tools, Premium)
 *   Utilities           (2 tools)
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  AnalyzeOrchestrationSchema,
  AnalyzeMapSchema,
  AnalyzePipelineSchema,
  AnalyzeBindingsSchema,
  AnalyzeApplicationSchema,
  AssessComplexitySchema,
  GenerateMigrationSpecSchema,
  GenerateGapAnalysisSchema,
  GenerateArchitectureSchema,
  GenerateWorkflowSchema,
  ConvertMapSchema,
  GenerateConnectionsSchema,
  GenerateInfrastructureSchema,
  GenerateTestsSchema,
  BuildPackageSchema,
  InterpretNlpSchema,
  GenerateDesignSchema,
  InferSchemaSchema,
  RecommendConnectorsSchema,
  ListTemplatesSchema,
  ApplyTemplateSchema,
  RefineWorkflowSchema,
  CreateWorkflowFromDescriptionSchema,
  ReadArtifactSchema,
  ListArtifactsSchema,
  ConstructIntentSchema,
  ValidateIntentSchema,
  ValidateWorkflowSchema,
  ValidateConnectionsSchema,
  ValidatePackageSchema,
  ScoreMigrationQualitySchema,
} from './schemas.js';

// ─── Tool Definition Type ─────────────────────────────────────────────────────

export interface ToolDefinition {
  name:        string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Which license tier is required */
  tier:        'free' | 'standard' | 'premium';
}

// ─── Helper ────────────────────────────────────────────────────────────────────

function schema(zSchema: Parameters<typeof zodToJsonSchema>[0]): Record<string, unknown> {
  return zodToJsonSchema(zSchema, { target: 'openApi3' }) as Record<string, unknown>;
}

// ─── Tool Catalog ─────────────────────────────────────────────────────────────

export const ALL_TOOLS: ToolDefinition[] = [

  // ── Stage 1: Understand ────────────────────────────────────────────────────

  {
    name: 'analyze_orchestration',
    tier: 'free',
    description:
      'Parse a BizTalk .odx orchestration XML and extract structured metadata: ' +
      'shapes, ports, messages, correlations, expressions, and scopes. ' +
      'Use this FIRST when given .odx file content. Returns a ParsedOrchestration object.',
    inputSchema: schema(AnalyzeOrchestrationSchema),
  },

  {
    name: 'analyze_map',
    tier: 'free',
    description:
      'Parse a BizTalk .btm map XML and extract transformation metadata: ' +
      'source/target schemas, functoid chains, link topology, and scripting code. ' +
      'Use when given .btm file content. Returns a ParsedMap object.',
    inputSchema: schema(AnalyzeMapSchema),
  },

  {
    name: 'analyze_pipeline',
    tier: 'free',
    description:
      'Parse a BizTalk .btp pipeline XML and extract component configurations: ' +
      'stages, components, properties, and pipeline type (receive/send). ' +
      'Returns a ParsedPipeline object.',
    inputSchema: schema(AnalyzePipelineSchema),
  },

  {
    name: 'analyze_bindings',
    tier: 'free',
    description:
      'Parse a BizTalk binding XML export and extract connectivity configuration: ' +
      'receive locations, send ports, adapter types, transport properties, filters. ' +
      'Returns a ParsedBindingFile object.',
    inputSchema: schema(AnalyzeBindingsSchema),
  },

  {
    name: 'analyze_biztalk_application',
    tier: 'free',
    description:
      'Perform a complete analysis of a BizTalk application by analyzing all its artifacts ' +
      'together: orchestrations + maps + pipelines + bindings. ' +
      'Builds a comprehensive BizTalkApplication object that feeds the Document and Build stages. ' +
      'Use this when you have multiple artifact files for one application.',
    inputSchema: schema(AnalyzeApplicationSchema),
  },

  {
    name: 'detect_patterns',
    tier: 'free',
    description:
      'Identify enterprise integration patterns in a BizTalk application: ' +
      'sequential convoy, scatter-gather, content-based routing, publish-subscribe, ' +
      'request-reply, long-running transactions, aggregation. ' +
      'Returns a list of pattern names and evidence.',
    inputSchema: schema(AssessComplexitySchema),  // same input: applicationJson
  },

  {
    name: 'assess_complexity',
    tier: 'free',
    description:
      'Score the migration complexity of a BizTalk application: simple / moderate / complex / requires-redesign. ' +
      'Returns a ComplexityReport with scores per category (shapes, maps, adapters, patterns) ' +
      'and an overall recommendation. Use this to help the user prioritize migration work.',
    inputSchema: schema(AssessComplexitySchema),
  },

  // ── Stage 2: Document ──────────────────────────────────────────────────────

  {
    name: 'generate_migration_spec',
    tier: 'free',
    description:
      'Generate a structured migration specification document from a BizTalk application. ' +
      'Includes: component inventory, data flow, gap analysis, risk assessment, ' +
      'architecture recommendation, and per-artifact migration mappings. ' +
      'Returns a MigrationPlan. This is the core Stage 2 output.',
    inputSchema: schema(GenerateMigrationSpecSchema),
  },

  {
    name: 'generate_gap_analysis',
    tier: 'free',
    description:
      'Identify gaps between BizTalk capabilities used in the application and ' +
      'available Logic Apps equivalents. Returns a prioritized MigrationGap[] list ' +
      'with severity (critical/high/medium/low), mitigation strategies, and estimated effort.',
    inputSchema: schema(GenerateGapAnalysisSchema),
  },

  {
    name: 'generate_architecture',
    tier: 'free',
    description:
      'Produce an Azure architecture recommendation for the migrated application: ' +
      'which Azure services are needed, Logic Apps SKU, Integration Account requirements, ' +
      'hosting model, estimated workflow count. ' +
      'Returns an ArchitectureRecommendation object.',
    inputSchema: schema(GenerateArchitectureSchema),
  },

  // ── Stage 3: Build ─────────────────────────────────────────────────────────

  {
    name: 'generate_workflow',
    tier: 'standard',
    description:
      'Generate a Logic Apps Standard workflow.json from an IntegrationIntent. ' +
      'Produces valid WDL (Workflow Definition Language) JSON with correct trigger, ' +
      'actions, runAfter chains, error handling scopes, and connector configurations. ' +
      'Use this to generate individual workflow files.',
    inputSchema: schema(GenerateWorkflowSchema),
  },

  {
    name: 'convert_map',
    tier: 'standard',
    description:
      'Convert a BizTalk .btm map into Logic Apps format. ' +
      'Produces LML (YAML, for Data Mapper) for simple direct-link maps, ' +
      'XSLT stylesheets for functoid-based maps, or Azure Function stubs ' +
      'for scripting functoids that cannot be automatically translated. ' +
      'Returns a ConvertedMap with format, content, and warnings.',
    inputSchema: schema(ConvertMapSchema),
  },

  {
    name: 'generate_connections',
    tier: 'standard',
    description:
      'Generate the connections.json file for a Logic Apps Standard project. ' +
      'Selects built-in connectors where available (preferred), falls back to managed. ' +
      'Replaces all sensitive values with @AppSetting() references. ' +
      'Returns ConnectionsJson + appSettings key-value pairs.',
    inputSchema: schema(GenerateConnectionsSchema),
  },

  {
    name: 'generate_infrastructure',
    tier: 'standard',
    description:
      'Generate ARM deployment templates for the Logic Apps Standard infrastructure: ' +
      'App Service Plan, Logic App, Storage Account, Application Insights, Key Vault, ' +
      'and any optional services (Service Bus, Integration Account, CosmosDB, etc.). ' +
      'Also generates local.settings.json for local development.',
    inputSchema: schema(GenerateInfrastructureSchema),
  },

  {
    name: 'generate_tests',
    tier: 'standard',
    description:
      'Generate unit test specifications for a Logic Apps workflow: ' +
      'JSON test spec (happy path, error path, routing, retry) compatible with ' +
      'logicapps-unittest-custom-agent, plus a C# MSTest scaffold class ' +
      'for integration testing against a deployed workflow.',
    inputSchema: schema(GenerateTestsSchema),
  },

  {
    name: 'build_package',
    tier: 'standard',
    description:
      'Build a complete, zip-deployable Logic Apps Standard project package from ' +
      'either a MigrationResult (migration path) or IntegrationIntent (greenfield NLP path). ' +
      'Assembles: workflow.json files, XSLT/LML maps, connections.json, host.json, ' +
      'ARM templates, local.settings.json, and unit test specs. ' +
      'This is the primary Stage 3 entry point — use it for full package generation.',
    inputSchema: schema(BuildPackageSchema),
  },

  // ── Greenfield NLP (Premium) ───────────────────────────────────────────────

  {
    name: 'interpret_nlp',
    tier: 'premium',
    description:
      '[PREMIUM] Parse a natural language integration description into a structured IntegrationIntent. ' +
      'Extracts: trigger type/source, processing steps, error handling strategy, ' +
      'external systems, data formats, and integration patterns. ' +
      'Returns an IntegrationIntent + ambiguities + confidence score. ' +
      'Use BEFORE generate_design and build_package in the NLP workflow.',
    inputSchema: schema(InterpretNlpSchema),
  },

  {
    name: 'generate_design',
    tier: 'premium',
    description:
      '[PREMIUM] Generate an architecture design specification from an IntegrationIntent, ' +
      'BEFORE generating code. Shows: workflow outline, connector recommendations ' +
      'with reasoning, required Azure resources, cost estimate, clarifying questions, ' +
      'and risk flags. Present this to the user for review before calling build_package. ' +
      'If readyToBuild is false, address the clarifying questions first.',
    inputSchema: schema(GenerateDesignSchema),
  },

  {
    name: 'infer_schema',
    tier: 'premium',
    description:
      '[PREMIUM] Derive a JSON Schema from a natural language description of a data structure. ' +
      'Useful when the user describes their data in prose and needs a schema for ' +
      'Logic Apps Parse JSON actions or Integration Account schemas. ' +
      'Returns an InferredSchema with JSON Schema draft-07 content.',
    inputSchema: schema(InferSchemaSchema),
  },

  {
    name: 'recommend_connectors',
    tier: 'premium',
    description:
      '[PREMIUM] Select the best Logic Apps connectors for a set of external systems. ' +
      'Prefers built-in connectors over managed (lower latency, no managed resource overhead). ' +
      'Returns ConnectorRecommendation[] with reasoning, alternatives, required resources, ' +
      'and setup effort for each system.',
    inputSchema: schema(RecommendConnectorsSchema),
  },

  {
    name: 'list_templates',
    tier: 'premium',
    description:
      '[PREMIUM] Browse the integration pattern template library. ' +
      'Templates are pre-built IntegrationIntents for common patterns: ' +
      'file-processing, messaging, api-integration, scheduled-batch, b2b-edi, ' +
      'database-sync, notification. Filter by category or search keyword.',
    inputSchema: schema(ListTemplatesSchema),
  },

  {
    name: 'apply_template',
    tier: 'premium',
    description:
      '[PREMIUM] Start from a template and optionally customize it via natural language. ' +
      'Returns an IntegrationIntent ready for generate_design or build_package. ' +
      'Use this instead of interpret_nlp when the user\'s need matches a known pattern.',
    inputSchema: schema(ApplyTemplateSchema),
  },

  {
    name: 'refine_workflow',
    tier: 'premium',
    description:
      '[PREMIUM] Apply a natural language modification to an existing IntegrationIntent. ' +
      'Supports: adding steps, removing steps, changing trigger, updating error handling, ' +
      'changing data formats, modifying retry count, changing endpoint URLs. ' +
      'Returns the updated IntegrationIntent. For complex changes, returns a prompt ' +
      'for Claude to perform the edit directly.',
    inputSchema: schema(RefineWorkflowSchema),
  },

  {
    name: 'create_workflow_from_description',
    tier: 'premium',
    description:
      '[PREMIUM] One-shot command: parse NLP → design → build package. ' +
      'Combines interpret_nlp + generate_design + build_package into a single call. ' +
      'Set skipDesignReview=false (default) to return the design spec first so the user ' +
      'can review it before code is generated. ' +
      'Set skipDesignReview=true only when requirements are unambiguous.',
    inputSchema: schema(CreateWorkflowFromDescriptionSchema),
  },

  // ── File Tools ──────────────────────────────────────────────────────────────

  {
    name: 'read_artifact',
    tier: 'free',
    description:
      'Read a BizTalk artifact file from disk. ' +
      'Supports .odx (orchestration), .btm (map), .btp (pipeline), .xml (bindings/schemas), .xsd (schemas). ' +
      'Returns raw file content as a string ready to pass to analyze_* tools. ' +
      'Use this when given a file path instead of pasted XML content.',
    inputSchema: schema(ReadArtifactSchema),
  },

  {
    name: 'list_artifacts',
    tier: 'free',
    description:
      'Scan a directory for BizTalk artifact files. ' +
      'Returns categorized lists: orchestrations (.odx), maps (.btm), pipelines (.btp), bindings (.xml), schemas (.xsd). ' +
      'Use this FIRST when given a directory path to a BizTalk project to discover all artifacts.',
    inputSchema: schema(ListArtifactsSchema),
  },

  // ── Intent Construction ─────────────────────────────────────────────────────

  {
    name: 'construct_intent',
    tier: 'standard',
    description:
      'Mechanically convert a BizTalkApplication object to a partial IntegrationIntent ' +
      'using deterministic shape→step and adapter→connector mappings. ' +
      'Returns an IntegrationIntent with TODO_CLAUDE markers where Claude\'s reasoning is needed ' +
      '(expression translation, error strategy, connector config details). ' +
      'Enrich the TODO_CLAUDE values before calling validate_intent + build_package.',
    inputSchema: schema(ConstructIntentSchema),
  },

  // ── Validation ──────────────────────────────────────────────────────────────

  {
    name: 'validate_intent',
    tier: 'free',
    description:
      'Validate an IntegrationIntent for structural correctness and semantic consistency. ' +
      'Returns valid/invalid with specific error messages and warnings. ' +
      'Always call this before build_package to catch issues early.',
    inputSchema: schema(ValidateIntentSchema),
  },

  {
    name: 'validate_workflow',
    tier: 'free',
    description:
      'Validate a Logic Apps workflow.json against WDL structural rules. ' +
      'Checks: $schema, single trigger, runAfter ALL CAPS (SUCCEEDED/FAILED/TIMEDOUT/SKIPPED), ' +
      'action references, no cycles, ServiceProvider configs, If expressions. ' +
      'Returns errors, warnings, and suggestions. ' +
      'Run this after generate_workflow or build_package — fix errors before deployment.',
    inputSchema: schema(ValidateWorkflowSchema),
  },

  {
    name: 'validate_connections',
    tier: 'free',
    description:
      'Validate a Logic Apps connections.json. ' +
      'Checks: structure, @appsetting() usage for sensitive values, ' +
      'optional cross-check against workflow.json for orphan/missing connections.',
    inputSchema: schema(ValidateConnectionsSchema),
  },

  {
    name: 'validate_package',
    tier: 'standard',
    description:
      'Full cross-file package validation: workflow + connections + appSettings coverage + map references. ' +
      'Aggregates issues from all files and cross-validates references. ' +
      'Returns errors, warnings, and suggestions across the complete deployment package.',
    inputSchema: schema(ValidatePackageSchema),
  },

  {
    name: 'score_migration_quality',
    tier: 'standard',
    description:
      'Score the quality of a generated Logic Apps workflow on a 0-100 scale. ' +
      'Four dimensions: Structural (40pts), Completeness (30pts), Best Practices (20pts), Naming (10pts). ' +
      'Returns a letter grade (A-F) with specific recommendations. ' +
      'Target grade B or higher (≥75/100) before presenting output to the user.',
    inputSchema: schema(ScoreMigrationQualitySchema),
  },

];

/**
 * Get tools available for a given license tier.
 * Free tier gets understand + document tools.
 * Standard adds build tools.
 * Premium adds all NLP greenfield tools.
 */
export function getToolsForTier(tier: 'free' | 'standard' | 'premium'): ToolDefinition[] {
  const tiers = { free: 0, standard: 1, premium: 2 };
  const userLevel = tiers[tier];

  return ALL_TOOLS.filter(t => tiers[t.tier] <= userLevel);
}
