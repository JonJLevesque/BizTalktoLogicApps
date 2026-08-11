# Plan — March 26, 2026: Absorb BizTalkMigrationStarter Feature Parity (v1.0.70)

## Context

Harold Campos released [BizTalkMigrationStarter](https://github.com/haroldcampos/BizTalkMigrationStarter) — a free, open-source C#/.NET Framework 4.7.2 tool (Windows-only) with 3 CLI executables, 25 MCP tools, and MIT license. Competitive analysis on March 26, 2026 identified 18 features they have that we don't. This plan absorbs those gaps so they have nothing we don't have.

**Our moat:** AI enrichment via Claude proxy, quality scoring (A–F grading), cross-platform (Mac/Windows/Linux), commercial support, VS Code extension, 34 MCP tools vs their 25.

**Their advantage:** Free/open source, RabbitMQ/Kafka/MLLP connectors, self-recursion detection, deployment scripts, connector optimizer for on-prem targeting.

---

## Competitive Comparison Summary

### What Harold Has That We Already Have
- ODX orchestration parsing ✓
- BTM map analysis ✓
- BTP pipeline analysis ✓
- Binding file parsing ✓
- MCP server (we have 34 tools, they have 25) ✓
- Db2, OracleDb, AzureTable, MLLP/HL7 connectors ✓
- Batch/estate processing (our `estate` CLI command) ✓
- Callable workflow detection ✓
- Integration pattern detection (we detect 17, they detect 10) ✓
- Expression translation (XLANG/s → WDL) ✓
- Workflow validation ✓
- Gap analysis ✓
- ARM template generation ✓

### What Harold Has That We DON'T (The Gap List)
1. RabbitMQ connector
2. Kafka / Confluent Kafka connector
3. Informix connector
4. HostFile connector
5. VSAM connector
6. KeyVault as a Logic Apps workflow connector
7. SWIFT connector
8. CICS connector
9. IMS connector
10. Self-recursion detection (recursive orchestration → Until loop)
11. Web reference / SOAP proxy handling
12. Azure DevOps YAML pipeline generation
13. PowerShell deployment scripts
14. Connector optimizer (auto-swap based on cloud vs on-prem target)
15. Kubernetes / Azure Arc deployment support
16. Functoid-to-XSLT/LML actual code generation
17. GitHub Actions workflow generation
18. Consolidated InitializeVariable pattern (Sandro's feedback)

### What We Have That Harold Doesn't
- AI-enriched migration (Claude fills semantic gaps, not just structural translation)
- Quality scoring with A–F grading (target B ≥ 75/100)
- Cross-platform (TypeScript/Node.js — Mac, Windows, Linux)
- VS Code extension with webview panels
- Migration report in MD + HTML with Actionable Fix List
- Local Code Function .cs stub generation
- Greenfield NLP builder (Premium tier)
- Complete workspace generation (.code-workspace, tasks.json, fix-project-path.ps1)
- ARM + Bicep + Terraform infrastructure generation
- Commercial license tiers with feature gating
- 358 tests across 19 suites

---

## Implementation Plan

### PHASE 1: Connector Parity (9 connectors) — Trivial, ~1 hour

All follow the same pattern: add to 3 maps + 1 registry.

**Files to modify:**
- `src/stage3-build/connection-generator.ts` — `CONNECTOR_REGISTRY` + `ADAPTER_TO_CONNECTOR` + `PROTOCOL_TO_CONNECTOR`
- `src/stage1-understand/intent-constructor.ts` — local `ADAPTER_TO_CONNECTOR`
- `src/stage3-build/workflow-generator.ts` — `SERVICE_PROVIDER_IDS` + `TRIGGER_DISPLAY_NAMES`

| # | Connector | BizTalk Adapters | Type | serviceProviderId |
|---|-----------|-----------------|------|-------------------|
| 1 | `rabbitmq` | RabbitMQ | built-in | `/serviceProviders/RabbitMQ` |
| 2 | `kafka` | Kafka, ConfluentKafka | built-in | `/serviceProviders/kafka` |
| 3 | `informix` | Informix | managed | `/managedApis/informix` |
| 4 | `hostFile` | HostFile, HostApps | managed | `/managedApis/hostfile` |
| 5 | `vsam` | VSAM, Vsam | managed | `/managedApis/hostfile` (same as HostFile) |
| 6 | `keyVault` | KeyVault, AzureKeyVault | built-in | `/serviceProviders/keyVault` |
| 7 | `swift` | SWIFT | managed (IA) | `/managedApis/swift` |
| 8 | `cics` | CICS, Cics | managed+gateway | `/managedApis/cics` |
| 9 | `ims` | IMS, Ims | managed+gateway | `/managedApis/ims` |

Also add to `PROTOCOL_TO_CONNECTOR`:
- `'RabbitMQ': 'rabbitmq'`, `'Kafka': 'kafka'`, `'SWIFT': 'swift'`, `'Key Vault': 'keyVault'`

---

### PHASE 2: InitializeVariable Consolidation — Small, ~30 min

Sandro's pattern: ONE `Initialize_Variables` action with ALL variables in the `variables` array, not separate actions per variable.

**File:** `src/stage3-build/workflow-generator.ts`

**Change `ensureVariablesInitialized()` (line ~1296):**
- Current: iterates `missingVars`, creates one `InitializeVariable` action per variable
- New: collect ALL missing vars into single `Initialize_Variables` action:
```typescript
const allVars = missingVars.map(v => ({ name: v, type: 'string' as const, value: '' }));
return {
  Initialize_Variables: {
    type: 'InitializeVariable',
    inputs: { variables: allVars },
    runAfter: {},
  } satisfies InitializeVariableAction,
  ...actions,
};
```

**Also consolidate existing individual InitializeVariable actions in `wrapInErrorScope()` (line ~1327):**
- When hoisting, merge ALL `InitializeVariable` actions into a single `Initialize_Variables` action
- Combine their `variables` arrays
- Single `runAfter: {}` for the merged action

**Update tests:** `tests/unit/workflow-generator.test.ts` — expect single `Initialize_Variables` action.

---

### PHASE 3: Self-Recursion Detection — Medium, ~1 hour

BizTalk allows orchestrations to call themselves. Logic Apps does not support self-referencing Workflow actions.

**Files to modify:**
- `src/stage1-understand/intent-constructor.ts` — In `processShapes()`, pass current orchestration name. In `buildStepFromShape()` for `CallOrchestrationShape`, compare `shape.calledOrchestration` against current orch name. If match → emit `loop` step (Until) instead of `invoke-child`.
- `src/stage1-understand/pattern-detector.ts` — Add `'self-recursion'` pattern detection
- `src/shared/integration-intent.ts` — Add `'self-recursion'` to `IntegrationPattern` union (if needed)
- `src/stage2-document/gap-analyzer.ts` — Add gap entry when self-recursion detected: "Recursive orchestration converted to Until loop. Verify termination condition."

**Name matching:** Use `.endsWith()` to handle fully-qualified names (e.g., `MyProject.MyNamespace.MyOrch` matches `MyOrch`).

---

### PHASE 4: Deployment Artifacts — Medium, ~2 hours

#### 4A: Azure DevOps YAML Pipeline
**New file:** `src/stage3-build/devops-pipeline-generator.ts`
- Export `generateAzureDevOpsPipeline(appName: string): string`
- Multi-stage YAML: build → deploy-staging → deploy-production
- Uses `az logicapp deployment source config-zip`
- App settings from `local.settings.json`

#### 4B: PowerShell Deployment Script
**New file:** `src/stage3-build/deploy-script-generator.ts`
- Export `generateDeployScript(appName: string): string`
- `deploy.ps1`: `Connect-AzAccount`, `New-AzResourceGroupDeployment`, `Publish-AzWebApp`

#### 4C: GitHub Actions Workflow
**New file:** `src/stage3-build/github-actions-generator.ts`
- Export `generateGitHubActionsWorkflow(appName: string): string`
- `.github/workflows/deploy-logicapp.yml`: checkout → login → deploy

**Files to modify for all 3:**
- `src/types/logicapps.ts` — Add `deploymentArtifacts?: { devopsPipeline?: string; deployScript?: string; githubActions?: string }` to `BuildResult`
- `src/stage3-build/package-builder.ts` — Call all 3 generators, attach to `BuildResult`
- `src/runner/output-writer.ts` — Write files to `{AppName}_Infra/` directory:
  - `azure-pipelines.yml`
  - `scripts/deploy.ps1`
  - `.github/workflows/deploy-logicapp.yml`
- `src/stage3-build/index.ts` — Re-export new generators

---

### PHASE 5: Web Reference / SOAP Proxy — Medium, ~1.5 hours

Harold generates separate child workflows per SOAP operation from WSDL. We already map SOAP→HTTP but don't handle BizTalk web references specifically.

**Files to modify:**
- `src/stage1-understand/binding-analyzer.ts` — Detect SOAP web reference addresses in send port configurations, extract endpoint URL and SOAPAction headers
- `src/stage1-understand/intent-constructor.ts` — When send port has SOAP/WCF-BasicHttp with SOAPAction, emit HTTP action with proper `Content-Type: text/xml` and `SOAPAction` header in step config
- `src/stage2-document/gap-analyzer.ts` — Add gap: "SOAP web reference detected. WCF proxy removed — Logic Apps uses raw HTTP POST with SOAP envelope."

**Scope limit:** Extract endpoint + SOAPAction → generate HTTP action with headers. No full WSDL parsing (too complex, diminishing returns with AI enrichment).

---

### PHASE 6: Connector Optimizer — Medium, ~1.5 hours

Auto-swap connectors based on deployment target (cloud vs on-prem).

**New file:** `src/stage3-build/connector-optimizer.ts`
- Export `optimizeConnectors(intent: IntegrationIntent, target: 'cloud' | 'on-premises' | 'hybrid'): IntegrationIntent`
- Rules:
  - On-prem: `serviceBus` → `rabbitmq`, `blob` → `filesystem`, `eventHubs` → `kafka`, `cosmosDb` → `sql`
  - Cloud: `filesystem` → `blob`, `rabbitmq` → `serviceBus`

**Files to modify:**
- `src/stage3-build/package-builder.ts` — Add optional `deploymentTarget` to build options, call optimizer before workflow generation
- `src/runner/types.ts` — Add `deploymentTarget?: 'cloud' | 'on-premises' | 'hybrid'` to `MigrationRunOptions`
- `src/cli/index.ts` — Add `--target` CLI flag

---

## NOT DOING (diminishing returns)

| Feature | Why skip |
|---------|----------|
| K8s/Azure Arc manifests | Platform still evolving; low demand; can add later |
| Full functoid→XSLT codegen | Our AI enrichment approach is better; Harold's is limited too (90 functoids but no semantic understanding) |
| Full WSDL parser | Endpoint extraction + HTTP template is sufficient; AI enrichment handles the rest |

---

## Files Summary

| File | Phases |
|------|--------|
| `src/stage3-build/connection-generator.ts` | 1 |
| `src/stage1-understand/intent-constructor.ts` | 1, 3, 5 |
| `src/stage3-build/workflow-generator.ts` | 1, 2 |
| `src/stage3-build/package-builder.ts` | 4, 6 |
| `src/runner/output-writer.ts` | 4 |
| `src/stage1-understand/pattern-detector.ts` | 3 |
| `src/shared/integration-intent.ts` | 3 |
| `src/stage2-document/gap-analyzer.ts` | 3, 5 |
| `src/types/logicapps.ts` | 4 |
| `src/stage3-build/index.ts` | 4 |
| `src/runner/types.ts` | 6 |
| `src/cli/index.ts` | 6 |
| **New:** `src/stage3-build/devops-pipeline-generator.ts` | 4A |
| **New:** `src/stage3-build/deploy-script-generator.ts` | 4B |
| **New:** `src/stage3-build/github-actions-generator.ts` | 4C |
| **New:** `src/stage3-build/connector-optimizer.ts` | 6 |

---

## Verification

1. `npx tsc --noEmit` → zero errors after each phase
2. `npm test` → all pass (update snapshots with `-u` if needed)
3. After Phase 1: verify new connectors produce valid `connections.json` entries
4. After Phase 2: verify single `Initialize_Variables` action in workflow output
5. After Phase 3: create test with recursive CallOrchestration → verify Until loop emitted
6. After Phase 4: verify `azure-pipelines.yml`, `deploy.ps1`, `deploy-logicapp.yml` in output
7. After all phases: run 3 Sandro samples, verify no regressions
8. Bump to 1.0.70, commit, publish

---

## Harold's Repo Details (for reference)

- **Repo:** https://github.com/haroldcampos/BizTalkMigrationStarter
- **Author:** Harold Campos
- **Language:** C# / .NET Framework 4.7.2 (Windows-only)
- **License:** MIT (free, open source)
- **Stats:** 9 stars, 5 forks, last pushed March 23, 2026
- **YouTube:** https://youtu.be/H-Cw3mCxMms (how-to)
- **Projects:** ODXtoWFMigrator, BTMtoLMLMigrator, BTPtoLA, BizTalkToLogicApps.MCP, BizTalktoLogicApps.Tests
- **Connector registry:** 32 connectors (JSON-driven, extensible without code changes)
- **Functoid translation:** 90+ functoid types in BTM→LML converter
- **Pattern detection:** 10 integration patterns
- **Refactoring modes:** Conservative, Balanced, Aggressive
- **Deployment targets:** Cloud, OnPremises (Logic Apps Kubernetes/Docker)
- **Key differentiator from us:** Connector optimizer auto-swaps connectors per deployment target
