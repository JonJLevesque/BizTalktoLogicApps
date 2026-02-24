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
- [One-Command Pipeline](#one-command-pipeline)
- [CLI Reference](#cli-reference)
- [GitHub Actions](#github-actions)
- [MCP Server (Claude Integration)](#mcp-server-claude-integration)
  - [Claude-Powered Migration Pipeline](#claude-powered-migration-pipeline)
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
- [Usage Guide](#usage-guide)
  - [Before You Start](#before-you-start)
  - [Connect to Claude](#connect-to-claude)
  - [Run a Migration](#run-a-migration)
  - [Deploy the Output](#deploy-the-output)
  - [Greenfield NLP Mode](#greenfield-nlp-mode-premium)
  - [Validation Reference](#validation-reference)
  - [Quality Scoring](#quality-scoring-1)
  - [Common Issues](#common-issues)
  - [Tips for Complex Applications](#tips-for-complex-applications)
- [Support](#support)

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

## One-Command Pipeline

The `run` command (and the VS Code "Run Migration" command) automates the full 5-step pipeline in a single call. Consultants point it at a folder of BizTalk artifacts and get back a complete Logic Apps project plus a migration report — with no prompts, no chains, no MCP tool knowledge required.

```
┌──────────────────────────────────────────────────────┐
│  biztalk-migrate run  /  VS Code: "Run Migration"    │
│  GitHub Action: workflow_dispatch                    │
└─────────────────────┬────────────────────────────────┘
                      │
         ┌────────────▼────────────┐
         │      runMigration()     │  src/runner/migration-runner.ts
         └────────────┬────────────┘
                      │
   ┌──────────────────┼──────────────────┐
   ▼                  ▼                  ▼
PARSE (local)    REASON (Claude)   SCAFFOLD (local)
<1s              enriches intent   builds package
   │                  │                  │
   └──────────────────┼──────────────────┘
                      ▼
             VALIDATE + REVIEW
             (local + Claude if grade < B)
                      ▼
             REPORT → migration-report.md
```

**Only REASON and REVIEW use Claude.** Everything else runs locally.

### CLI: `run`

```bash
# Dev mode — no API key needed, enrichment skipped
BTLA_DEV_MODE=true node dist/cli/index.js run \
  --dir tests/fixtures/02-simple-file-receive \
  --app "SimpleFileReceive" \
  --output ./output

# Direct mode — Anthropic API (TODO_CLAUDE markers resolved, grade-targeted review)
ANTHROPIC_API_KEY=sk-... node dist/cli/index.js run \
  --dir ./biztalk-artifacts \
  --app "CustomerOnboarding" \
  --output ./logic-apps-output

# Proxy mode — license key authenticates against the hosted proxy
BTLA_LICENSE_KEY=your-key node dist/cli/index.js run \
  --dir ./biztalk-artifacts \
  --app "CustomerOnboarding" \
  --output ./logic-apps-output
```

Console output during a run:
```
[PARSE   ] Scanning artifacts in ./biztalk-artifacts...
[PARSE   ] Found 5 artifacts — 2 orchestrations, 1 map, 0 pipelines, 2 bindings
[PARSE   ] Parsing orchestration: ProcessOrder.odx
[REASON  ] Enriching with AI (direct mode)...
[SCAFFOLD] Generating Logic Apps package...
[VALIDATE] Validating generated workflows...
[VALIDATE] Quality: 85/100 Grade B
✔ Migration complete

── Migration Summary ──────────────────────────────────
  Application:  CustomerOnboarding
  Output:       ./logic-apps-output
  Workflows:    2
  Quality:      85/100 Grade B
  migration-report.md written to ./logic-apps-output
```

### VS Code: "BizTalk: Run Migration"

Command palette (`Cmd+Shift+P`) → **BizTalk Migrate: Run Migration (One-Command Pipeline)**

1. Folder picker — select the BizTalk artifacts directory
2. Enter the application name
3. Enter (or confirm) the output directory
4. Progress notification shows each step in real time
5. On completion: migration-report.md opens in markdown preview

### Claude Client Modes

| Environment | Mode | Behaviour |
|---|---|---|
| `BTLA_DEV_MODE=true` | dev | No API calls. Partial intent used as-is. Fast, free, offline. |
| `ANTHROPIC_API_KEY=sk-...` | direct | Calls Anthropic API directly using `claude-sonnet-4-6`. Good for self-hosting. |
| `BTLA_LICENSE_KEY=...` | proxy | Calls the hosted proxy at `https://api.biztalkmigrate.com/v1`. System prompt on server side. |

All modes produce the same output structure. Claude failures are non-fatal — the runner falls back to the partial intent rather than stopping.

---

## CLI Reference

```
biztalk-migrate <command> [options]

Commands:
  run         ★ Full pipeline in one command: parse → reason → build → validate → report
  analyze     Parse BizTalk artifacts and produce a complexity + pattern report
  build       Build a Logic Apps Standard deployment package from a migration spec
  convert     Convert a single BizTalk .btm map to Logic Apps format (LML/XSLT)
  templates   List available workflow templates (Premium)

run options:
  --dir <path>          Directory containing BizTalk artifacts (.odx, .btm, .btp, etc.)  [required]
  --app <name>          BizTalk application name                                           [required]
  --output <dir>        Output directory for generated Logic Apps project  [default: ./logic-apps-output]
  --skip-enrichment     Skip Claude AI enrichment (offline/dev mode)

analyze options:
  --app <name>      Application name
  --dir <path>      Directory containing BizTalk artifacts
  --bindings <file> Path to BindingInfo.xml
  --out <file>      Output file for migration spec JSON  [default: migration-spec.json]
  --verbose         Show detailed output

Global options:
  --license <key>   License key (overrides BTLA_LICENSE_KEY env var)
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

## GitHub Actions

The repo ships `.github/workflows/biztalk-migrate.yml` — a `workflow_dispatch` action that runs the full migration pipeline in CI and produces a downloadable Logic Apps package + job summary report.

### Setup

1. Add `BTLA_LICENSE_KEY` to your repo's **Settings → Secrets and variables → Actions**
2. Optionally add `ANTHROPIC_API_KEY` for direct Claude enrichment
3. Commit your BizTalk artifacts to the repo (e.g. under `artifacts/`)

### Run

Go to **Actions → BizTalk to Logic Apps Migration → Run workflow**, then fill in:

| Input | Description | Example |
|---|---|---|
| `artifact_dir` | Path to artifacts in the repo | `artifacts/CustomerOnboarding` |
| `app_name` | BizTalk application name | `CustomerOnboarding` |
| `output_dir` | Output path (relative) | `logic-apps-output` |

### Output

- **Artifacts** — downloadable ZIP of the Logic Apps project (retained for 30 days)
- **Job Summary** — `migration-report.md` rendered directly in the Actions UI

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

### Available MCP Tools (34 total)

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

#### File & Intent Tools

| Tool | Tier | Description |
|---|---|---|
| `read_artifact` | Free | Read a `.odx`/`.btm`/`.btp`/`.xml`/`.xsd` file from disk |
| `list_artifacts` | Free | Scan a directory and return categorized artifact inventory |
| `construct_intent` | Standard | Mechanical `BizTalkApplication` → partial `IntegrationIntent` bridge; marks ambiguous values `TODO_CLAUDE` |

#### Validation & Quality Tools

| Tool | Tier | Description |
|---|---|---|
| `validate_intent` | Free | Validate an `IntegrationIntent` for structural + semantic correctness |
| `validate_workflow` | Free | Validate `workflow.json` against 29 WDL rules (errors / warnings / suggestions) |
| `validate_connections` | Free | Validate `connections.json` — @AppSetting references, no orphan connections |
| `validate_package` | Standard | Cross-file validation: workflow + connections + app settings coverage |
| `score_migration_quality` | Standard | Rate output quality 0–100 (grade A–F) across 4 dimensions |

### MCP Resources (on-demand reference knowledge)

The server exposes 8 resources that Claude reads during complex migrations when it needs deep reference material. These are fetched on-demand and do not inflate context on every call.

| URI | Content |
|---|---|
| `biztalk://reference/component-mapping` | Full BizTalk shape → Logic Apps action mapping table |
| `biztalk://reference/connector-mapping` | All 30+ adapter → connector mappings with configuration notes |
| `biztalk://reference/expression-mapping` | XLANG/s → WDL expression translation reference |
| `biztalk://reference/pattern-mapping` | Enterprise integration pattern mapping with generated equivalents |
| `biztalk://reference/gap-analysis` | All gap definitions with mitigations and effort estimates |
| `biztalk://schema/decision-trees` | Machine-readable SKU/connector/transform decision data |
| `biztalk://examples/simple-file-receive` | Training pair: ODX + binding → IntegrationIntent → workflow.json |
| `biztalk://examples/content-based-routing` | Training pair: DecisionShape + XLANG/s → If action + WDL expression |

### Claude-Powered Migration Pipeline

When Claude has the MCP server connected, it follows a **5-step protocol** (defined in `CLAUDE.md` and embedded in the `guided_migration` prompt) that achieves 90%+ accurate Logic Apps output:

```
Step 1 — PARSE
  read_artifact / list_artifacts → analyze_orchestration, analyze_map,
  analyze_bindings, analyze_pipeline → BizTalkApplication
  assess_complexity + detect_patterns

Step 2 — REASON  ← Claude's brain (the critical step)
  construct_intent → partial IntegrationIntent with TODO_CLAUDE markers
  Claude translates XLANG/s expressions, selects error strategy,
  fills connector configs → validate_intent to self-check

Step 3 — SCAFFOLD
  generate_gap_analysis + generate_architecture → presents migration plan
  On approval: build_package → first-pass Logic Apps package

Step 4 — REVIEW & ENRICH
  Claude reviews workflow.json: fixes expressions, replaces TODO markers,
  adds retry policies, error scopes, diagnostic metadata

Step 5 — VALIDATE
  validate_workflow + validate_connections → fix any errors
  score_migration_quality → reports grade (target: B or higher, ≥75/100)
```

To start a guided migration in Claude, use the `/guided_migration` prompt:

```
[Use the MCP prompt] guided_migration
  applicationName: "CustomerOnboarding"
  artifactCount: "12"
```

Claude will guide you through each step, asking for artifacts one at a time and showing you the migration spec before generating any code.

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
| **BizTalk Migrate: Run Migration** | ★ One-command pipeline: folder picker → full migration → opens report |
| **BizTalk Migrate: Analyze File** | Analyze the currently open .odx/.btm/.btp file |
| **BizTalk Migrate: Analyze Directory** | Run Stage 1 analysis on a selected folder |
| **BizTalk Migrate: Build Logic Apps Package** | Build a Logic Apps package from a migration-spec.json |
| **BizTalk Migrate: Open Migration Dashboard** | Open the migration dashboard WebView panel |
| **BizTalk Migrate: Start MCP Server** | Manually start the MCP server process |
| **BizTalk Migrate: Create Workflow from Description (Premium)** | NLP greenfield design flow |
| **BizTalk Migrate: Browse Template Library (Premium)** | Open the template browser panel |

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

| Fixture | BizTalk Pattern | Key Migration Challenge | Golden Master |
|---|---|---|---|
| `01-map-scripting-functoids/` | BTM map with C# scripting functoids | `msxsl:script` C# blocks → not supported in Logic Apps XSLT | — |
| `02-simple-file-receive/` | Linear: Receive → Transform → Send (FILE) | FILE adapter → Blob trigger; shapes → Compose + Transform | ✅ |
| `03-content-based-routing/` | DecisionShape with XLANG/s `||` expression | Decide → If; `||` / `&&` → WDL `or` / `and` | ✅ |

Fixtures with golden masters include a `training-pair.json` (full BizTalk→Intent→LogicApps example) and `expected-logic-apps/` (hand-crafted reference output used by the golden-master test suite).

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
npm test                # run all 202 tests (unit + integration + golden-master + regression)
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
│   ├── complexity-scorer.ts       ← Complexity score + classification
│   └── intent-constructor.ts      ← BizTalkApplication → partial IntegrationIntent (TODO_CLAUDE bridge)
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
│   ├── server.ts                  ← MCP stdio transport, 34 tools, 8 resources
│   ├── tools/
│   │   ├── definitions.ts         ← Tool definitions (34 tools, tier-gated)
│   │   ├── handler.ts             ← Tool call dispatch
│   │   ├── schemas.ts             ← Zod validation schemas
│   │   └── file-tools.ts          ← readArtifact() + listArtifacts() implementations
│   └── prompts/
│       └── migration-guide.ts     ← 5 guided prompts with 5-step chain protocol
│
├── validation/
│   ├── workflow-validator.ts      ← 29 WDL rules (14 errors, 7 warnings, 8 suggestions)
│   ├── connections-validator.ts   ← 6 connection rules
│   ├── package-validator.ts       ← Cross-file validation
│   ├── quality-scorer.ts          ← 0-100 quality scoring (grades A-F)
│   └── index.ts                   ← Barrel exports
│
├── runner/
│   ├── types.ts                   ← MigrationRunOptions, MigrationRunResult, enrichment types
│   ├── claude-client.ts           ← Tri-mode Claude client (dev / direct / proxy)
│   ├── migration-runner.ts        ← runMigration() — 5-step pipeline engine
│   ├── report-generator.ts        ← Generates migration-report.md
│   ├── output-writer.ts           ← Writes Logic Apps project layout to disk
│   └── index.ts                   ← Barrel exports
│
├── cli/
│   └── index.ts                   ← CLI entry point (run / analyze / build / convert / templates)
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

docs/
├── proxy-api-spec.md            ← REST API contract for the hosted proxy service (POST /v1/enrich, /v1/review)
└── reference/
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
│   │   ├── training-pair.json       ← BizTalk → IntegrationIntent → LogicApps trio
│   │   └── expected-logic-apps/     ← Golden master workflow.json + connections.json
│   └── 03-content-based-routing/
│       ├── training-pair.json
│       └── expected-logic-apps/
├── unit/                        ← Unit tests (10 suites, ~110 tests)
├── integration/
│   └── pipeline.test.ts         ← Stage 1 → 2 → 3 pipeline tests (50 tests)
├── golden-master/
│   ├── comparison-engine.ts     ← 3-level diff: exact / semantic / topology
│   └── golden-master.test.ts    ← Fixture discovery + 80% similarity threshold
└── regression/
    ├── quality-baseline.json    ← Baseline quality scores per fixture
    ├── regression-runner.test.ts ← Quality regression guard (2-point tolerance)
    └── snapshot.test.ts         ← Vitest snapshots for deterministic Stage 1/2 outputs
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

For consultant seat pricing, contact **[Me@Jonlevesque.com](mailto:Me@Jonlevesque.com)**.

---

## Usage Guide

This section walks through a complete migration engagement — from first connection to a deployable Logic Apps package.

### Before You Start

**What you need:**

- Node.js 20 or later (`node --version`)
- Claude Desktop or VS Code + Claude Code
- Your BizTalk application's export files (`.odx`, `.btm`, `.btp`, `BindingInfo.xml`)
- A license key for Standard or Premium features (free tier gives Stage 1 + Stage 2 only)

**How to export BizTalk artifacts:**

1. Open BizTalk Administration Console
2. Right-click the application → **Export** → **MSI file**
3. From the extracted MSI, locate the Visual Studio project folders — `.odx`, `.btm`, `.btp` files are in the VS project
4. For binding XML: right-click the application → **Export** → **Bindings** → save as `BindingInfo.xml`

---

### Connect to Claude

#### Option A: Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "biztalk-migration": {
      "command": "node",
      "args": ["/absolute/path/to/BiztalktoLogicapps/dist/mcp-server/server.js"],
      "env": {
        "BTLA_LICENSE_KEY": "your-license-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. You should see "biztalk-migration" in the MCP tools panel (hammer icon).

**Verify it's connected:** Ask Claude: *"What BizTalk migration tools are available?"* — it should list tools like `analyze_orchestration`, `build_package`, etc.

#### Option B: VS Code with Claude Code

The repo already includes `.vscode/mcp.json`. Open the repo folder in VS Code and Claude Code connects automatically.

Set your license key in one of:
- VS Code setting: `biztalkMigrate.licenseKey`
- Shell environment: `export BTLA_LICENSE_KEY="your-key"` (add to `~/.zshrc` or `~/.bashrc`)
- `.env` file in the project root (not committed)

---

### Run a Migration

#### 1. Start the guided prompt

In Claude, invoke the `guided_migration` prompt. This loads a pre-built conversation starter that instructs Claude to follow the 5-step migration protocol.

**In Claude Desktop:** Click the prompt icon (or type `/`) and select `guided_migration`. Fill in:
- `applicationName` — e.g. `CustomerOnboarding`
- `artifactCount` — approximate number of files (optional)

**In Claude Code:**
```
Use the guided_migration prompt with applicationName="CustomerOnboarding"
```

Claude responds with the 5-step plan and asks for the first artifact.

#### 2. Provide artifacts

Claude asks for artifacts one at a time. Two ways to provide them:

**Paste XML directly** (for small files or when working remotely):
```xml
<!-- Paste the full content of ProcessOrder.odx here -->
<BizTalkServerProject>
  <Module>...</Module>
</BizTalkServerProject>
```

**Provide a directory path** (when Claude has local filesystem access — VS Code recommended):
```
The artifacts are at /Users/me/projects/CustomerOnboarding/src/BizTalk/
```
Claude calls `list_artifacts` to discover all files, then `read_artifact` for each one.

**Typical order:** orchestrations (`.odx`) → binding XML → maps (`.btm`) → pipelines (`.btp`). Provide what you have — missing types are noted in the gap analysis.

#### 3. Review the migration spec

After all artifacts are analyzed, Claude shows you the **migration specification** before generating any code:

```
Complexity: Moderate (score: 34/100)
Hot spots: 2 scripting functoids, 1 long-running scope

🔴 CRITICAL: Long-running transaction (ScopeShape with LongRunning)
   → Mitigation: Saga/compensation pattern using child workflows
   → Effort: 3–5 days

🟡 MEDIUM: Scripting functoid (ProcessMap.btm — CalculateDiscount)
   → Mitigation: Rewrite as Azure Function or standard XSLT template
   → Effort: 1 day

Architecture: Logic Apps Standard (cloud)
Required: Azure Blob Storage, Azure Service Bus
Integration Account: Not required
Estimated workflows: 2
```

Review this before approving — the spec is cheap to fix, the generated JSON is not. When satisfied: **"Looks good — go ahead and build the package."**

#### 4. Generate the package

Claude calls `build_package`, assembles the project, then reviews its own output:

1. Fills any `TODO_CLAUDE` placeholders
2. Translates XLANG/s expressions to WDL `@{...}` syntax
3. Adds retry policies to HTTP actions
4. Wraps the main flow in an error-handling Scope

Output artifacts appear in the conversation: `workflow.json`, `connections.json`, `local.settings.json`.

#### 5. Validate and score

Claude runs validation and scoring automatically. You can also ask explicitly:

```
Please validate the workflow and score the migration quality.
```

Example output:
```
Errors (fix before deployment):
  ✗ runafter-case: "Send_To_Queue" runAfter value "Succeeded" must be "SUCCEEDED"

Warnings:
  ⚠ retry-policy-missing: HTTP action "Call_API" has no retryPolicy

Quality Score: 82/100 — Grade B
  Structural:     38/40
  Completeness:   26/30 — missing retry on 1 HTTP action
  Best Practices: 16/20 — no tracked properties
  Naming:          2/10 — connections don't follow CN- convention
```

Target **grade B (≥75/100)** before handing off to the customer. Ask Claude to fix any flagged issues.

---

### Deploy the Output

#### Azure Portal (quickest for evaluation)

1. Create a **Logic Apps Standard** resource (not Consumption)
2. Go to **Deployment Center** → **Advanced**
3. Upload the generated package as a ZIP

#### VS Code Logic Apps Extension (recommended for development)

1. Install the **Azure Logic Apps (Standard)** VS Code extension
2. Open the generated project folder
3. Right-click the Logic App → **Deploy to Logic App**
4. Fill in App Settings from `local.settings.json`

#### Azure CLI / Bicep (recommended for production)

```bash
az deployment group create \
  --resource-group rg-integration-prod \
  --template-file infra/main.bicep \
  --parameters @infra/parameters.json

az logicapp deployment source config-zip \
  --resource-group rg-integration-prod \
  --name LAStd-Finance-AP-Prod \
  --src ./logic-apps-package.zip
```

#### Filling in App Settings

`local.settings.json` uses placeholder references:

```json
{
  "Values": {
    "KVS_DB_ServiceBus_ConnectionString": "@AppSetting('KVS_DB_ServiceBus_ConnectionString')",
    "Common_API_Sftp_Host": "sftp.example.com"
  }
}
```

- **`KVS_` prefix** → store the real value in **Azure Key Vault** and set the App Setting to a Key Vault reference: `@Microsoft.KeyVault(VaultName=my-vault;SecretName=ServiceBus-ConnectionString)`
- **`Common_` prefix** → non-sensitive values (hostnames, ports) set directly as App Settings

---

### Greenfield NLP Mode (Premium)

Build a new Logic Apps workflow from a plain English description — no BizTalk source needed.

**Guided design (shows architecture review before building):**

```
Use the guided_greenfield prompt with description="Poll an SFTP server every 15 minutes,
pick up new XML order files, validate, transform to JSON, POST to our order API,
and if it fails send an alert email to ops@example.com"
```

Claude shows connector choices, required Azure services, cost estimate, and clarifying questions before building.

**Quick build** (skip design review for simple, unambiguous requirements):

```
Use the quick_workflow_build prompt with description="..."
```

**Browse templates:**

```
List the available Logic Apps templates, filter by category "file-processing"
```

---

### Validation Reference

Ask Claude to run any validation explicitly:

| What to check | Say to Claude |
|---|---|
| Workflow errors | "Validate this workflow.json" + paste content |
| Connections file | "Validate my connections.json" |
| Full package cross-check | "Run a full package validation" |
| IntegrationIntent correctness | "Validate this IntegrationIntent" + paste JSON |
| Quality score | "Score this workflow quality" + paste workflow.json |

**Key WDL rules enforced:**

- `runAfter` values must be `"SUCCEEDED"`, `"FAILED"`, `"TIMEDOUT"`, `"SKIPPED"` — ALL CAPS
- Every action needs a `runAfter` key (`{}` for first action after trigger)
- No cycles in the runAfter dependency graph
- ServiceProvider actions need `serviceProviderConfiguration` with `connectionName`, `operationId`, `serviceProviderId`
- Sensitive values must use `@AppSetting('...')` — never hardcoded

---

### Quality Scoring

| Dimension | Weight | What it checks |
|---|---|---|
| Structural | 40 pts | Valid JSON, schema URL, triggers, runAfter ALL CAPS, no cycles, ServiceProvider configs |
| Completeness | 30 pts | Error handling scope, retry policies on HTTP actions, terminate on failure |
| Best Practices | 20 pts | Built-in connectors preferred, tracked properties, KVS_ for secrets |
| Naming | 10 pts | PascalCase action names, CN- prefix for connections |

| Grade | Score | Meaning |
|---|---|---|
| A | ≥90 | Deployment-ready, all best practices followed |
| B | 75–89 | Ready to deploy; minor improvements recommended |
| C | 60–74 | Deployable but needs review before production |
| D | 40–59 | Significant issues — address before deployment |
| F | <40 | Structural problems — likely won't deploy |

---

### Common Issues

**"License validation failed" — running in free tier**

Check that `BTLA_LICENSE_KEY` is set in the MCP server config. Free tier covers Stage 1 and Stage 2 only. Stage 3 (generate workflow.json) requires Standard or above.

**"Unknown tool: construct_intent" or similar**

Rebuild and restart: `npm run build`, then restart Claude Desktop or reload the VS Code window.

**Workflow deploys but triggers don't fire**

The `connectionName` in `workflow.json` (`serviceProviderConfiguration.connectionName`) must match the key in `connections.json` (`serviceProviderConnections`) exactly — case-sensitive.

**runAfter errors in VS Code Logic Apps designer**

Every action name in a `runAfter` object must exactly match a real action name in the same workflow (case-sensitive, space-sensitive).

**XSLT fails with "msxsl:script not supported"**

BizTalk scripting functoids produce `<msxsl:script>` C# blocks, which Logic Apps Transform XML does not support. The map converter flags these as `xslt-rewrite` or `azure-function`. Either rewrite the C# logic as standard XSLT `<xsl:template>` transforms, or extract it to an Azure Function.

**"TODO_CLAUDE" in generated workflow.json**

Claude couldn't automatically translate a value (e.g. a complex XLANG/s expression). Ask it to fill the markers in:

```
Please fill in the TODO_CLAUDE placeholders. The Decide shape expression was:
[paste original XLANG/s condition]
```

**Migration spec has wrong adapter type or missing transformation**

Correct it before approving:

```
The binding file shows FTP, not FILE. Address is ftp://files.example.com/orders/
Please update the migration spec.
```

**Loop conditions are inverted**

BizTalk LoopShape runs *while* the condition is true; Logic Apps Until runs *until* it is true. Generated Until actions invert the expression automatically — review all loop conditions, especially those with `&&` / `||` (De Morgan's law applies).

---

### Tips for Complex Applications

- **Large applications (5+ orchestrations):** analyze one orchestration at a time, get the gap analysis for each before building
- **Sequential convoy patterns:** ensure your Service Bus queue has sessions enabled before deployment
- **Custom pipeline components:** no automatic equivalent — flag early, plan manual work with the customer
- **Long-running scopes with compensation:** needs a Saga/child-workflow redesign — get customer sign-off before building
- **EDI applications:** always require an Azure Integration Account (B1 or B2 tier) — budget for provisioning before the build phase

---

## Support

Questions, issues, or consultant seat pricing: **[Me@Jonlevesque.com](mailto:Me@Jonlevesque.com)**
