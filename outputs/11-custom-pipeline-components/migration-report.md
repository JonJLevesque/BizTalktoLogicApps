# BizTalk Migration Report: CustomPipelineComponents

Generated: 2026-02-28 | AI mode: proxy | Runtime: 24.7s

---

## Executive Summary

| Property | Value |
|----------|-------|
| Application | CustomPipelineComponents |
| Complexity | simple (6/100) |
| Orchestrations | 0 |
| Maps | 0 |
| Pipelines | 2 |
| Bindings | 0 |
| Workflows generated | 1 |
| Quality score | 🟢 96/100 Grade A |
| Critical gaps | 0 |
| High gaps | 0 |
| Medium gaps | 2 |

## Detected Enterprise Integration Patterns

Detected **2** enterprise integration pattern(s): 0 migrate automatically, 1 require review, 0 require redesign.

| Pattern | Support | Logic Apps Equivalent |
|---------|---------|----------------------|
| Splitter | ⚠️ Partial | ForEach action (concurrency: 1) |
| custom-pipeline | ⚠️ Partial | Manual review required |

> See the migration report above for pattern details and effort estimates.

## Gap Analysis

| Severity | Capability | Mitigation |
|----------|-----------|-----------|
| 🟡 Medium | Custom Pipeline Components | Three migration options depending on complexity: (1) Inline Code action (JavaScript, C#, or PowerShell) for simple transformations that fit in ~50 lines, (2) Local Functions (.NET code running in-process with the Logic Apps runtime) for moderate complexity with shared libraries, (3) Azure Function (separate service) for heavy compute or shared-across-workflows logic. Map pipeline stages: Decode → before trigger, Disassemble → Parse JSON/XML, Validate → Condition action, Assemble → Compose/Transform, Encode → after main logic. |
| 🟡 Medium | Flat File Pipeline Component Output Difference | For output structure differences: After switching to the Logic Apps Flat File Decode action, run the migration test suite against golden-master outputs. Update any downstream XSLT maps or XSD schemas that reference element names specific to BizTalk's flat file XML format. The VS Code Data Mapper extension can help visually remap between the old and new structures. For Header/Body/Trailer schemas: Consolidate into a single Body schema, representing header and trailer as record types within the unified schema. |

## Architecture Recommendation

**Target:** Azure Logic Apps Standard (single-tenant)

**Connector strategy:** ServiceProvider (built-in) connectors used where available for better performance and simpler configuration.

## Generated Artifacts

Output directory: `outputs/11-custom-pipeline-components`

**Workflows:**
- `CustomPipelineComponents/workflow.json`

**Configuration files:**
- `connections.json` — connector configuration
- `host.json` — Logic Apps host settings
- `local.settings.json` — local dev settings (gitignore this)
- `arm-template.json` — ARM deployment template
- `arm-parameters.json` — ARM parameters

## Quality Report

**Score:** 96/100  **Grade:** 🟢 A

> Workflow quality score: 96/100 (A) — 1 issue found

| Dimension | Score | Max |
|-----------|-------|-----|
| Structural | 40 | 40 |
| Completeness | 26 | 30 |
| Best Practices | 20 | 20 |
| Naming | 10 | 10 |

**Recommendations:**
- Translate C# expressions to WDL @{...} syntax for all SetVariable values

## Actionable Fix List

Address each item below to improve migration quality and close deployment gaps.

| # | Issue | Recommended Fix | Impact |
|---|-------|-----------------|--------|
| 1 | Quality: Translate C# expressions to WDL @{...} syntax for all SetVariable values | Translate C# expressions to WDL @{...} syntax for all SetVariable values | Score improvement |

## Deployment Instructions

### Prerequisites
- Azure subscription with Logic Apps Standard resource
- Azure CLI (`az login`)
- VS Code with Azure Logic Apps (Standard) extension

### Steps

1. **Configure app settings** in Azure Portal → Logic App → Configuration:
   - Add all `KVS_*` secrets as Key Vault references
   - Add all `Common_*` and `Workflow_*` settings as plain values

2. **Deploy via VS Code:**
   ```
   Right-click `outputs/11-custom-pipeline-components` → Deploy to Logic App...
   ```

3. **Deploy via Azure CLI:**
   ```bash
   az logicapp deployment source config-zip \
    --name <logic-app-name> \
    --resource-group <resource-group> \
    --src <path-to-zip>
   ```

4. **Verify:** Open Logic App in Azure Portal → check each workflow runs successfully.

## Manual Next Steps

- Replace all `KVS_*` placeholder values with actual Key Vault secret URIs
- Test each workflow end-to-end with representative sample messages
- Set up Azure Monitor alerts for workflow failures

## Getting Started

Open this output folder in VS Code to work with the migrated Logic Apps project:

1. **Install the extension** — "Azure Logic Apps (Standard)" (`ms-azuretools.vscode-azurelogicapps`)
2. **Open the folder** — File → Open Folder → select this output directory
3. **The `.vscode/settings.json`** is pre-configured for Logic Apps Standard
4. **Edit connection settings** — update `local.settings.json` with your real connection strings
5. **Open a workflow in Designer** — right-click any `workflow.json` → "Open in Designer"
6. **Deploy to Azure** — use the Logic Apps extension sidebar → Deploy to Logic App

**Maps** are in `Artifacts/Maps/` and **Schemas** are in `Artifacts/Schemas/`.

---

*Generated by BizTalk to Logic Apps Migration Framework*
*Support: Me@Jonlevesque.com*