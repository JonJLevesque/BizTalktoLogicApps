/**
 * Greenfield NLP Module — PREMIUM TIER
 *
 * Exports all Stage G1/G2/G3 functions for the NLP-driven workflow builder.
 *
 * Pipeline:
 *   1. interpretNlp(description)       → IntegrationIntent + ambiguities
 *   2. generateDesign(intent)          → WorkflowDesign (for user review)
 *   3. buildPackageFromIntent(intent)  → BuildResult (from stage3-build)
 *
 * Utilities:
 *   - inferSchema(description)         → JSON Schema
 *   - recommendConnectors(systems)     → ConnectorRecommendation[]
 *   - listTemplates(options)           → WorkflowTemplate[]
 *   - getTemplate(id)                  → WorkflowTemplate | null
 *   - cloneTemplateIntent(id)          → IntegrationIntent | null
 *   - refineIntent(intent, instruction) → RefinementResult
 */

// ─── NLP Interpreter ──────────────────────────────────────────────────────────
export { interpretNlp }                           from './nlp-interpreter.js';
export type { NlpInterpretResult, NlpAmbiguity }  from './nlp-interpreter.js';

// ─── Schema Inferrer ──────────────────────────────────────────────────────────
export { inferSchema, inferTransformSchemas }     from './schema-inferrer.js';
export type {
  InferredSchema,
  InferredField,
  JsonSchema,
  JsonSchemaType,
}                                                 from './schema-inferrer.js';

// ─── Connector Recommender ────────────────────────────────────────────────────
export {
  recommendConnectors,
  recommendConnectorForProtocol,
  listBuiltInConnectors,
  listManagedConnectors,
}                                                 from './connector-recommender.js';
export type {
  ConnectorRecommendation,
  AlternativeConnector,
}                                                 from './connector-recommender.js';

// ─── Design Generator ─────────────────────────────────────────────────────────
export { generateDesign }                         from './design-generator.js';
export type {
  WorkflowDesign,
  WorkflowOutlineNode,
  DesignResource,
  CostEstimate,
  ClarifyingQuestion,
  DesignRisk,
}                                                 from './design-generator.js';

// ─── Template Library ─────────────────────────────────────────────────────────
export {
  listTemplates,
  getTemplate,
  findTemplatesByBizTalkPattern,
  cloneTemplateIntent,
  TEMPLATE_CATALOG,
}                                                 from './template-library.js';
export type {
  WorkflowTemplate,
  TemplateCategory,
}                                                 from './template-library.js';

// ─── Refinement Engine ────────────────────────────────────────────────────────
export { refineIntent }                           from './refinement-engine.js';
export type {
  RefinementResult,
  AppliedOperation,
  PendingOperation,
  RefinementOpType,
}                                                 from './refinement-engine.js';
