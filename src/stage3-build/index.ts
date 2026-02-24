/**
 * Stage 3 — Build
 *
 * Public API for the Build stage. Exports all generators and builders
 * used by both the Migration pipeline (Mode A) and the Greenfield NLP
 * pipeline (Mode B, Premium tier).
 *
 * Entry points:
 *   buildPackage(migrationResult, options)         — full migration build
 *   buildPackageFromIntent(intent, options)         — greenfield NLP build
 *   generateWorkflow(intent, options)               — single workflow.json
 *   convertMap(map)                                 — BTM → LML/XSLT/stub
 *   generateConnectionsFromApp(app)                 — connections from bindings
 *   generateConnectionsFromIntent(intent)           — connections from intent
 *   generateArmTemplate(arch)                       — ARM deployment template
 *   generateLocalSettings(appSettings)              — local.settings.json
 *   generateTestSpec(intent, workflowName)          — JSON test spec
 *   generateMsTestScaffold(spec, logicAppName)      — C# MSTest class
 */

// ─── Workflow Generator ────────────────────────────────────────────────────────
export { generateWorkflow }                         from './workflow-generator.js';
export type { WorkflowGeneratorOptions }            from './workflow-generator.js';

// ─── Map Converter ─────────────────────────────────────────────────────────────
export { convertMap }                               from './map-converter.js';
export type { ConvertedMap, MapOutputFormat }       from './map-converter.js';

// ─── Connection Generator ──────────────────────────────────────────────────────
export {
  generateConnectionsFromIntent,
  generateConnectionsFromApp,
}                                                   from './connection-generator.js';
export type { ConnectionGeneratorResult }           from './connection-generator.js';

// ─── Infrastructure Generator ─────────────────────────────────────────────────
export { generateArmTemplate, generateLocalSettings } from './infrastructure-generator.js';
export type { ArmTemplate, ArmParameter, ArmResource, ArmOutput }
                                                    from './infrastructure-generator.js';

// ─── Test Spec Generator ───────────────────────────────────────────────────────
export { generateTestSpec, generateMsTestScaffold } from './test-spec-generator.js';
export type {
  WorkflowTestSpec,
  TestCase,
  TestMock,
  TestAssertion,
}                                                   from './test-spec-generator.js';

// ─── Package Builder ───────────────────────────────────────────────────────────
export { buildPackage, buildPackageFromIntent }     from './package-builder.js';
export type {
  BuildOptions,
  BuildResult,
  BuildSummary,
}                                                   from './package-builder.js';
