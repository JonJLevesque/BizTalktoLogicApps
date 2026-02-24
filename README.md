# BizTalk to Logic Apps Migration Framework

A commercial-grade, **consultant-focused** tool for migrating Microsoft BizTalk Server applications to Azure Logic Apps Standard. Combines deep static analysis of BizTalk artifacts with AI-powered workflow generation — running **100% locally** so no customer data ever leaves the machine.

> **Market window**: BizTalk Server 2020 is Microsoft's final release. Extended support ends **October 2028**. Every enterprise running BizTalk must migrate. This tool makes that process systematic, accurate, and fast.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Two Modes](#two-modes)
- [Licensing Tiers](#licensing-tiers)
- [Architecture Overview](#architecture-overview)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [MCP Server (Claude Integration)](#mcp-server-claude-integration)
- [VS Code Extension](#vs-code-extension)
- [Configuration](#configuration)
- [BizTalk Coverage](#biztalk-coverage)
  - [Orchestration Shapes](#orchestration-shapes-21-total)
  - [Adapter → Connector Mapping](#adapter--connector-mapping-30-adapters)
  - [Gap Analysis](#gap-analysis)
  - [Map Migration Paths](#map-migration-paths)
- [Integration Patterns Detected](#integration-patterns-detected)
- [Sequential Convoy Pattern](#sequential-convoy-pattern)
- [Output Structure](#output-structure)
- [Test Fixtures](#test-fixtures)
- [Development](#development)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)

---

## What It Does

The framework automates the most time-consuming parts of a BizTalk migration engagement:

| Without this tool | With this tool |
|---|---|
| Manually read every `.odx` file | Parsed and scored in seconds |
| Hand-write gap analysis in Word | Generated Markdown spec with effort estimates |
| Guess which Azure services are needed | Architecture recommendation with rationale |
| Build Logic Apps JSON by hand | Generated `workflow.json` from intent model |
| Figure out connection strings | `connections.json` with App Settings references |
| Write ARM/Bicep from scratch | Generated infra templates |
| No repeatable test approach | Generated test specs per workflow |

**Key principle**: This is not a mechanical 1:1 translator. The tool understands the *business intent* of a BizTalk orchestration and produces idiomatic Logic Apps that achieve the same outcome in the cloud-native way — using Service Bus sessions for convoy patterns, Scope actions for error handling, and built-in connectors over managed ones where possible.

---

## Two Modes

### Mode A — BizTalk Migration (Standard tier)

```
BizTalk XML (.odx/.btm/.btp/BindingInfo.xml/XSD)
        ↓
  Stage 1: UNDERSTAND
  Parse artifacts • Score complexity • Detect patterns
        ↓
  Stage 2: DOCUMENT
  Gap analysis • Architecture recommendation • Migration spec
        ↓
  Stage 3: BUILD
  workflow.json • connections.json • maps • ARM/Bicep • test specs
        ↓
Azure Logic Apps Standard project
```

### Mode B — Greenfield NLP (Premium tier)

```
Natural language description
  "Poll a Service Bus queue, route messages by type to SQL or an HTTP endpoint"
        ↓
  NLP Interpreter → Schema Inferrer → Connector Recommender
        ↓
  Design Generator → Template Library → Refinement Engine
        ↓
Azure Logic Apps Standard project
```

Both modes produce the same output format. Stages 1 and 2 are always free.

---

## Licensing Tiers

| Feature | Free | Standard | Premium |
|---|:---:|:---:|:---:|
| Stage 1: Parse & analyze BizTalk artifacts | ✅ | ✅ | ✅ |
| Stage 2: Gap analysis, architecture recommendation | ✅ | ✅ | ✅ |
| Stage 3: Generate Logic Apps workflows | — | ✅ | ✅ |
| Stage 3: Generate connections, infrastructure, tests | — | ✅ | ✅ |
| Stage 3: Build deployable package | — | ✅ | ✅ |
| Greenfield NLP workflow design | — | — | ✅ |
| Template library (50+ patterns) | — | — | ✅ |
| Schema inference from examples | — | — | ✅ |

Set your license key via the `BIZTALK_MIGRATE_LICENSE` environment variable, the VS Code setting `biztalkMigrate.licenseKey`, or the `--license` CLI flag.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Entry Points                              │
│  CLI (Node.js)  │  MCP Server (stdio)  │  VS Code Extension │
└────────┬────────┴──────────┬───────────┴────────┬───────────┘
         │                   │                    │
         └──────────────────►│◄───────────────────┘
                             │
              ┌──────────────▼───────────────┐
              │        IntegrationIntent      │  ← shared contract
              │  (trigger, steps, patterns,   │
              │   systems, errorHandling)     │
              └──────────────┬───────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
    ┌─────▼──────┐    ┌──────▼──────┐    ┌─────▼──────┐
    │  Stage 1   │    │  Stage 2    │    │  Stage 3   │
    │ UNDERSTAND │    │  DOCUMENT   │    │   BUILD    │
    │            │    │             │    │            │
    │ odx parser │    │ gap-analyzer│    │ workflow-  │
    │ btm parser │    │ risk-assess │    │ generator  │
    │ btp parser │    │ arch-recomm │    │ map-       │
    │ binding-   │    │ spec-gen    │    │ converter  │
    │ analyzer   │    │             │    │ connection-│
    │ pattern-   │    │             │    │ generator  │
    │ detector   │    │             │    │ infra-gen  │
    │ complexity │    │             │    │ test-gen   │
    └────────────┘    └─────────────┘    └────────────┘
```

**Data privacy guarantee**: All parsing, analysis, and generation happens in-process. No BizTalk artifacts, source code, or customer data is transmitted anywhere. Only the license key validation makes an outbound network call.

---

## Quick Start

### Requirements

- Node.js 20+
- npm 9+

### Install & Build

```bash
git clone <repo>
cd BiztalktoLogicapps
npm install
npm run build
```

### Run Your First Analysis

```bash
# Analyze a directory of BizTalk artifacts (free)
node dist/cli/index.js analyze --app "OrderProcessing" --dir ./biztalk-artifacts

# Generate the full migration plan
node dist/cli/index.js migrate --app "OrderProcessing" --dir ./biztalk-artifacts --output ./migration-output

# Design a new workflow from a description (requires Premium license)
node dist/cli/index.js design "Receive orders from a Service Bus queue, validate against XSD, transform to SAP IDOC format and send via HTTP"
```

---

## CLI Reference

```
biztalk-migrate <command> [options]

Commands:
  analyze     Parse BizTalk artifacts and produce a complexity + pattern report
  document    Generate gap analysis and architecture recommendation (Stage 2)
  migrate     Full pipeline: analyze → document → build Logic Apps output (Stage 3)
  design      Greenfield workflow design from a natural language description
  validate    Validate a generated workflow.json against the WDL schema

Options:
  --app <name>      Application name (used in output file names)
  --dir <path>      Directory containing BizTalk artifacts (.odx, .btm, .btp, etc.)
  --input <file>    Path to a previously saved migration-result.json
  --output <dir>    Output directory for generated Logic Apps project
  --license <key>   License key (overrides BIZTALK_MIGRATE_LICENSE env var)
  --kind            Workflow kind: Stateful (default) | Stateless
  --wrap-scope      Wrap workflow in a top-level error-handling Scope
  --format          Output format: json | markdown (default: both)
```

### Example: Full Migration Run

```bash
export BIZTALK_MIGRATE_LICENSE="your-key-here"

node dist/cli/index.js migrate \
  --app "CustomerOnboarding" \
  --dir ./artifacts \
  --output ./output/CustomerOnboarding
```

**Output structure:**

```
output/CustomerOnboarding/
├── workflows/
│   ├── Process-CustomerOnboarding/
│   │   └── workflow.json           ← WDL workflow definition
│   └── Process-CustomerOnboarding-ErrorHandler/
│       └── workflow.json
├── connections.json                ← Service provider + managed API connections
├── host.json                       ← Logic Apps host configuration
├── local.settings.json             ← App Settings template (fill in values)
├── infra/
│   ├── main.bicep                  ← Azure deployment template
│   └── parameters.json
├── tests/
│   └── CustomerOnboarding.Tests.json
└── migration-report.md             ← Human-readable gap analysis + component mapping
```

---

## MCP Server (Claude Integration)

The framework ships as an MCP (Model Context Protocol) server, exposing all capabilities as tools that Claude can call directly during a conversation.

### Setup

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "biztalk-migration": {
      "command": "node",
      "args": ["/path/to/dist/mcp-server/server.js"],
      "env": {
        "BIZTALK_MIGRATE_LICENSE": "your-license-key"
      }
    }
  }
}
```

**VS Code (Claude Code)** — `.vscode/mcp.json` is already configured in this repo:

```json
{
  "servers": {
    "biztalk-migration": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/mcp-server/server.js"]
    }
  }
}
```

### Available MCP Tools (26 total)

#### Stage 1 — Understand

| Tool | Description |
|---|---|
| `analyze_orchestration` | Parse a `.odx` file → `ParsedOrchestration` with shapes, ports, correlation sets |
| `analyze_map` | Parse a `.btm` or compiled `.xslt` file → `ParsedMap` with functoid analysis |
| `analyze_pipeline` | Parse a `.btp` file → `ParsedPipeline` with component stage mapping |
| `analyze_bindings` | Parse a `BindingInfo.xml` file → adapter types, addresses, filter expressions |
| `analyze_biztalk_application` | Parse a full application directory → complete `BizTalkApplication` |
| `detect_patterns` | Identify enterprise integration patterns (convoy, CBR, fan-out, etc.) |
| `assess_complexity` | Score application complexity (simple/moderate/complex/highly-complex) |

#### Stage 2 — Document

| Tool | Description |
|---|---|
| `generate_migration_spec` | Full Stage 2: gaps + risk + architecture + component mapping table |
| `generate_gap_analysis` | Standalone gap analysis → gaps sorted by severity with effort estimates |
| `generate_architecture` | Architecture recommendation: SKU, Integration Account, VNET, services |

#### Stage 3 — Build

| Tool | Description |
|---|---|
| `generate_workflow` | Generate `workflow.json` from an `IntegrationIntent` |
| `convert_map` | Convert a BizTalk `.btm` map → LML, XSLT, or Azure Function template |
| `generate_connections` | Generate `connections.json` with App Settings references |
| `generate_infrastructure` | Generate Bicep/ARM templates + `host.json` |
| `generate_tests` | Generate test specs for a workflow |
| `build_package` | Assemble complete deployable Logic Apps Standard package |

#### Greenfield NLP (Premium)

| Tool | Description |
|---|---|
| `interpret_nlp` | Parse natural language description → `IntegrationIntent` |
| `generate_design` | Design a complete Logic Apps workflow from an intent |
| `infer_schema` | Infer XSD/JSON schemas from message examples |
| `recommend_connectors` | Recommend connectors for described integration requirements |
| `list_templates` | Browse the curated workflow template library |
| `apply_template` | Instantiate a template with custom parameters |
| `refine_workflow` | Iteratively refine a workflow using natural language feedback |
| `create_workflow_from_description` | One-shot: description → complete deployable package |

---

## VS Code Extension

The VS Code extension activates automatically when you open any of these file types:

- `.odx` — BizTalk orchestration
- `.btm` — BizTalk map
- `.btp` — BizTalk pipeline
- `BindingInfo.xml` — BizTalk binding file
- `biztalk-migrate.config.json` — project configuration

### Commands (Command Palette: `Cmd+Shift+P`)

| Command | Description |
|---|---|
| **BizTalk: Analyze Application** | Run full Stage 1 analysis on the current workspace |
| **BizTalk: Generate Migration Plan** | Run Stage 2 and display the migration spec |
| **BizTalk: Build Logic Apps Package** | Run Stage 3 and generate the output project |
| **BizTalk: Show Analysis Results** | Open the analysis results panel |
| **BizTalk: Browse Templates** | Open the template browser panel |
| **BizTalk: Design Workflow (NLP)** | Open the NLP greenfield design dialog |
| **BizTalk: Check License** | Validate and display the current license |

### Analysis Results Panel

The **Analysis Results** panel shows:

- Complexity score breakdown with hot-spot identification
- Migration gaps table (severity / capability / effort / mitigation)
- Component mapping table (every shape, adapter, map, and pipeline)
- Architecture recommendation with required Azure services
- Estimated effort in person-days

### Template Browser Panel

Browse and search 50+ pre-built workflow patterns. Click **Use Template** to instantiate any pattern as a starting point, then customise through the NLP refinement flow.

---

## Configuration

| VS Code Setting | Environment Variable | Description | Default |
|---|---|---|---|
| `biztalkMigrate.licenseKey` | `BIZTALK_MIGRATE_LICENSE` | License key for Standard/Premium features | *(free tier)* |
| `biztalkMigrate.outputDir` | `BIZTALK_MIGRATE_OUTPUT` | Directory for generated Logic Apps files | `./logic-apps-output` |
| `biztalkMigrate.workflowKind` | `BIZTALK_WORKFLOW_KIND` | `Stateful` or `Stateless` | `Stateful` |

**Always use `Stateful`** for BizTalk migrations. Stateless workflows don't persist state between actions and cannot support long-running processes, correlation, or Service Bus sessions.

---

## BizTalk Coverage

### Orchestration Shapes (21 total)

| BizTalk Shape | Logic Apps Mapping | Status |
|---|---|---|
| ReceiveShape | Trigger (type by adapter) | ✅ Direct |
| SendShape | HTTP / ServiceProvider action | ✅ Direct |
| ConstructShape | Compose action | ✅ Direct |
| MessageAssignmentShape | Compose / Initialize Variable | ✅ Direct |
| TransformShape | Transform XML (XSLT) / Liquid / Data Mapper | ✅ Direct |
| DecisionShape | If / Condition action | ✅ Direct |
| LoopShape | Until action *(condition inverted)* | ⚠ Partial |
| ListenShape | Parallel branches / Switch on message type | ⚠ Partial |
| ParallelActionsShape | Actions with shared runAfter predecessor | ✅ Direct |
| ScopeShape | Scope action + runAfter ["FAILED"] | ⚠ Partial |
| CompensateShape | Child workflow (compensation / Saga pattern) | ⚠ Partial |
| ThrowShape | Terminate action | ✅ Direct |
| TerminateShape | Terminate action | ✅ Direct |
| DelayShape | Delay / Wait action | ✅ Direct |
| ExpressionShape | Initialize/Set Variable + WDL expression | ⚠ Partial |
| CallOrchestrationShape | Workflow action (synchronous child call) | ✅ Direct |
| StartOrchestrationShape | HTTP POST to child workflow's Request trigger | ✅ Direct |
| CallRulesShape | **Azure Logic Apps Rules Engine** (same BRE runtime) | ✅ Direct |
| SuspendShape | Approval workflow via HTTP Request callback | ⚠ Partial |
| GroupShape | *(visual only — no action generated)* | — Drop |
| RoleLinkShape | Parameter-driven HTTP URI selection | — Notes |

> **Note on LoopShape**: BizTalk loops *while* the condition is true; Logic Apps Until loops *until* the condition is true. The generated Until action inverts the expression — review all loop conditions carefully.

> **Note on CallRulesShape**: The Azure Logic Apps Rules Engine uses the same BRE runtime as BizTalk. `.brl` policy files can often be migrated with minimal rework. If full BRE migration isn't feasible, the tool can also generate an Azure Function stub.

### Adapter → Connector Mapping (30+ adapters)

| BizTalk Adapter | Logic Apps Connector | Type | Notes |
|---|---|---|---|
| FILE | Azure Blob Storage | Built-in | Cloud; use Azure File Share for on-prem path preservation |
| FTP / FTPS | FTP | Managed | |
| SFTP | SFTP-SSH | Built-in | |
| HTTP / HTTPS | HTTP | Built-in | |
| WCF-BasicHttp | HTTP | Built-in | |
| WCF-WSHttp | HTTP + APIM (SOAP) | Built-in | |
| WCF-WebHttp | HTTP | Built-in | |
| **WCF-NetTcp** | Azure Relay Hybrid Connections | — | ⚠ Requires service update |
| **WCF-NetNamedPipe** | *No equivalent* | — | 🚨 Architectural redesign required |
| WCF-NetMsmq / MSMQ | Azure Service Bus | Built-in | |
| SQL Server | SQL Server | Built-in | On-prem gateway for local SQL |
| Oracle | Oracle Database | Managed | On-prem gateway |
| IBM MQ / MQSeries / WebSphere MQ | IBM MQ | Built-in | |
| IBM Db2 | IBM Db2 | Built-in | |
| IBM CICS | IBM CICS | Built-in | |
| IBM IMS | IBM IMS | Built-in | |
| SMTP | SMTP | Built-in | |
| POP3 / IMAP | Office 365 Outlook | Managed | |
| SAP | SAP | Built-in | On-prem gateway |
| Azure Blob Storage | Azure Blob Storage | Built-in | |
| Azure Event Hubs | Azure Event Hubs | Built-in | |
| Azure Table Storage | Azure Table Storage | Managed | |
| AS2 | AS2 + Integration Account | Built-in | |
| X12 | X12 + Integration Account | Built-in | |
| EDIFACT | EDIFACT + Integration Account | Built-in | |
| RosettaNet | RosettaNet + Integration Account | Built-in | |
| SWIFT | SWIFT + Integration Account | Built-in | |
| MLLP (HL7) | MLLP | Built-in | |

**Built-in connectors** run in-process with the Logic Apps runtime (lower latency, no separate resource). Always preferred over managed connectors.

### Gap Analysis

The gap analyzer inspects all artifacts and produces a severity-ranked gap report:

| Gap | Severity | Detection Method |
|---|---|---|
| MSDTC Atomic Transactions | 🔴 Critical | ScopeShape with `TransactionType="Atomic"` |
| WCF-NetNamedPipe Adapter | 🔴 Critical | Binding file `adapterType` |
| Long-Running Transactions | 🟠 High | ScopeShape with `TransactionType="LongRunning"` |
| Compensate Shape | 🟠 High | CompensateShape present |
| WCF-NetTcp Adapter | 🟠 High | Binding file `adapterType` |
| Business Rules Engine (BRE) | 🟡 Medium | CallRulesShape present |
| Scripting Functoids | 🟡 Medium | `msxsl:script` blocks in compiled XSLT |
| Database Functoids | 🟡 Medium | DB Lookup / Value Extractor functoid IDs |
| Custom Pipeline Components | 🟡 Medium | `IPipelineComponent` implementations |
| Multiple Activating Receives | 🟡 Medium | `activatingReceiveCount > 1` |
| Flat File Pipeline Output | 🟢 Low | `FlatFileDasmComp` / `FlatFileAsmComp` present |
| Business Activity Monitoring | 🟢 Low | Correlation sets / BAM interceptors |
| EDI/AS2 Processing | 🟢 Low | EDI schemas / pipeline components |

Each gap includes:
- Concrete mitigation strategy
- Effort estimate in person-days
- List of affected artifacts

### Map Migration Paths

| Path | When Used | Output |
|---|---|---|
| `lml` | Simple maps, no scripting functoids | Logic Apps Data Mapper `.lml` file |
| `xslt` | Standard XSLT-compatible maps | `.xslt` file for Transform XML action |
| `xslt-rewrite` | Maps with `msxsl:script` C# blocks | XSLT with flagged sections to rewrite |
| `azure-function` | Maps with DB functoids or complex scripting | Azure Function stub + HTTP action |
| `manual` | Maps that can't be auto-converted | Analysis report only |

> **Scripting functoids use `msxsl:script` C# blocks that are NOT supported in Logic Apps XSLT.** The Transform XML action uses .NET XSLT without the `msxsl:` extension. Scripts must be rewritten as standard XSLT templates or extracted to Azure Functions.

> **VS Code Data Mapper extension** — for simple maps, the Data Mapper provides a visual drag-and-drop interface that produces `.lml` format natively supported by Logic Apps Standard. Recommended for `lml` and `xslt` path maps.

---

## Integration Patterns Detected

| Pattern | Detection Heuristic | Generated Logic Apps Approach |
|---|---|---|
| `content-based-routing` | DecisionShape with field-based conditions | If / Switch action |
| `sequential-convoy` | Correlation sets on receive shapes | Service Bus sessions (see below) |
| `publish-subscribe` | Multiple send ports with filter expressions | Service Bus topics / Event Grid |
| `scatter-gather` | ParallelActionsShape → aggregation | Concurrent runAfter + aggregation scope |
| `message-aggregator` | Multiple correlated receives → single send | Until loop + array variable |
| `splitter` | Single receive → multiple sends | ForEach action / splitOn trigger |
| `claim-check` | Large message offload pattern | Azure Blob Storage + pointer message |
| `dead-letter-queue` | Error handling → send to queue | Service Bus dead-letter + runAfter ["FAILED"] |
| `fan-out` | One source → N destinations | Parallel HTTP/ServiceBus actions |
| `transformer` | TransformShape | Transform XML / Liquid action |
| `wire-tap` | Copy of messages sent to secondary output | Scope with parallel send branches |

---

## Sequential Convoy Pattern

BizTalk sequential convoys use correlation sets to process related messages in order. The generated Logic Apps equivalent uses **Service Bus sessions** — where the session ID serves the same role as the BizTalk correlation key.

Generated workflow structure:

```
Trigger: Service Bus peek-lock (sessions enabled, sessionId: "Next available")
│
├── Initialize_Process_Completed = false
│
└── Scope_Process_Message
    ├── Scope_Business_Logic          ← your migrated orchestration steps
    ├── Set_Process_Completed = true  ← runAfter: all statuses (succeeded/failed/skipped/timedout)
    └── Until_Renew_Lock              ← keeps the message lock alive during processing
        ├── Renew_Message_Lock
        └── Delay_30_Seconds
│
├── Abandon_Message   ← runAfter: Scope_Process_Message [FAILED, TIMEDOUT]
└── Complete_Message  ← runAfter: Scope_Process_Message [SUCCEEDED]
```

The lock renewal loop is critical — without it, the message lock expires during long-running processing and the message is re-delivered to a different session, breaking ordering guarantees.

To trigger this pattern: ensure the detected integration patterns include `sequential-convoy` (detected automatically when correlation sets are present on receive shapes).

---

## Output Structure

All generated files conform to the Logic Apps Standard project layout expected by the VS Code Logic Apps extension (v5.14.4+):

```
<output-dir>/
├── <WorkflowName>/
│   └── workflow.json          ← WDL definition (schema 2016-06-01)
├── connections.json           ← serviceProviderConnections + managedApiConnections
├── host.json                  ← extensionBundle, runtime settings
├── local.settings.json        ← App Settings template with @AppSetting('...') placeholders
├── parameters.json            ← WDL parameters
└── infra/
    ├── main.bicep
    └── parameters.bicep.json
```

### WDL conventions enforced

- `runAfter` values use `"SUCCEEDED"` / `"FAILED"` / `"SKIPPED"` / `"TIMEDOUT"` (ALL CAPS) — matching the Logic Apps Standard runtime requirement
- First action in every workflow has `runAfter: {}` (no predecessor = runs after trigger)
- All action names are unique PascalCase identifiers safe as JSON keys
- Sensitive values use `@AppSetting('KEY_NAME')` references — never hardcoded
- Built-in connectors use `serviceProviderConnections`; managed connectors use `managedApiConnections`
- Child workflow calls use `"type": "Workflow"` + `"host": {"workflow": {"id": "WorkflowName"}}` (Standard-specific, not Consumption-style)

---

## Test Fixtures

`tests/fixtures/` contains verified **input → transform → expected-output trios** for regression testing and LLM grounding:

| Fixture | BizTalk Pattern | Key Migration Challenge |
|---|---|---|
| `01-map-scripting-functoids/` | BTM map with C# scripting functoids | `msxsl:script` C# blocks (StringConcat, age calculation, cumulative sums) → not supported in Logic Apps XSLT |
| `02-simple-file-receive/` | Linear orchestration: Receive → Transform → Send (FILE adapter) | ODX shapes → trigger + Compose + Transform; FILE adapter → Blob trigger |
| `03-content-based-routing/` | DecisionShape with XLANG/s `\|\|` expression | Decide → If action; XLANG/s `\|\|` / `&&` → WDL `or` / `and` |

### Fixture-Driven Development

When starting a new migration engagement, collect:

1. **Sample input messages** — 3–5 representative XML/JSON messages (normal + edge cases)
2. **Golden master outputs** — run BizTalk with message tracking enabled, save raw outputs from the MessageBox
3. **XSD schemas** — from the BizTalk project's `Schemas` folder
4. **Compiled XSLT** — from the BizTalk project's `Maps` folder (reveals all functoid logic)
5. **UAT test data** — if the customer has BTDF unit tests or UAT spreadsheets

Place these in a `tests/fixtures/<fixture-name>/` directory following the trio pattern. The integration test suite picks them up automatically.

---

## Development

```bash
# Build
npm run build           # compile TypeScript to dist/
npm run build:watch     # compile in watch mode
npm run clean           # remove dist/

# Test
npm test                # run all 157 tests (unit + integration)
npm run test:watch      # watch mode
npm run test:coverage   # generate coverage report

# Quality
npm run typecheck       # npx tsc --noEmit (must be zero errors)
npm run lint            # ESLint
npm run format          # Prettier
```

### Running the MCP Server in Dev

```bash
npm run mcp:dev    # node --watch dist/mcp-server/server.js
```

### Adding a New Fixture

```bash
mkdir tests/fixtures/04-my-pattern/{input,transform,expected-output,schemas}
# Add input XML, transform artifact, and golden master output
# Add README.md describing the pattern and migration challenges
# Write a unit test in tests/unit/ or extend tests/integration/pipeline.test.ts
```

---

## Project Structure

```
src/
├── types/
│   ├── biztalk.ts          ← ParsedOrchestration, ParsedMap, ParsedPipeline, BindingFile, ShapeType
│   ├── logicapps.ts        ← WorkflowJson, WdlAction/Trigger types, ConnectionsJson
│   └── migration.ts        ← MigrationGap, MigrationPlan, ComponentMigrationMapping
│
├── shared/
│   ├── integration-intent.ts  ← IntegrationIntent interface (convergence point of both modes)
│   └── intent-validator.ts
│
├── licensing/
│   ├── license-validator.ts   ← License key validation (only outbound network call)
│   ├── feature-gates.ts       ← Per-feature license tier checks
│   └── license-cache.ts
│
├── stage1-understand/
│   ├── orchestration-analyzer.ts  ← ODX parser (21 shapes, all normalised)
│   ├── binding-analyzer.ts        ← BindingInfo.xml parser
│   ├── map-analyzer.ts            ← BTM / XSLT parser
│   ├── pipeline-analyzer.ts       ← BTP parser
│   ├── pattern-detector.ts        ← Enterprise integration pattern detection
│   └── complexity-scorer.ts       ← Complexity score + classification
│
├── stage2-document/
│   ├── gap-analyzer.ts            ← 13 gap definitions, severity-ranked
│   ├── risk-assessor.ts           ← Overall risk + effort estimate
│   ├── architecture-recommender.ts ← SKU, Integration Account, VNET, required services
│   └── migration-spec-generator.ts ← Orchestrates Stage 2; produces MigrationPlan
│
├── stage3-build/
│   ├── workflow-generator.ts      ← IntegrationIntent → workflow.json (WDL)
│   ├── map-converter.ts           ← BTM → LML / XSLT / Azure Function stub
│   ├── connection-generator.ts    ← connections.json (30+ adapter mappings)
│   ├── infrastructure-generator.ts ← Bicep / ARM templates
│   ├── test-spec-generator.ts     ← Test specs for generated workflows
│   └── package-builder.ts         ← Assembles complete deployable package
│
├── greenfield/
│   ├── nlp-interpreter.ts         ← Natural language → IntegrationIntent
│   ├── schema-inferrer.ts         ← Message examples → XSD/JSON schema
│   ├── connector-recommender.ts   ← Requirements → connector suggestions
│   ├── design-generator.ts        ← Intent → complete Logic Apps design
│   ├── template-library.ts        ← 50+ curated workflow templates
│   └── refinement-engine.ts       ← Iterative NLP-driven refinement
│
├── mcp-server/
│   ├── server.ts                  ← MCP stdio transport, tool registration
│   └── tools/
│       ├── definitions.ts         ← Tool input schemas (26 tools)
│       ├── handler.ts             ← Tool call dispatch
│       └── schemas.ts             ← Zod validation schemas
│
├── cli/
│   └── index.ts                   ← CLI entry point (analyze/document/migrate/design)
│
└── vscode/
    ├── extension.ts               ← VS Code extension entry point
    └── panels/
        ├── analysis-results-panel.ts  ← WebviewPanel: complexity, gaps, mappings
        └── template-browser-panel.ts  ← WebviewPanel: searchable template grid

schemas/
├── migration-schema.json   ← MigrationResult JSON schema
├── component-mapping.json  ← ComponentMigrationMapping schema
└── decision-trees.json     ← Decision tree data for architecture recommendations

docs/reference/
├── biztalk-architecture.md      ← BizTalk core concepts reference
├── logicapps-architecture.md    ← Logic Apps WDL reference
├── component-mapping.md         ← Full BizTalk → Logic Apps mapping table
├── connector-mapping.md         ← Adapter → connector reference
├── gap-analysis.md              ← All gap patterns with mitigations
├── expression-mapping.md        ← XLANG/s → WDL expression translation guide
├── migration-decision-tree.md   ← When to use which migration approach
└── pattern-mapping.md           ← Integration pattern mapping reference

tests/
├── fixtures/                    ← Input → transform → expected-output trios
│   ├── 01-map-scripting-functoids/
│   ├── 02-simple-file-receive/
│   └── 03-content-based-routing/
├── unit/                        ← Unit tests (10 suites, 100+ tests)
└── integration/
    └── pipeline.test.ts         ← Stage 1 → 2 → 3 pipeline tests (50 tests)
```

---

## Deployment Targets

### Logic Apps Standard — Cloud (Recommended)

Runs in Azure, single-tenant, stateful workflows, VNET integration. The default and recommended target for all BizTalk migrations.

### Logic Apps Standard — Hybrid

Runs on-premises using a Kubernetes-based runtime with a SQL Server backend. Provides cloud-parity features (same workflow engine, same connectors) while keeping data and processing on-premises.

**Consider Hybrid if:**
- Data sovereignty or regulatory requirements prevent cloud deployment
- Latency requirements demand local processing
- The BizTalk application uses adapters that access on-premises systems over private networks
- The customer wants to build cloud skills before a full cloud migration

The architecture recommender flags Hybrid as an option when on-prem-heavy adapter patterns are detected.

### Logic Apps Consumption

Not recommended for BizTalk migration. Consumption does not support stateful workflows, VNET integration, multiple workflows per resource, or the full built-in connector catalog that maps to BizTalk adapters. Use Standard.

---

## Roadmap

### Fixture Coverage (next priorities)

| Fixture | Pattern | What It Validates |
|---|---|---|
| `04-sequential-convoy` | Service Bus sessions | Convoy detection → sessions workflow generation |
| `05-edi-x12-receive` | EDI receive + X12 decode | EDI detection → Integration Account recommendation |
| `06-listen-timeout` | ListenShape (message wait + delay branch) | Listen → Switch on trigger |
| `07-compensation-scope` | Atomic scope + CompensateShape | Scope → Saga pattern with runAfter |
| `08-call-orchestration` | CallOrch + StartOrch | Workflow action (sync) + HTTP POST (async) |
| `09-flat-file-pipeline` | Flat file disassembler + splitOn | Pipeline → Flat File Decode + splitOn debatch |
| `10-wcf-soap-endpoint` | WCF-BasicHttp receive | SOAP → API Management + custom connector |

### Planned Enhancements

- **XLANG/s expression translator**: Automatic conversion of C# expressions to WDL `@{...}` syntax
- **Azure Pipelines integration**: CI/CD template generation for Logic Apps Standard deployment
- **Liquid template generation**: JSON-to-JSON and XML-to-JSON transformation templates
- **Migration wave planner**: Sprint 0 discovery → iterative migration wave plan with Epic/Feature/Story breakdown
- **BAM → Azure Business Process Tracking mapper**: Activity definition migration tool
- **BRE policy migrator**: `.brl` file parser → Azure Logic Apps Rules Engine import format

---

## Naming Conventions

Microsoft's recommended naming convention for migrated Logic Apps resources:

| Resource | Convention | Example |
|---|---|---|
| Logic Apps resource | `LAStd-{BU}-{Dept}-{Env}` | `LAStd-Finance-AP-Prod` |
| Workflow | `Process-{name}` | `Process-OrderOnboarding` |
| Connection | `CN-{ConnectorType}-{Workflow}` | `CN-ServiceBus-OrderOnboarding` |
| Resource group | `rg-integration-{env}` | `rg-integration-prod` |

Consistent naming enables policy-driven governance, cost allocation by department, and alert rule targeting.

---

## License

Commercial license required for Stage 3 (Build) and Greenfield features. Free tier gives full access to Stage 1 (parse + analyze) and Stage 2 (gap analysis + architecture recommendation).

Contact [your-contact] for consultant seat pricing.
