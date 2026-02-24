/**
 * MCP Tool Input Schemas — Zod definitions
 *
 * All tool inputs are validated here before being passed to handlers.
 * These schemas also serve as the source of truth for the tool descriptions
 * that Claude sees (via zodToJsonSchema in definitions.ts).
 */

import { z } from 'zod';

// ─── Stage 1 — Understand ────────────────────────────────────────────────────

export const AnalyzeOrchestrationSchema = z.object({
  xmlContent: z.string().describe(
    'Raw XML content of a .odx BizTalk orchestration file'
  ),
  projectName: z.string().optional().describe(
    'Optional BizTalk project name for context'
  ),
});

export const AnalyzeMapSchema = z.object({
  xmlContent: z.string().describe(
    'Raw XML content of a .btm BizTalk map file'
  ),
});

export const AnalyzePipelineSchema = z.object({
  xmlContent: z.string().describe(
    'Raw XML content of a .btp BizTalk pipeline file'
  ),
});

export const AnalyzeBindingsSchema = z.object({
  xmlContent: z.string().describe(
    'Raw XML content of a BizTalk binding XML file (exported from BizTalk Administration)'
  ),
  applicationName: z.string().optional().describe(
    'BizTalk application name if known'
  ),
});

export const AnalyzeApplicationSchema = z.object({
  orchestrationXmls: z.array(z.string()).describe(
    'Array of raw XML strings — one per .odx file in the application'
  ),
  mapXmls: z.array(z.string()).optional().describe(
    'Array of raw XML strings — one per .btm file'
  ),
  pipelineXmls: z.array(z.string()).optional().describe(
    'Array of raw XML strings — one per .btp file'
  ),
  bindingXml: z.string().optional().describe(
    'Raw XML of the application binding export'
  ),
  applicationName: z.string().describe(
    'BizTalk application name'
  ),
});

export const AssessComplexitySchema = z.object({
  applicationJson: z.string().describe(
    'JSON-serialized BizTalkApplication object (output of analyze_biztalk_application)'
  ),
});

// ─── Stage 2 — Document ──────────────────────────────────────────────────────

export const GenerateMigrationSpecSchema = z.object({
  applicationJson: z.string().describe(
    'JSON-serialized BizTalkApplication object'
  ),
  intentJson: z.string().describe(
    'JSON-serialized IntegrationIntent object (output of analyze phase)'
  ),
});

export const GenerateGapAnalysisSchema = z.object({
  applicationJson: z.string().describe(
    'JSON-serialized BizTalkApplication object'
  ),
});

export const GenerateArchitectureSchema = z.object({
  applicationJson: z.string().describe(
    'JSON-serialized BizTalkApplication object'
  ),
  gapAnalysisJson: z.string().describe(
    'JSON-serialized MigrationGap[] array (output of generate_gap_analysis)'
  ),
  detectedPatterns: z.array(z.string()).optional().describe(
    'Integration patterns detected in the application'
  ),
});

// ─── Stage 3 — Build ────────────────────────────────────────────────────────

export const GenerateWorkflowSchema = z.object({
  intentJson: z.string().describe(
    'JSON-serialized IntegrationIntent object'
  ),
  workflowName: z.string().optional().describe(
    'Name for the workflow (defaults to appName from intent)'
  ),
  kind: z.enum(['Stateful', 'Stateless']).optional().default('Stateful').describe(
    'Logic Apps workflow kind. Stateful for production, Stateless for simple/short flows'
  ),
  wrapInScope: z.boolean().optional().default(true).describe(
    'Whether to wrap all actions in a top-level error-handling Scope'
  ),
});

export const ConvertMapSchema = z.object({
  mapJson: z.string().describe(
    'JSON-serialized ParsedMap object (output of analyze_map)'
  ),
});

export const GenerateConnectionsSchema = z.object({
  applicationJson: z.string().optional().describe(
    'JSON-serialized BizTalkApplication (for migration path)'
  ),
  intentJson: z.string().optional().describe(
    'JSON-serialized IntegrationIntent (for greenfield NLP path)'
  ),
});

