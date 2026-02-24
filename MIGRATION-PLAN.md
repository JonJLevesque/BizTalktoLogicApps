# BizTalk to Logic Apps Migration Framework
## Project Plan & Architecture

> **Purpose**: This document is the master reference for building a commercial-grade dual-mode platform: (A) LLM-assisted migration of Microsoft BizTalk Server to Azure Logic Apps Standard, and (B) greenfield Logic Apps workflow generation from natural language (NLP). It captures all research, architectural decisions, and implementation sequencing.
>
> **Market Window**: BizTalk Server extended support ends October 2028. Every enterprise running BizTalk must migrate (~2.5 year window). The NLP greenfield builder extends the product's value beyond that window into ongoing Logic Apps development.
>
> **Last updated**: 2026-02-23 — Added NLP Greenfield Mode (Mode B, Premium tier); added Sample Collection workflow (Kent's suggestion) with reference fixtures from Sandro Pereira (sandroasp)

---

## Table of Contents

1. [Strategic Overview](#1-strategic-overview)
   - 1a. [Dual-Mode Architecture](#1a-dual-mode-architecture)
2. [Source Material Studied](#2-source-material-studied)
3. [Three-Stage Architecture](#3-three-stage-architecture)
   - 3b. [NLP Greenfield Pipeline (Premium Tier)](#3b-mode-b-nlp-greenfield-pipeline-premium-tier)
   - 3c. [Sample Collection Workflow](#3c-sample-collection-workflow)
4. [Language & Format Fluency](#4-language--format-fluency)
5. [Data Privacy Architecture](#5-data-privacy-architecture)
6. [Licensing & Distribution](#6-licensing--distribution)
7. [Implementation Phases](#7-implementation-phases)
8. [Project Directory Structure](#8-project-directory-structure)
9. [BizTalk Architecture Reference](#9-biztalk-architecture-reference)
10. [Logic Apps Architecture Reference](#10-logic-apps-architecture-reference)
11. [Component Mapping Overview](#11-component-mapping-overview)
12. [Integration Pattern Mapping](#12-integration-pattern-mapping)
13. [Gap Analysis](#13-gap-analysis)
14. [MCP Tool Inventory](#14-mcp-tool-inventory)
15. [Verification Plan](#15-verification-plan)

---

## 1. Strategic Overview

This is **not** a mechanical 1:1 translation tool. The core philosophy is:

> **The LLM must understand the BUSINESS INTENT of a BizTalk workflow — what it does, why it exists, what problem it solves — and then produce idiomatic Logic Apps that achieve the same outcome in the cloud-native way.**

The BizTalk understanding phase is about understanding what the integration *was* and *did*. The Logic Apps build phase is about achieving that same goal in the most appropriate Azure-native manner.

### Why This Approach Matters

BizTalk and Logic Apps are architecturally different platforms:
- BizTalk: **MessageBox pub/sub**, Windows services, SQL Server as runtime database, on-premises
- Logic Apps: **Event-driven workflow engine**, serverless/cloud, JSON-defined, Azure-hosted

A mechanical translation produces working-but-wrong Logic Apps. For example:
- A BizTalk convoy pattern (correlated sequential messages) should become Service Bus sessions, not a manually-correlated workflow
- A BizTalk Scatter-Gather should become Logic Apps parallel branches with aggregation, not separate triggered workflows
- BizTalk dehydration/rehydration is built into Logic Apps stateful workflows — it doesn't need to be modeled explicitly

### Key Business Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Implementation language | TypeScript | Aligns with logicapps-mcp MCP server ecosystem |
| Primary output format | Logic Apps JSON (WDL) | This IS Logic Apps — the workflow IS the JSON |
| Data privacy | 100% local processing | Customer IP never leaves consultant's machine |
| Licensing | Upfront + monthly subscription | Point-in-time tool for a 2.5-year market window |
| Distribution | VS Code Extension + CLI | Interactive use + automation/batch use |
| Target SKU | Logic Apps Standard | Enterprise-grade, VNET, multi-workflow per app |
| NLP greenfield | Premium tier add-on | Extends revenue beyond BizTalk migration window |

---

## 1a. Dual-Mode Architecture

The product operates in two modes that share a common output engine (the Build stage):

```
MODE A: MIGRATION (BizTalk → Logic Apps)          [Standard + Premium]
  BizTalk XML artifacts
       │
       ▼
  [UNDERSTAND]  Parse .odx/.btm/.btp/bindings, identify business intent
       │
       ▼
  [DOCUMENT]    Migration spec, gap analysis, architecture recommendation
       │
       ▼
  [BUILD] ──────────────────────────────────────────────────────────────┐
                                                                        │
MODE B: GREENFIELD NLP (Natural Language → Logic Apps) [Premium only]  │
  "I need a workflow that..."                                           │
       │                                                                │
       ▼                                                                │
  [INTERPRET]   Extract IntegrationIntent from natural language         │
       │                                                                │
       ▼                                                                │
  [DESIGN]      Architecture spec + clarifying questions                │
       │                                                                │
       └──────────────────── SHARED ENGINE ────────────────────────────┘
                                    │
                                    ▼
                         IntegrationIntent object
                         (same structure regardless of source)
                                    │
                                    ▼
                    workflow.json + maps + connections.json
                    + host.json + ARM/Bicep + unit tests
                    + deployment package
```

**The IntegrationIntent** is the convergence point. Both modes produce the same intermediate representation — structured description of what the integration does, what systems are involved, what data flows, and how errors are handled. The Build stage consumes this and generates Logic Apps artifacts.

### IntegrationIntent Structure

```typescript
interface IntegrationIntent {
  trigger: {
    type: 'polling' | 'webhook' | 'schedule' | 'manual';
    source: string;          // "SFTP server", "Service Bus queue"
    connector: string;       // "sftp", "serviceBus", "request"
    config: Record<string, unknown>;
  };
  steps: IntegrationStep[];  // ordered processing steps
  errorHandling: {
    strategy: 'retry' | 'dead-letter' | 'compensate' | 'terminate' | 'notify';
    retryPolicy?: { count: number; interval: string; type: 'fixed' | 'exponential' };
    deadLetterTarget?: string;
    notificationTarget?: string;
  };
  systems: Array<{
    name: string;
    protocol: string;        // "SFTP", "HTTP/REST", "Service Bus"
    role: 'source' | 'destination' | 'intermediate' | 'error-handler';
    authentication: string;
  }>;
  dataFormats: {
    input: string;           // "CSV", "XML", "JSON", "EDI"
    output: string;
    schemas?: Record<string, object>;
  };
  patterns: string[];        // detected integration patterns
  metadata: {
    source: 'biztalk-migration' | 'nlp-greenfield';
    complexity: 'simple' | 'moderate' | 'complex';
    estimatedActions: number;
    requiresIntegrationAccount: boolean;
  };
}
```

### License Tiers

| Feature | Free (Eval) | Standard | Premium |
|---|---|---|---|
| Stage 1: Understand/Analyze | ✓ | ✓ | ✓ |
| Stage 2: Document/Spec | ✓ | ✓ | ✓ |
| Stage 3: Build (Migration) | ✗ | ✓ | ✓ |
| Batch processing | ✗ | ✓ | ✓ |
| Logic Apps deployment tools | ✗ | ✓ | ✓ |
| **NLP Greenfield Builder** | ✗ | ✗ | **✓** |
| **Iterative NLP refinement** | ✗ | ✗ | **✓** |
| **Template library** | ✗ | ✗ | **✓** |
| **Schema inference** | ✗ | ✗ | **✓** |

**Strategic value**: Standard tier captures the BizTalk migration wave (2026-2028). Premium tier captures ongoing Logic Apps development after migrations complete — a retention play that extends product revenue indefinitely.

---

## 2. Source Material Studied

### Open Source Repositories

#### logicapps-mcp (laveeshb)
- **Type**: TypeScript MCP server
- **Purpose**: Manages Azure Logic Apps workflows via AI assistants (40 tools)
- **Architecture**: MCP SDK + ARM REST API + Workflow Management API
- **Provides**: MCP server architecture patterns, ARM API client, tool definitions, knowledge base system, authentication model, TypeScript types for Logic Apps
- **Key insight**: Dual-SKU support (Consumption + Standard), LRU caching, passthrough token auth

#### BizTalkMigrationStarter (haroldcampos) — v2.0, Feb 2026
- **Type**: C# .NET 4.7.2 toolkit
- **Purpose**: Converts .odx/.btm/.btp files to Logic Apps workflows
- **Architecture**: 6-layer pipeline (Parse → Bind → Map → Express → Generate → Validate)
- **Provides**: 47 connector mappings, 38+ shape parsers, 60+ functoid translations, pattern detection, refactoring strategies, connector registry JSON
- **Key projects**: ODXtoWFMigrator, BTMtoLMLMigrator, BTPtoLA, BizTalktoLogicApps.MCP

#### logicapps-unittest-custom-agent (wsilveiranz) — Jan 2026
- **Type**: GitHub Copilot custom agent profiles
- **Purpose**: Unit test generation for Logic Apps Standard workflows and Data Maps
- **Architecture**: 6-phase spec-first methodology (Discover → Spec → Cases → Data → Implement → Batch)
- **Technology**: MSTest on .NET 8, Automated Test SDK, DataMapTestExecutor
- **Provides**: Testing patterns for both LML and XSLT maps, workflow unit test scaffolding

### Microsoft Documentation Studied

- BizTalk Server full architecture (MessageBox, pub/sub engine, runtime, adapters, pipelines, orchestrations, BRE, BAM, SSO)
- Azure Logic Apps (Consumption vs Standard, WDL schema, connectors, enterprise integration, B2B/EDI, error handling, limits)

### Blog Posts Read

- "A BizTalk Migration Tool from Orchestrations to Logic Apps Workflows" — Harold Campos, Feb 2026
- "Introducing Unit Test Agent Profiles for Logic Apps & Data Maps" — Wagner Silveira, Jan 2026

---

## 3. Three-Stage Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MIGRATION PIPELINE                           │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   STAGE 1    │    │   STAGE 2    │    │     STAGE 3      │  │
│  │  UNDERSTAND  │───▶│   DOCUMENT   │───▶│      BUILD       │  │
│  │              │    │              │    │                  │  │
│  │ Parse BizTalk│    │ Migration    │    │ Logic Apps JSON  │  │
│  │ artifacts    │    │ specification│    │ workflow.json    │  │
│  │              │    │              │    │ maps, ARM, tests │  │
│  │ Identify     │    │ Gap analysis │    │                  │  │
│  │ business     │    │              │    │ Deployment       │  │
│  │ intent       │    │ Risk         │    │ package          │  │
│  │              │    │ assessment   │    │                  │  │
│  │ Detect       │    │              │    │                  │  │
│  │ patterns     │    │ Architecture │    │                  │  │
│  │              │    │ recommendation   │                  │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
        │                     │                      │
   INPUT: .odx            OUTPUT: .md           OUTPUT: JSON
   .btm .btp              Markdown spec         workflow.json
   binding XML            with intent           + maps + ARM
   XSD schemas            summary               + tests
```

### Stage 1: UNDERSTAND

The LLM analyzes BizTalk artifacts to comprehend **what the integration does and why**.

**Inputs**: .odx, .btm, .btp, BindingInfo.xml, XSD schemas

**Analysis performed**:
- Parse all XML artifact formats and extract structure
- Identify the business process goal in plain English
- Detect enterprise integration patterns (convoy, scatter-gather, CBR, aggregation, pub/sub, request-reply)
- Catalog all external systems, protocols, data formats, endpoints
- Identify error handling strategy, transaction boundaries, compensation logic
- Trace correlation sets to understand message routing relationships
- Classify migration complexity: Simple / Moderate / Complex / Requires-Redesign

**Complexity Classification**:
| Level | Criteria |
|---|---|
| Simple | Single trigger, linear flow, no correlation, standard adapter |
| Moderate | Decision shapes, basic error handling, standard functoids |
| Complex | Convoy patterns, scatter-gather, long-running transactions, BRE |
| Requires-Redesign | Multiple activating receives, MSDTC, custom pipeline components, complex compensation |

### Stage 2: DOCUMENT

The LLM produces a **structured migration specification** in Markdown format.

**Contents**:
- Executive summary: what this BizTalk application does (non-technical)
- Business intent: the integration problem being solved
- Component inventory: all artifacts with their roles
- Data flow diagram: source system → transformations → destination system
- Integration pattern identification with confidence scores
- Component-by-component migration mapping
- Gap analysis: what can't be directly migrated and recommended mitigations
- Risk assessment with severity ratings
- Target Logic Apps architecture recommendation
- Estimated effort and manual intervention points

### Stage 3: BUILD

The LLM generates **valid, deployable Logic Apps JSON** and supporting artifacts.

**Primary output — workflow.json** (Logic Apps Standard):
- Valid against WDL schema `2016-06-01`
- Correct trigger type (polling vs webhook, based on source adapter)
- Proper `runAfter` chains (action dependency sequencing)
- WDL expressions translating XLANG/s logic
- Scope nesting for error handling
- Variable declarations matching BizTalk orchestration variables
- ServiceProvider-based built-in connector configs

**Additional outputs**:
- Maps: XSLT stylesheets or LML (YAML) for Data Mapper
- connections.json: API connection definitions for managed connectors
- host.json: Runtime configuration for Logic Apps Standard
- ARM/Bicep templates: Infrastructure-as-code
- Unit test specifications: MSTest scaffolding
- Deployment package: Complete zip-deployable set

---

---

## 3b. Mode B: NLP Greenfield Pipeline (Premium Tier)

### Stage G1: INTERPRET

The LLM parses a free-form natural language description and extracts a structured `IntegrationIntent`.

**Example input**:
> "I need a workflow that monitors an SFTP server for new CSV files every 5 minutes. When a file arrives, parse the CSV, validate each row has a valid email address, transform the records into our CRM JSON format, and POST them to our API. If any row fails validation, collect the failures and email a summary to ops@company.com. If the API is down, retry 3 times then dead-letter to a Service Bus queue."

**Extracted intent**:
- Trigger: SFTP polling, 5-minute interval, file type CSV
- Flow: SFTP → CSV Parse → Row Validation → Transform → HTTP POST
- Error handling (row): collect failures → email summary
- Error handling (API): retry 3x exponential → Service Bus dead-letter
- Systems: SFTP, REST API, SMTP, Service Bus
- Patterns: batch-processing, error-aggregation, dead-letter, retry-with-fallback

### Stage G2: DESIGN

Produces an architecture specification **before** generating code. Asks clarifying questions if the description is ambiguous:
- "You mentioned 'our CRM format' — can you describe the fields?"
- "Should the email notification go out per-file or as a daily digest?"
- "What authentication does the REST API use?"

Design output includes: connector selection with reasoning, workflow outline, schema design, cost implications.

### Stage G3: BUILD (shared with Mode A)

Same `workflow-generator.ts` and supporting modules. Same output format.

### NLP-Specific Modules (`src/greenfield/`)

| Module | Responsibility |
|---|---|
| `nlp-interpreter.ts` | Natural language → IntegrationIntent |
| `schema-inferrer.ts` | Derive JSON schemas from prose |
| `connector-recommender.ts` | Select best connectors for described systems |
| `design-generator.ts` | Architecture spec + clarifying questions |
| `template-library.ts` | Common pattern templates as starting accelerators |
| `refinement-engine.ts` | "Also add a step to log to Cosmos DB" → modify existing workflow |

---

## 3c. Sample Collection Workflow

> **Kent's Suggestion**: At the start of every migration engagement, ask the consultant to provide sample test data — real or representative input messages, the expected output messages, and any transformation logic. This establishes a verified baseline for the entire migration.

### Why Sample Data Matters

Collecting samples at engagement kickoff provides three critical benefits:

1. **LLM Grounding**: Real examples of the data shapes and business logic specific to *this* integration give the LLM precise context. Instead of abstractly analyzing schemas, it can see actual values, edge cases, and business semantics.

2. **Migration Baseline**: The consultant can run the original BizTalk integration against the sample inputs and capture the actual outputs. These become the **golden master** — the exact behavior the Logic Apps replacement must replicate.

3. **Round-Trip Validation**: After generating Logic Apps artifacts, the same sample inputs are run through the new Logic Apps workflow. Output must match the golden master. No match = migration defect.

### The Fixture Trio Pattern

Every migration fixture follows this structure (from Sandro Pereira's BizTalk map testing methodology):

```
fixture-name/
├── input/              ← Sample input message(s) — what BizTalk received
├── transform/          ← The BizTalk artifact (XSLT compiled from .btm, .btm source, .odx)
├── expected-output/    ← Actual output captured from the BizTalk integration (golden master)
└── schemas/            ← XSD schemas for input and output (if available)
```

### What to Ask Consultants

The tool should prompt consultants at engagement start:

| Question | What It Captures |
|---|---|
| "Do you have sample XML/JSON messages this integration processes?" | Input data shapes and namespaces |
| "Can you run these through BizTalk and capture the actual outputs?" | Golden master output |
| "Do you have any unit or integration tests from the original project?" | Existing test data |
| "Are there UAT test cases with expected outcomes?" | Business rule validation |
| "For EDI integrations: can you share sample X12/EDIFACT messages?" | EDI format specifics |
| "Are there edge cases you know about — nulls, empties, large batches?" | Boundary condition coverage |

### Reference Fixtures

The `tests/fixtures/` directory contains reference fixtures based on real BizTalk patterns:

| Fixture | Pattern | Source |
|---|---|---|
| `01-map-scripting-functoids/` | BTM map with C# scripting functoids (name concat, age calc, billing segregation) | Sandro Pereira (sandroasp) — Azure MVP |
| `02-simple-file-receive/` | Receive order → Transform → FILE output (simple linear orchestration) | Common BizTalk onboarding pattern |
| `03-content-based-routing/` | Decide shape routing by priority/value (XLANG/s expression → If action) | Core CBR pattern |

### Sample Data Quality Guidelines

- **Real > synthetic**: Prefer real data (anonymized/masked) — synthetic data misses semantic edge cases
- **Edge cases**: Include at least one "normal" case and one "edge" case per integration
- **Optional fields**: Include a case where optional fields are absent (tests null/empty handling)
- **Error paths**: If BizTalk has error handling (Catch, compensation), include a sample that triggers it
- **Volume**: 3–5 samples per integration is sufficient; 1 is the minimum
- **Schema alignment**: Samples must validate against the XSD schemas in the project

### Impact on Build Quality

With good sample data, Stage 3 (Build) can:
- Validate generated WDL expressions against known inputs
- Test XSLT/LML map output against expected XML (automated round-trip)
- Verify routing conditions trigger on the right messages
- Confirm error handling catches the right failure conditions

Without sample data, the migration relies entirely on schema/code analysis — structurally correct but semantically unverified Logic Apps artifacts.

---

## 4. Language & Format Fluency

The tool operates across three language domains simultaneously.

### Domain 1: BizTalk Input Formats (READ)

**ODX (Orchestration) XML**
```xml
<om:Shape Name="Receive_1" Type="ReceiveShape">
  <om:Property Name="ActivatesCorrelation" Value="true"/>
  <om:Port PolymorphicInfo="..."/>
</om:Shape>
```
Key elements: service declarations, shape hierarchy, XLANG/s expressions, port bindings, correlation declarations, variable declarations, scope/exception structures

**BTM (Map) XML**
- Schema references (source + target XSD paths)
- Functoid definitions (FID codes → types)
- Link topology (source element → functoid → target element chains)
- Namespace declarations (critical for EDI)

**BTP (Pipeline) XML**
- Stage definitions with CategoryID (Decoder, Disassembler, Validator, etc.)
- Component listings with property values
- Component GUIDs mapping to known component types

**BindingInfo XML**
- Receive locations: transport type, address, WCF properties
- Send ports: filters, transforms, addresses
- Content-based routing filter conditions

**XLANG/s Expressions** (C#-like)
```csharp
msg.Status == "Approved" && order.Total > 500.0
string.Concat(msg.FirstName, " ", msg.LastName)
xpath(msgBody, "/PurchaseOrder/Total/text()")
```

### Domain 2: Logic Apps Output Formats (WRITE)

**workflow.json** (Workflow Definition Language)
```json
{
  "definition": {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "triggers": {
      "When_a_message_is_received": {
        "type": "ServiceProvider",
        "inputs": {
          "parameters": { "entityName": "orders" },
          "serviceProviderConfiguration": {
            "connectionName": "serviceBus",
            "operationId": "receiveQueueMessages",
            "serviceProviderId": "/serviceProviders/serviceBus"
          }
        }
      }
    },
    "actions": {
      "Parse_Order": {
        "type": "ParseJson",
        "inputs": { "content": "@triggerBody()", "schema": {} },
        "runAfter": {}
      },
      "Check_Approval": {
        "type": "If",
        "expression": {
          "and": [{ "equals": ["@body('Parse_Order')?['Status']", "Approved"] }]
        },
        "actions": {},
        "else": { "actions": {} },
        "runAfter": { "Parse_Order": ["Succeeded"] }
      }
    }
  }
}
```

**LML (Logic Apps Mapping Language)** — YAML format
```yaml
map:
  version: "1.0"
  source: OrderMessage
  target: InvoiceMessage
  mappings:
    - source: /Order/CustomerName
      target: /Invoice/BillTo/Name
    - source: /Order/LineItems/Item
      target: /Invoice/Lines/LineItem
      loop: true
      mappings:
        - source: /Quantity
          target: /Qty
        - source: /UnitPrice
          target: /Price
```

**ARM Template JSON**
```json
{
  "type": "Microsoft.Web/sites",
  "kind": "workflowapp,functionapp",
  "properties": {
    "siteConfig": {
      "appSettings": [
        { "name": "WORKFLOWS_SUBSCRIPTION_ID", "value": "[subscription().subscriptionId]" }
      ]
    }
  }
}
```

**XSLT** for Integration Account maps:
```xslt
<xsl:template match="/">
  <Invoice>
    <BillTo><Name><xsl:value-of select="/Order/CustomerName"/></Name></BillTo>
    <xsl:for-each select="/Order/LineItems/Item">
      <LineItem>
        <Qty><xsl:value-of select="Quantity"/></Qty>
      </LineItem>
    </xsl:for-each>
  </Invoice>
</xsl:template>
```

### Domain 3: TypeScript Implementation Language

- **MCP SDK**: `@modelcontextprotocol/sdk` — McpServer, StdioServerTransport, tool/prompt registration
- **XML parsing**: Fast XML parser for reading BizTalk artifacts (DOMless)
- **JSON generation**: Programmatic WDL construction with TypeScript type safety
- **Zod**: Runtime validation of tool inputs and generated workflow JSON
- **VS Code Extension API**: TreeDataProvider, WebviewPanel, commands
- **Node.js**: fs/path for local file I/O, no network in parsing pipeline

---

## 5. Data Privacy Architecture

All BizTalk artifact processing runs **entirely on the consultant's local machine**.

### What NEVER leaves the machine

| Category | Examples |
|---|---|
| Raw BizTalk artifacts | .odx, .btm, .btp, BindingInfo.xml, XSD files |
| Business logic | Orchestration shapes, expressions, decision logic |
| Schema content | XSD definitions, field names, data structures |
| Connectivity details | Connection strings, endpoint URLs, credentials, IP addresses |
| Generated artifacts | workflow.json, maps, ARM templates |
| Customer identifiers | Project names, file paths, company/system names |

### What the LLM may receive (sanitized summaries)

- Shape type counts and pattern classifications (not content)
- Abstract structural descriptions ("Receive shape → Transform → Send, FILE adapter")
- Complexity scores and gap categories
- Generated JSON (consultant controls what is shared)

### Enforcement Mechanisms

1. **No HTTP in parsing pipeline** — XML parsing and analysis is pure file I/O + in-process computation
2. **MCP server is stdio** — runs as local process, not a network server (default mode)
3. **Single network call** — license validation only; carries no artifact data
4. **Explicit consent for Azure** — ARM API tools (deployment) require conscious consultant action

---

## 6. Licensing & Distribution

### Licensing Model

```
┌────────────────────────────────────────────────────┐
│  CONSULTANT LICENSE                                │
│                                                    │
│  Upfront fee: One-time purchase per consultant     │
│  Monthly fee: Updates, new mappings, patterns      │
│                                                    │
│  License key: Tied to consultant email/org         │
│  Offline grace: 30 days after last validation      │
│  Seat type: Per-consultant (not per client)        │
└────────────────────────────────────────────────────┘
```

**Feature gates by tier**:
| Feature | Free | Licensed |
|---|---|---|
| Stage 1 (Understand/Analyze) | ✓ | ✓ |
| Stage 2 (Document/Spec) | ✓ | ✓ |
| Stage 3 (Build/Generate JSON) | ✗ | ✓ |
| Batch processing | ✗ | ✓ |
| Advanced pattern optimization | ✗ | ✓ |
| Logic Apps deployment tools | ✗ | ✓ |

### Distribution Channels

**1. VS Code Extension** (primary interactive use)
- Published to VS Code Marketplace
- Bundles MCP server, reference docs, schemas, CLI
- Guided migration panels with step-by-step UI
- Direct VS Code terminal for CLI access
- Extension ID: `biztalk-logicapps-migration`

**2. CLI Tool** (automation / CI / batch)
- Published to npm: `npx biztalk-to-logicapps`
- Commands: `analyze`, `document`, `build`, `batch`, `validate`
- JSON and Markdown output modes
- Same core engine as VS Code extension

### IP Protection Strategy
- Core engine bundled as compiled/minified JavaScript (esbuild)
- Reference docs and schemas embedded inside bundle (not separately downloadable)
- Source maps excluded from distribution
- License key required for build-stage features

---

## 7. Implementation Phases

### Phase 1: Reference Documents (START HERE)

Create the local knowledge base that both Claude and the migration engine will reference:

| File | Content |
|---|---|
| `docs/reference/biztalk-architecture.md` | Complete BizTalk architecture (MessageBox, pub/sub, runtime, adapters, pipelines, orchestrations, BRE, BAM, SSO) |
| `docs/reference/logicapps-architecture.md` | Complete Logic Apps architecture (Consumption vs Standard, WDL, connectors, integration accounts, B2B, error handling, limits) |
| `docs/reference/component-mapping.md` | Component-by-component mapping with migration classification (direct / partial / no equivalent) |
| `docs/reference/pattern-mapping.md` | Enterprise integration pattern migration guide (14 patterns) |
| `docs/reference/gap-analysis.md` | Detailed gaps with mitigation strategies (BRE, BAM, SSO, MSDTC, MessageBox, dehydration) |
| `docs/reference/expression-mapping.md` | XLANG/s → WDL expression translation reference (comprehensive) |
| `docs/reference/connector-mapping.md` | BizTalk adapter → Logic Apps connector (47+ mappings with decision tree) |
| `docs/reference/migration-decision-tree.md` | Decision trees (SKU selection, hosting, connector type, transformation approach) |

### Phase 2: Machine-Readable Schemas

| File | Content |
|---|---|
| `schemas/migration-schema.json` | JSON Schema defining migration metadata format |
| `schemas/component-mapping.json` | All mappings in machine-readable form (extends haroldcampos connector-registry.json) |
| `schemas/decision-trees.json` | Automated path selection logic |

### Phase 2.5: Licensing Infrastructure

| File | Content |
|---|---|
| `src/licensing/license-validator.ts` | Validate key on startup + periodic refresh |
| `src/licensing/license-cache.ts` | Local encrypted cache for offline grace period |
| `src/licensing/feature-gates.ts` | Feature flag system tied to license tier |

### Phase 3: Three-Stage Pipeline Code

**Stage 1 — Understand** (`src/stage1-understand/`):
| Module | Responsibility |
|---|---|
| `orchestration-analyzer.ts` | Parse .odx XML, extract shapes/messages/ports/correlations, classify patterns |
| `map-analyzer.ts` | Parse .btm XML, resolve functoid chains, identify transformation intent |
| `pipeline-analyzer.ts` | Parse .btp XML, map stages to processing intent |
| `binding-analyzer.ts` | Parse BindingInfo.xml, extract adapter configs, WCF metadata, CBR filters |
| `pattern-detector.ts` | Detect enterprise patterns across all artifacts |
| `complexity-scorer.ts` | Score migration difficulty with breakdown |

**Stage 2 — Document** (`src/stage2-document/`):
| Module | Responsibility |
|---|---|
| `migration-spec-generator.ts` | Generate full Markdown migration specification |
| `gap-analyzer.ts` | Identify gaps, classify severity, recommend mitigations |
| `risk-assessor.ts` | Score risk per component, identify manual intervention points |
| `architecture-recommender.ts` | Recommend target Azure services based on patterns detected |

**Stage 3 — Build** (`src/stage3-build/`):
| Module | Responsibility |
|---|---|
| `workflow-generator.ts` | Generate valid Logic Apps Standard workflow.json |
| `map-converter.ts` | Convert .btm functoid chains to LML or XSLT |
| `connection-generator.ts` | Generate connections.json API connection definitions |
| `infrastructure-generator.ts` | Generate ARM/Bicep templates |
| `test-spec-generator.ts` | Generate MSTest unit test scaffolding |
| `package-builder.ts` | Assemble complete deployment package |

### Phase 4: MCP Server

`src/mcp-server/server.ts` — Exposes all three stages as MCP tools to Claude

See [Section 14: MCP Tool Inventory](#14-mcp-tool-inventory) for full tool list.

### Phase 5: Distribution Packaging

- `src/cli/index.ts` — CLI entry point with `analyze` / `document` / `build` / `batch` commands
- `src/vscode/extension.ts` — VS Code extension entry point
- Build configuration to produce: npm package + VS Code VSIX

---

## 8. Project Directory Structure

```
BiztalktoLogicapps/
│
├── MIGRATION-PLAN.md                     ← THIS FILE
├── package.json
├── tsconfig.json
├── .vscodeignore
├── LICENSE                               (proprietary)
│
├── docs/
│   └── reference/                        ← PHASE 1: Knowledge base
│       ├── biztalk-architecture.md
│       ├── logicapps-architecture.md
│       ├── component-mapping.md
│       ├── pattern-mapping.md
│       ├── gap-analysis.md
│       ├── expression-mapping.md
│       ├── connector-mapping.md
│       └── migration-decision-tree.md
│
├── schemas/                              ← PHASE 2: Machine-readable mappings
│   ├── migration-schema.json
│   ├── component-mapping.json
│   └── decision-trees.json
│
├── src/
│   ├── types/                            ← Shared TypeScript types
│   │   ├── biztalk.ts                    (ODX/BTM/BTP/Binding models)
│   │   ├── logicapps.ts                  (WDL/workflow/connection models)
│   │   └── migration.ts                  (migration spec, gap, risk models)
│   │
│   ├── shared/                           ← CONVERGENCE POINT (both modes)
│   │   ├── integration-intent.ts         (IntegrationIntent type + builder)
│   │   └── intent-validator.ts           (validate completeness before build)
│   │
│   ├── licensing/                        ← PHASE 2.5: License management
│   │   ├── license-validator.ts
│   │   ├── license-cache.ts
│   │   └── feature-gates.ts             (Standard vs Premium feature gates)
│   │
│   ├── stage1-understand/                ← PHASE 3a: Migration Mode A — Parsing
│   │   ├── orchestration-analyzer.ts
│   │   ├── map-analyzer.ts
│   │   ├── pipeline-analyzer.ts
│   │   ├── binding-analyzer.ts
│   │   ├── pattern-detector.ts
│   │   └── complexity-scorer.ts
│   │
│   ├── stage2-document/                  ← PHASE 3b: Migration Mode A — Spec
│   │   ├── migration-spec-generator.ts
│   │   ├── gap-analyzer.ts
│   │   ├── risk-assessor.ts
│   │   └── architecture-recommender.ts
│   │
│   ├── stage3-build/                     ← PHASE 3c: SHARED — JSON generation
│   │   ├── workflow-generator.ts         (IntegrationIntent → workflow.json)
│   │   ├── map-converter.ts
│   │   ├── connection-generator.ts
│   │   ├── infrastructure-generator.ts
│   │   ├── test-spec-generator.ts
│   │   └── package-builder.ts
│   │
│   ├── greenfield/                       ← PHASE 3d: NLP Mode B (PREMIUM)
│   │   ├── nlp-interpreter.ts            (NL text → IntegrationIntent)
│   │   ├── schema-inferrer.ts
│   │   ├── connector-recommender.ts
│   │   ├── design-generator.ts
│   │   ├── template-library.ts
│   │   └── refinement-engine.ts
│   │
│   ├── mcp-server/                       ← PHASE 4: MCP server
│   │   ├── server.ts
│   │   ├── tools/
│   │   │   ├── definitions.ts            (migration + greenfield + management tools)
│   │   │   ├── handler.ts
│   │   │   └── schemas.ts
│   │   └── prompts/
│   │       ├── migration-guide.ts
│   │       └── greenfield-guide.ts
│   │
│   ├── cli/
│   │   └── index.ts                      ← CLI entry point
│   │
│   └── vscode/
│       ├── extension.ts                  ← VS Code entry point
│       └── panels/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/                         ← Sample BizTalk artifacts (input→transform→expected-output trios)
│       ├── 01-map-scripting-functoids/   (BTM map with C# functoids — Sandro Pereira pattern)
│       ├── 02-simple-file-receive/       (Receive → Transform → FILE output)
│       ├── 03-content-based-routing/     (Decide shape → route by priority)
│       └── [additional fixtures from consultant engagements]
│
└── .vscode/
    └── mcp.json                          ← MCP client configuration
```

---

## 9. BizTalk Architecture Reference

### Core Architecture

BizTalk Server implements a **publish/subscribe (pub/sub)** architecture centered on the MessageBox Database. All messages flow through the MessageBox; components publish to it and subscribe from it.

**Databases**:
- **MessageBox** (SQL Server): messages, subscriptions, orchestration state, host queues, tracking data — the heart of the system
- **BizTalk Management Database**: service classes, host configuration, binding info
- **SSO Database**: affiliate applications, encrypted credentials
- **BAM Databases**: activity data, aggregations, OLAP cubes
- **Tracking Database**: health monitoring, message/service tracking

### Message Flow

```
External System
    │
    ▼
[Receive Adapter]
    │ submits message
    ▼
[Receive Pipeline]
  Decode → Disassemble → Validate → ResolveParty
    │ promotes context properties
    ▼
[MessageBox Database]
    │ evaluates subscriptions
    ├──▶ [Orchestration Engine (XLANG/s)]
    │         │ processes, publishes new messages
    │         ▼
    │    [MessageBox Database]
    │
    └──▶ [Send Port subscription match]
              │
              ▼
         [Send Pipeline]
           Pre-Assemble → Assemble → Encode
              │
              ▼
         [Send Adapter] ──▶ External System
```

### Orchestration Shapes (38+ types)

| Category | Shapes |
|---|---|
| Message flow | Receive, Send |
| Construction | Construct Message, Transform, Message Assignment, Variable Assignment |
| Control flow | Decide, Switch, While, Until, Loop, Listen |
| Parallel | Parallel Actions, Parallel Branch |
| Invocation | Call Orchestration, Start Orchestration, Call Rules |
| Transaction | Scope, Atomic Transaction, Long-Running Transaction |
| Exception | Catch, Compensate, Compensation Scope, Throw Exception |
| Process | Expression, Delay, Group, Task, Terminate, Suspend, Fallback |

### Pipeline Stages

**Receive Pipeline (4 stages)**:
1. **Decode** — decrypt, MIME decode (all components run)
2. **Disassemble** — parse format, promote properties (first matching component runs)
3. **Validate** — validate XML against schema (all components run)
4. **ResolveParty** — map sender to configured party (all components run)

**Send Pipeline (3 stages)**:
1. **Pre-Assemble** — custom pre-processing (all components run)
2. **Assemble** — serialize to format (zero or one component)
3. **Encode** — encrypt, MIME encode (all components run)

**Default Pipelines**: XMLReceive, PassThruReceive, XMLTransmit, PassThruTransmit

### Adapters (Built-in)

FILE, FTP, SFTP, HTTP, SOAP, WCF (BasicHttp, WSHttp, NetTcp, NetNamedPipe, NetMsmq, Custom), MSMQ, MQSeries, POP3, SMTP, SQL, SAP, SharePoint, Event Hubs, Service Bus, Logic App, Office 365

### Subscription Types

- **Activation subscriptions**: Create NEW orchestration/send port instances (match → spawn new)
- **Instance subscriptions**: Route to EXISTING running instance (correlation)

### Business Rules Engine (BRE)

- Declarative rule policies (conditions + actions)
- Facts: .NET objects, XML documents, database tables
- Forward-chaining inference engine
- Called via `Call Rules` shape in orchestrations
- Policies versioned and deployed independently of application code

### Business Activity Monitoring (BAM)

- Real-time visibility into business processes
- Activity searches, aggregations (OLAP cubes), alert management
- Tracking profiles link BAM activities to orchestrations

### Enterprise SSO

- Credential mapping across systems (Windows AD ↔ back-end system credentials)
- SSO Database + Master Secret Server + SSO Servers
- Affiliate applications model
- Per-adapter credential mapping

---

## 10. Logic Apps Architecture Reference

### Hosting Models

| Model | Use Case | Key Characteristics |
|---|---|---|
| **Consumption (Multitenant)** | Simple cloud integration | Pay per execution, 1 workflow per resource, Microsoft-managed scaling |
| **Standard (Single-tenant)** | Enterprise, VNET, multi-workflow | Hosting plan pricing, 1 app = many workflows, VNET integration, stateful + stateless |
| **Standard (ASEv3)** | Full isolation | Dedicated environment, manual/auto scale |
| **Standard (Hybrid)** | On-premises/multi-cloud | Azure Container Apps extension, partially connected |

**Recommended target**: **Logic Apps Standard** for BizTalk migrations (enterprise feature set, VNET, multi-workflow per app matches BizTalk application model)

### Workflow Definition Language (WDL)

JSON schema: `https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#`

**Top-level structure**:
```json
{
  "definition": {
    "$schema": "...",
    "triggers": { },
    "actions": { },
    "parameters": { },
    "outputs": { }
  }
}
```

**Key constraints**:
- 1 trigger per workflow (Standard)
- Max 500 actions per workflow
- 8 levels nesting depth
- Action names: 80 chars max (Standard: 32 chars)
- Variables: max 250 per workflow

### Expression Syntax

- Runtime evaluation: `@{expression}` or `@expression`
- String interpolation: `@{concat('Hello ', triggerBody()?['name'])}`
- Null-safe access: `?['property']`

**Common functions**:
```
concat(), equals(), not(), and(), or(), if()
greater(), less(), greaterOrEquals(), lessOrEquals()
add(), sub(), mul(), div(), mod()
string(), int(), float(), bool()
length(), indexOf(), substring(), trim(), toUpper(), toLower()
first(), last(), skip(), take(), union(), intersection()
xpath(), json(), xml(), base64(), base64ToString()
utcNow(), addDays(), formatDateTime(), ticks()
variables(), parameters(), triggerBody(), body()
```

### Connector Types

| Type | Hosting | Performance | Count |
|---|---|---|---|
| Built-in (Service Provider) | In-process with workflow | Highest throughput, lowest latency | ~50 key connectors |
| Managed | Hosted by Microsoft as proxy | Standard latency | 1,400+ |
| Custom Built-in | In-process (Standard only) | In-process performance | Unlimited |
| Custom Managed | Microsoft-hosted proxy | Standard latency | 1,000/subscription |

### Stateful vs Stateless Workflows (Standard)

| Feature | Stateful | Stateless |
|---|---|---|
| Run history | External Azure Storage | Memory only |
| Max duration | 90 days | 5 minutes |
| Managed connector triggers | ✓ | ✗ (push/webhook only) |
| Chunking | ✓ | ✗ |
| Optimal for | Long-running, durable | High-throughput, sub-5min |

**For BizTalk migration: Always use Stateful** (matches BizTalk's durable, long-running process model)

### Enterprise Integration / B2B

- **Integration Account**: Cloud container for B2B artifacts (partners, agreements, maps, schemas, certificates)
- Standard SKU: maps and schemas can be stored directly in the logic app (no integration account required for those)
- B2B protocols: AS2, X12, EDIFACT, RosettaNet
- Map types: XSLT, XSLT 2.0, XSLT 3.0, Liquid, LML (Data Mapper)

### Error Handling

```json
"runAfter": {
  "Previous_Action": ["Succeeded", "Failed", "TimedOut"]
}
```

Scope + result() pattern for catch blocks:
```json
"Get_failures": {
  "type": "Query",
  "inputs": {
    "from": "@result('My_Scope')",
    "where": "@equals(item()['status'], 'Failed')"
  },
  "runAfter": { "My_Scope": ["Failed"] }
}
```

Retry policies: Default (exponential, 4 retries), Fixed, Exponential, None — max 90 retries

---

## 11. Component Mapping Overview

### Shape-to-Action Mapping

| BizTalk Shape | Logic Apps Action | Notes |
|---|---|---|
| Receive (activating) | Trigger | Type determined by adapter (polling vs webhook) |
| Receive (non-activating) | ServiceBus.ReceiveMessage or HTTP action | Correlation via session ID or query |
| Send | HTTP / ServiceBus.SendMessage / connector action | Based on send port adapter |
| Decide | If (Condition) | Translate XLANG/s expression to WDL expression |
| Switch | Switch | Cases map directly |
| While | Until (inverted condition) | Condition logic inverted |
| Until | Until | Direct mapping |
| Parallel Actions | Parallel (runAfter from same predecessor) | No explicit container; concurrent runAfter chains |
| Scope | Scope | With runAfter error handling |
| Construct + Transform | Transform / "Transform using Data Mapper XSLT" | Map must be migrated separately |
| Construct + MessageAssignment | Compose | Build JSON object |
| Expression | Compose or Initialize Variable | Context-dependent |
| Delay | Delay | ISO 8601 duration |
| Call Orchestration (sync) | Call child workflow via HTTP Request trigger | Callable workflow pattern |
| Start Orchestration (async) | HTTP action (fire-and-forget) | No wait for response |
| Call Rules | Azure Functions action | BRE → Azure Function |
| Terminate | Terminate action | Direct mapping |
| Listen | Switch with timeout branch | First-to-complete semantics |
| Catch | Scope + runAfter ["Failed"] | Exception type → condition |
| Compensate | Compose (manual implementation) | No direct equivalent |
| Group | Comment / documentation only | Visual grouping has no runtime equivalent |

### Adapter-to-Connector Mapping

| BizTalk Adapter | Logic Apps Connector | Type | Notes |
|---|---|---|---|
| FILE | Azure Blob Storage | Built-in (Standard) | Cloud target; use FileSystem connector for on-prem |
| FTP | FTP | Built-in | Recommend upgrade to SFTP |
| SFTP | SFTP-SSH | Built-in | Direct mapping |
| HTTP | HTTP | Built-in | Direct mapping |
| SOAP | HTTP (with SOAP action) | Built-in | Or use APIM for SOAP facade |
| WCF-BasicHttp | HTTP | Built-in | — |
| WCF-WSHttp | HTTP | Built-in | WS-Security headers manually |
| WCF-NetTcp | Custom Function | Azure Function | No direct equivalent |
| WCF-NetNamedPipe | N/A | Azure Function | No equivalent — must redesign |
| WCF-NetMsmq | Service Bus | Built-in | MSMQ → Service Bus migration |
| WCF-Custom | Context-dependent | Varies | Analyze binding |
| MSMQ | Service Bus | Built-in | — |
| MQSeries | IBM MQ | Built-in (Standard) | — |
| SQL | SQL Server | Built-in | Direct mapping |
| SAP | SAP ERP | Managed | — |
| POP3 | Office 365 Outlook | Managed | — |
| SMTP | SMTP or Office 365 | Built-in / Managed | — |
| Event Hubs | Azure Event Hubs | Built-in | Direct mapping |
| Service Bus (SB-Messaging) | Azure Service Bus | Built-in | Direct mapping |

### Pipeline Component Mapping

| BizTalk Component | Logic Apps Action | Notes |
|---|---|---|
| XML Disassembler | ForEach + XML Parse (XmlParse) | Schema-aware parsing |
| XML Assembler | XML Compose (XmlCompose) | Schema-based serialization |
| Flat File Disassembler | Flat File Decoding | Built-in connector |
| Flat File Assembler | Flat File Encoding | Built-in connector |
| MIME/SMIME Decoder | Azure Function | No built-in equivalent |
| MIME/SMIME Encoder | Azure Function | No built-in equivalent |
| XML Validator | XML Validation | Direct mapping |
| JSON Decoder | Parse JSON | Direct mapping |
| JSON Encoder | Compose + json() | Direct mapping |
| Party Resolution | Azure Function + data store | No built-in equivalent |
| XSL Transform | XSLT action | Direct mapping |
| PassThru | No action (note only) | Pass message through unchanged |
| BizTalk Framework Dis/Assembler | Custom Function | Deprecated protocol |

---

## 12. Integration Pattern Mapping

### 1. Content-Based Routing
**BizTalk**: Promoted properties + send port filters + MessageBox subscription evaluation
**Logic Apps**: Switch action (for discrete values) or nested If/Condition actions
```json
"Route_by_region": {
  "type": "Switch",
  "expression": "@body('Parse_Order')?['Region']",
  "cases": {
    "EMEA": { "actions": { ... } },
    "APAC": { "actions": { ... } }
  },
  "default": { "actions": { ... } }
}
```

### 2. Sequential Convoy
**BizTalk**: Correlating Receive shapes with FollowsCorrelationSets
**Logic Apps**: Azure Service Bus sessions (session-enabled queue/topic) as the correlation mechanism
- Enable sessions on Service Bus queue
- Use `sessionId` to group correlated messages
- Trigger: `When messages are available in a queue (peek-lock)` with session

### 3. Scatter-Gather (Parallel + Aggregate)
**BizTalk**: Parallel Actions shape + manual aggregation in orchestration
**Logic Apps**: Parallel actions (concurrent runAfter from same predecessor) + Compose action to aggregate results

### 4. Publish-Subscribe (Fan-out)
**BizTalk**: MessageBox pub/sub; multiple send ports with different subscriptions receive same message
**Logic Apps**: Azure Service Bus topics + subscriptions, or Azure Event Grid for event-driven fan-out

### 5. Request-Reply (Synchronous)
**BizTalk**: Solicit-Response send port + Request-Response receive port
**Logic Apps**: HTTP action with response expected, or HTTP Request trigger + Response action

### 6. Aggregation
**BizTalk**: Orchestration with loop + message collection
**Logic Apps**: ForEach loop + array variable + Union/Append to array operations

### 7. Long-Running Transaction
**BizTalk**: Scope shape with LongRunning transaction type + Compensate shapes
**Logic Apps**: Stateful workflow (inherently durable) + Scope for error grouping + compensating workflow (separate callable workflow triggered on failure)

### 8. Dehydration/Rehydration
**BizTalk**: Explicit engine feature — serialize state to MessageBox, resume when correlated message arrives
**Logic Apps**: **Automatic in stateful workflows** — no modeling needed. Workflow waits for triggers/conditions without consuming resources.

### 9. Dead-Letter / Poison Message Handling
**BizTalk**: Suspended message queue + manual intervention via BizTalk Admin Console
**Logic Apps**: Service Bus dead-letter queue monitoring + separate error-handling workflow

### 10. Message Enrichment
**BizTalk**: Message Assignment shape + database/service calls in orchestration
**Logic Apps**: HTTP actions or connector calls within workflow, results composed into enriched message

### 11. Correlation without Convoy
**BizTalk**: Non-activating Receive with FollowsCorrelationSet
**Logic Apps**: Until loop polling Service Bus for correlated message by session/correlation ID, or webhook callback pattern

### 12. Rule-Based Processing (BRE)
**BizTalk**: Call Rules shape → Business Rules Engine policy evaluation
**Logic Apps**: Decision tree using Switch/Condition actions (simple rules), or Azure Functions (complex rules), or Azure Rules Engine

### 13. BAM Monitoring
**BizTalk**: BAM tracking profiles + BAM Portal + OLAP cubes
**Logic Apps**: Application Insights custom events + Azure Monitor dashboards + Log Analytics queries

### 14. Atomic Transaction
**BizTalk**: Scope with Atomic transaction type — MSDTC distributed transaction
**Logic Apps**: **No equivalent for MSDTC**. Mitigation: Compensating transactions pattern, idempotent operations + retry, or Azure Service Bus transactional outbox

---

## 13. Gap Analysis

### Critical Gaps (No Direct Equivalent)

#### 1. MessageBox Database
**BizTalk**: Central publish/subscribe bus; durable message store; subscription evaluation engine
**Gap**: No single equivalent in Logic Apps
**Mitigation**: Azure Service Bus (messaging/routing) + Event Grid (events/fan-out) + Application Insights (tracking) — three services replace one

#### 2. Distributed Transactions (MSDTC)
**BizTalk**: Atomic scope with MSDTC across SQL, MSMQ, other resources
**Gap**: Logic Apps has no MSDTC support — cloud-native services are designed for eventual consistency
**Mitigation**:
- Saga pattern (compensating transactions)
- Idempotent operations with retry
- Service Bus transactions (within SB only)
- Azure Cosmos DB transactions (if data is in Cosmos)
- Risk: High — may require application redesign

#### 3. Business Rules Engine (BRE)
**BizTalk**: Versioned rule policies with forward-chaining inference, vocabulary definitions, independently deployable
**Gap**: No direct equivalent with same versioning + inference semantics
**Mitigation** (choose based on complexity):
- Simple rules: Switch/Condition actions in workflow (inline)
- Moderate rules: Azure Functions (C# code, fast, testable)
- Complex rules: Azure Rules Engine (preview) or third-party rules engine
- Enterprise: Red Hat Decision Manager / Drools on Azure

#### 4. Business Activity Monitoring (BAM)
**BizTalk**: Real-time business process visibility, KPI dashboards, OLAP aggregations, alerting
**Gap**: No equivalent business-process-level monitoring platform
**Mitigation**:
- Application Insights custom events for activity tracking
- Azure Monitor for metrics and alerting
- Log Analytics for query-based analysis
- Power BI for dashboards (replace BAM Portal)
- Custom implementation required for BAM-equivalent visibility

#### 5. Enterprise SSO
**BizTalk**: Credential mapping from Windows AD to back-end system credentials
**Gap**: SSO credential mapping model is Windows-specific
**Mitigation**:
- Azure Key Vault for secret storage (replace SSO database)
- Managed Identities for Azure resource access (replace Windows auth)
- Azure AD service principals for back-end system credentials
- Azure API Management for credential abstraction

#### 6. Custom Pipeline Components
**BizTalk**: .NET COM components in pipeline stages, full message access, custom processing
**Gap**: No equivalent pipeline extensibility model in Logic Apps
**Mitigation**:
- Azure Functions (for compute-intensive transformations)
- Built-in connector operations (for standard operations)
- Custom built-in connectors (Standard SKU, service provider model)
- Risk: Medium — requires re-implementing as Azure Functions

#### 7. WCF-NetNamedPipe / WCF-NetTcp Adapters
**BizTalk**: Binary WCF protocols over TCP/named pipes (high performance, intranet)
**Gap**: No Logic Apps equivalent — cloud doesn't support these binary protocols
**Mitigation**:
- Redesign to HTTP/REST endpoints
- Use Azure Relay for hybrid connectivity
- Expose via Azure API Management
- Risk: High — requires redesign of client applications

#### 8. Compensation Logic
**BizTalk**: Compensate shape with Compensation scope — structured undo mechanism
**Gap**: No built-in compensation model
**Mitigation**:
- Separate "rollback" callable workflow triggered on failure
- Scope + runAfter ["Failed"] for compensation actions
- Manual implementation of saga compensating transactions
- Risk: Medium — functionality possible but requires explicit modeling

### Moderate Gaps (Partial Equivalents)

| BizTalk Feature | Logic Apps Approach | Fidelity |
|---|---|---|
| Orchestration dehydration | Built into stateful workflow | Automatic, no modeling needed |
| Message suspension/resume | Service Bus DLQ + separate workflow | Manual resume process |
| Host throttling | Logic Apps concurrency limits | Different model |
| BizTalk Admin Console | Azure Portal + VS Code extension | Equivalent functionality |
| Global deployment | ARM templates + deployment slots | Different mechanics |
| Dynamic send ports | Workflow variables + connector selection | Possible but verbose |
| Message tracking | Application Insights run history | Good fidelity |
| Role Links | APIM + managed identities | Structural rethink needed |

---

## 14. MCP Tool Inventory

The MCP server exposes all three migration stages as tools to Claude.

### Stage 1: Understanding Tools

| Tool | Description |
|---|---|
| `analyze_biztalk_application` | Full application analysis (all artifacts: .odx + .btm + .btp + bindings) |
| `understand_orchestration` | Deep intent analysis of a single .odx file |
| `understand_map` | Deep analysis of a single .btm file — transformation intent |
| `understand_pipeline` | Deep analysis of a single .btp file — message processing intent |
| `understand_binding` | Parse BindingInfo.xml — connectivity and routing intent |
| `detect_patterns` | Enterprise pattern detection across all artifacts |
| `assess_complexity` | Migration complexity scoring with breakdown |
| `list_biztalk_artifacts` | Enumerate all BizTalk artifacts in a directory |

### Stage 2: Documentation Tools

| Tool | Description |
|---|---|
| `generate_migration_spec` | Full Markdown migration specification |
| `generate_gap_analysis` | Detailed gap analysis with mitigations |
| `generate_architecture_recommendation` | Target Azure architecture recommendation |
| `generate_data_flow_diagram` | ASCII/Mermaid data flow diagram |
| `generate_component_inventory` | Structured list of all components and their roles |
| `generate_risk_assessment` | Risk ratings per component with manual intervention points |

### Stage 3: Build Tools (Licensed)

| Tool | Description |
|---|---|
| `generate_workflow` | Generate Logic Apps Standard workflow.json |
| `convert_map_to_lml` | Convert .btm to LML (Data Mapper format) |
| `convert_map_to_xslt` | Convert .btm to XSLT stylesheet |
| `generate_connections` | Generate connections.json |
| `generate_host_config` | Generate host.json |
| `generate_arm_template` | Generate ARM/Bicep infrastructure template |
| `generate_unit_tests` | Generate MSTest unit test scaffolding |
| `build_deployment_package` | Assemble complete deployable package |
| `validate_workflow` | Validate generated workflow.json against WDL schema |

### NLP Greenfield Tools (Premium tier)

| Tool | Description |
|---|---|
| `create_workflow_from_description` | Generate Logic Apps workflow from natural language |
| `refine_workflow` | Modify an existing workflow via natural language instruction |
| `infer_schema` | Derive JSON schema from a data description in prose |
| `recommend_connectors` | Suggest best connectors for described systems |
| `list_templates` | Browse available integration pattern templates |
| `apply_template` | Start from a template and customize via NLP |
| `design_architecture` | Generate architecture spec from NLP before building |

### Logic Apps Management Tools (from logicapps-mcp — Licensed)

All 40 tools from logicapps-mcp for deploying, monitoring, debugging, and managing the generated Logic Apps:
- Discovery: `list_subscriptions`, `list_logic_apps`, `list_workflows`
- Workflow management: `get_workflow_definition`, `create_workflow`, `update_workflow`, `delete_workflow`
- Run history: `list_run_history`, `get_run_details`, `search_runs`, `resubmit_run`
- Debugging: `get_action_io`, `get_expression_traces`, `get_action_repetitions`
- Connections: `get_connections`, `create_connection`, `test_connection`
- Knowledge: `get_troubleshooting_guide`, `get_authoring_guide`

### Reference Tools

| Tool | Description |
|---|---|
| `get_component_mapping` | Look up migration path for a specific BizTalk component |
| `get_pattern_guidance` | Get migration guidance for a specific integration pattern |
| `get_expression_translation` | Translate an XLANG/s expression to WDL |
| `get_connector_mapping` | Look up Logic Apps connector for a BizTalk adapter |
| `get_gap_mitigation` | Get mitigation strategies for a specific BizTalk gap |

---

## 15. Verification Plan

### Reference Documents
- Cross-check all component mappings against Microsoft official documentation
- Validate adapter list against BizTalk 2020 adapter documentation
- Validate connector list against Logic Apps connector catalog (1,400+ connectors)
- Have an SME with BizTalk experience review the gap analysis

### Migration Engine
- Unit tests: each analyzer, mapper, generator individually tested
- Integration tests: end-to-end conversion of sample BizTalk artifacts
- Fixtures (input → transform → expected-output trios): `01-map-scripting-functoids`, `02-simple-file-receive`, `03-content-based-routing`
- Additional fixtures to build: convoy-pattern, scatter-gather, BRE-rules, EDI-pipeline, flat-file-disassemble
- Sample data collection: at engagement start, consultant provides real input/output samples (see Section 3c)
- Output validation: all generated workflow.json validated against WDL schema

### MCP Tools
- All tools callable from Claude Desktop via mcp.json config
- All tools callable from VS Code via MCP extension
- Tool parameter validation via Zod schemas

### Round-Trip Test (Gold Standard)
1. Take a real BizTalk application
2. Run Stage 1 → Stage 2 → Stage 3
3. Deploy generated Logic Apps to Azure
4. Run the same test messages through BizTalk and Logic Apps
5. Compare outputs: must be functionally equivalent

### Business Logic Preservation
- Generated workflows must produce the same data transformations as original BizTalk maps
- Routing decisions must match original CBR/subscription logic
- Error handling must catch the same failure conditions
- Long-running process state must persist across workflow executions

---

*Document version: 1.0 | Created: 2026-02-23 | Status: Approved — Implementation in progress*
