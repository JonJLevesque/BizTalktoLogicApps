# BizTalk Migration Report: OrderBroker

Generated: 2026-02-28 | AI mode: proxy | Runtime: 96.5s

---

## Executive Summary

| Property | Value |
|----------|-------|
| Application | OrderBroker |
| Complexity | highly-complex (129/100) |
| Orchestrations | 2 |
| Maps | 2 |
| Pipelines | 0 |
| Bindings | 1 |
| Workflows generated | 2 |
| Quality score | 🟢 100/100 Grade A |
| Critical gaps | 1 |
| High gaps | 2 |
| Medium gaps | 0 |

## Detected Enterprise Integration Patterns

Detected **7** enterprise integration pattern(s): 4 migrate automatically, 3 require review, 0 require redesign.

| Pattern | Support | Logic Apps Equivalent |
|---------|---------|----------------------|
| Content-Based Router | ✅ Auto | If / Switch action |
| Request-Reply | ✅ Auto | Request trigger + Response action |
| Dead Letter Queue | ✅ Auto | Scope + Terminate on FAILED runAfter |
| Message Enricher | ✅ Auto | HTTP call-out + Compose action |
| Process Manager | ⚠️ Partial | Stateful workflow + child Workflow actions |
| Aggregator | ⚠️ Partial | ForEach + Append to Array Variable |
| Splitter | ⚠️ Partial | ForEach action (concurrency: 1) |

> See the migration report above for pattern details and effort estimates.

## Gap Analysis

| Severity | Capability | Mitigation |
|----------|-----------|-----------|
| 🔴 Critical | MSDTC Atomic Transactions | Redesign using the Saga pattern: decompose the atomic operation into a sequence of local transactions, each paired with a compensating action that reverses its effects if a later step fails. Implement compensation via a dedicated Logic Apps workflow invoked from a Scope action with runAfter ["FAILED"]. |
| 🟠 High | Long-Running Transactions | Use Scope actions with runAfter ["FAILED", "TIMEDOUT"] to implement error recovery. For compensation logic, call a separate rollback workflow via HTTP action. Consider Service Bus dead-letter queues for failed-message handling in multi-step processes. |
| 🟠 High | Custom C# Helper Assemblies | Use Logic Apps Local Code Functions (preferred): add a .NET class to the lib/custom folder of your Logic Apps project and invoke it via the Execute Code Function action. This runs in-process with the Logic Apps runtime — no separate deployment, no HTTP latency. Only use Azure Functions for code that is very large, needs its own scaling, or must be shared across multiple applications. For each ExpressionShape marked TODO in the workflow, create a corresponding local function stub. |

## Architecture Recommendation

**Target:** Azure Logic Apps Standard (single-tenant)

**Integration Account:** Required for XSLT map execution from converted .btm files.

**Connector strategy:** ServiceProvider (built-in) connectors used where available for better performance and simpler configuration.

## Generated Artifacts

Output directory: `outputs/08-e2e-order-broker`

**Workflows:**
- `OrderBrokerOrch/workflow.json`
- `OrderManagerOrch/workflow.json`

**Maps:**
- `Artifacts/Maps/Order_To_OrderStatus.lml` (Data Mapper LML)
- `Artifacts/Maps/Order_To_SQLUpdateStatus.lml` (Data Mapper LML)

**Configuration files:**
- `connections.json` — connector configuration
- `host.json` — Logic Apps host settings
- `local.settings.json` — local dev settings (gitignore this)
- `arm-template.json` — ARM deployment template
- `arm-parameters.json` — ARM parameters

## Quality Report

**Score:** 100/100  **Grade:** 🟢 A

> Workflow quality score: 100/100 (A) — 1 issue found

| Dimension | Score | Max |
|-----------|-------|-----|
| Structural | 40 | 40 |
| Completeness | 30 | 30 |
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
   Right-click `outputs/08-e2e-order-broker` → Deploy to Logic App...
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

- **Address 1 critical gap(s)** before deployment:
-   - MSDTC Atomic Transactions: Redesign using the Saga pattern: decompose the atomic operation into a sequence of local transactions, each paired with a compensating action that reverses its effects if a later step fails. Implement compensation via a dedicated Logic Apps workflow invoked from a Scope action with runAfter ["FAILED"].
- Review converted XSLT maps — C# scripting functoids require Azure Functions replacement
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