export const GenerateInfrastructureSchema = z.object({
  architectureJson: z.string().describe(
    'JSON-serialized ArchitectureRecommendation (output of generate_architecture)'
  ),
  appSettings: z.record(z.string()).optional().describe(
    'App Settings key-value pairs to include in local.settings.json'
  ),
});

export const GenerateTestsSchema = z.object({
  intentJson: z.string().describe(
    'JSON-serialized IntegrationIntent'
  ),
  workflowName: z.string().describe(
    'Name of the workflow to generate tests for'
  ),
  logicAppName: z.string().optional().describe(
    'Logic App Standard app name for MSTest scaffold (defaults to workflow name)'
  ),
});

export const BuildPackageSchema = z.object({
  migrationResultJson: z.string().optional().describe(
    'JSON-serialized MigrationResult (full migration path)'
  ),
  intentJson: z.string().optional().describe(
    'JSON-serialized IntegrationIntent (greenfield NLP path — use instead of migrationResultJson)'
  ),
  appName: z.string().optional().describe(
    'Base name for the Logic Apps Standard app'
  ),
  includeTests: z.boolean().optional().default(true).describe(
    'Whether to include unit test specs in the package'
  ),
  includeInfrastructure: z.boolean().optional().default(true).describe(
    'Whether to include ARM deployment template'
  ),
  wrapInScope: z.boolean().optional().default(true).describe(
    'Whether to wrap workflow actions in a top-level error-handling Scope'
  ),
});

// ─── Greenfield NLP (Premium) ─────────────────────────────────────────────────

export const InterpretNlpSchema = z.object({
  description: z.string().min(20).describe(
    'Natural language description of the integration requirement. Be specific about: ' +
    'trigger (what starts it), data flow (what happens to data), external systems ' +
    'involved, error handling, and data formats.'
  ),
});

export const GenerateDesignSchema = z.object({
  intentJson: z.string().describe(
    'JSON-serialized IntegrationIntent (from interpret_nlp or analyze_biztalk_application)'
  ),
});

export const InferSchemaSchema = z.object({
  description: z.string().describe(
    'Natural language description of the data structure (e.g., "each order has an orderId, customerId, totalAmount, and a list of line items")'
  ),
  schemaName: z.string().optional().describe(
    'Optional name for the schema (e.g., "OrderPayload")'
  ),
});

export const RecommendConnectorsSchema = z.object({
  systemsJson: z.string().describe(
    'JSON-serialized ExternalSystem[] array describing the systems to connect'
  ),
});

export const ListTemplatesSchema = z.object({
  category: z.enum([
    'file-processing', 'messaging', 'api-integration',
    'scheduled-batch', 'b2b-edi', 'database-sync', 'notification',
  ]).optional().describe('Filter by category'),
  search: z.string().optional().describe('Keyword search across template names and descriptions'),
});

export const ApplyTemplateSchema = z.object({
  templateId: z.string().describe(
    'Template ID from list_templates (e.g., "sftp-to-api")'
  ),
  customizations: z.string().optional().describe(
    'Natural language customization instructions applied immediately after loading the template'
  ),
});

export const RefineWorkflowSchema = z.object({
  intentJson: z.string().describe(
    'JSON-serialized IntegrationIntent to modify'
  ),
  instruction: z.string().min(5).describe(
    'Natural language modification instruction. Examples: "Also save each record to Cosmos DB", ' +
    '"Change retry count to 5", "Add email notification on failure to ops@company.com"'
  ),
});

export const CreateWorkflowFromDescriptionSchema = z.object({
  description: z.string().min(20).describe(
    'Complete natural language description of the integration. Include trigger, data flow, error handling, and external systems.'
  ),
  appName: z.string().optional().describe(
    'Name for the Logic Apps Standard app (auto-generated from description if omitted)'
  ),
  skipDesignReview: z.boolean().optional().default(false).describe(
    'If true, skip the design review step and generate code immediately. ' +
    'Not recommended unless requirements are very clear.'
  ),
});
