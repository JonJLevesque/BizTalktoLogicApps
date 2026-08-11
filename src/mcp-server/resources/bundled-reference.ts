/**
 * Bundled reference content for MCP resources.
 *
 * The full reference documents (docs/reference/*.md) are proprietary and are
 * not distributed with the npm package. These condensed summaries are written
 * for distribution: they cover the high-level mappings a consultant needs to
 * orient themselves, while detailed per-adapter configuration, edge cases, and
 * methodology stay server-side (applied automatically by the AI enrichment
 * step when a license key is configured).
 *
 * Served by src/mcp-server/server.ts whenever the corresponding full document
 * is not present on disk (i.e. any install that is not a full source checkout).
 */

const NOTE =
  '> Condensed built-in reference. The detailed mapping document is applied ' +
  'automatically during AI enrichment (BTLA_LICENSE_KEY) — this summary is ' +
  'for orientation only.\n\n';

export const BUNDLED_REFERENCE: Record<string, string> = {
  'biztalk://reference/component-mapping': `# Component Mapping — BizTalk Shapes to Logic Apps Actions (Condensed)

${NOTE}| BizTalk shape | Logic Apps equivalent |
| --- | --- |
| Receive (activating) | Workflow trigger (connector chosen from the receive adapter) |
| Receive (correlated, non-activating) | HTTP callback / stateful correlation pattern |
| Send | Connector action (built-in ServiceProvider preferred) or Http action |
| Construct + Transform | Transform action (XSLT) or Data Mapper |
| Construct + Message Assignment | Compose action |
| Decide (2 branches) | If action (JSON predicate expression) |
| Decide (N branches) | Switch action |
| While loop | Until action — the condition must be inverted |
| ForEach / debatching | Foreach action (concurrency 1 preserves BizTalk ordering) |
| Parallel Actions | Sibling actions sharing the same runAfter dependency |
| Delay | Delay action |
| Terminate / Throw | Terminate action (runStatus: Failed / Cancelled) |
| Scope (exception handling) | Scope action + error branch via runAfter: ["FAILED"] |
| Scope (atomic transaction) | No equivalent — compensation/saga design required |
| Suspend | No equivalent — Terminate + notification + resume workflow |
| Compensate | No equivalent — explicit compensation workflow |
| Call Orchestration (sync) | Workflow action (child workflow, Standard only) |
| Start Orchestration (async) | Service Bus send (fire-and-forget) |
| Call Rules (BRE) | Inline If/Switch, Azure Rules Engine, or Azure Functions |
| Expression / Message Assignment | SetVariable or Compose action |
| Correlation Set | Stateful workflow + custom correlation expression |
| Role Link | No equivalent — static connector configuration |

Key structural rules: workflows are always Stateful for BizTalk migrations;
runAfter status values are ALL CAPS (SUCCEEDED / FAILED / TIMEDOUT / SKIPPED);
the first action after the trigger has an empty runAfter.
`,

  'biztalk://reference/connector-mapping': `# Connector Mapping — BizTalk Adapters to Logic Apps Connectors (Condensed)

${NOTE}| BizTalk adapter | Logic Apps connector | Notes |
| --- | --- | --- |
| FILE (cloud target) | azureblob (built-in) | Folder → container name |
| FILE (on-premises) | filesystem (built-in) | Requires on-premises data gateway |
| FTP / SFTP | ftp / sftp (built-in) | BizTalk auto-deletes processed files; add an explicit delete action |
| HTTP / SOAP / WCF-BasicHttp | Request trigger / Http action | SOAP needs Content-Type and SOAPAction headers |
| WCF-WSHttp | Http action | WS-Security headers handled manually |
| WCF-NetTcp | Azure Functions | No Logic Apps connector for binary TCP |
| WCF-NetNamedPipe | Not migratable | Redesign required (same-machine transport) |
| MSMQ / WCF-NetMsmq | serviceBus (built-in) | Transactional MSMQ → sessions (FIFO) |
| SB-Messaging | serviceBus (built-in) | Direct mapping |
| Event Hubs | eventhub (built-in) | Consumer group set on the trigger |
| MQSeries | ibmmq (built-in) | Queue manager configuration |
| SQL Server | sql (built-in) | Gateway required for on-premises servers |
| Oracle | oracle (managed) | Or Azure Functions |
| SAP | sap (managed) | Gateway required on-premises |
| SMTP | smtp (built-in) | Direct mapping |
| POP3 / Exchange | office365 (managed) | Email trigger |
| EDI X12 / EDIFACT / AS2 | x12 / edifact / as2 | Integration Account required |
| SharePoint | sharepoint (managed) | Gateway for on-premises |
| Azure Blob / Queue / Cosmos | azureblob / azurequeue / cosmosdb (built-in) | Direct mapping |

Decision rule: prefer built-in (ServiceProvider) connectors over managed
(ApiConnection); add the on-premises data gateway only for private-network
targets. Connection strings are always @appsetting('KVS_...') references.
`,

  'biztalk://reference/expression-mapping': `# Expression Mapping — XLANG/s to Workflow Definition Language (Condensed)

${NOTE}## Conditions (If action expressions are JSON predicate objects, never strings)

| XLANG/s | WDL |
| --- | --- |
| a == b | {"equals": [...]} |
| a != b | {"not": {"equals": [...]}} |
| a > b, a >= b | {"greater": [...]}, {"greaterOrEquals": [...]} |
| a && b | {"and": [ ... ]} |
| a \\|\\| b | {"or": [ ... ]} |
| !cond | {"not": { ... }} |

Numeric comparisons cast first: @float(...) / @int(...). String equals is
case-sensitive — wrap with toLower() for case-insensitive checks.

## Common function translations

| XLANG/s | WDL |
| --- | --- |
| String.Concat / ToUpper / Contains | concat(), toUpper(), contains() |
| Substring / Replace / Trim / Split | substring(), replace(), trim(), split() |
| string.IsNullOrEmpty(s) | empty(s) |
| DateTime.Now (+ formats) | utcNow('yyyy-MM-dd') |
| int.Parse / double.Parse | int(), float() |
| + - * / % | add(), sub(), mul(), div(), mod() |
| val ?? default | coalesce(val, 'default') |
| cond ? a : b | if(cond, a, b) |
| xpath(msg, ...) | xpath(xml(body(...)), ...) — always returns an array; use first() |

## No WDL equivalent (route to Azure Functions)

Regex, Math.Pow/Sqrt, LINQ, .NET custom classes, MSDTC transactions,
complex XPath predicates.
`,

  'biztalk://reference/pattern-mapping': `# Pattern Mapping — Enterprise Integration Patterns (Condensed)

${NOTE}| Pattern in BizTalk | Logic Apps migration |
| --- | --- |
| Content-based routing | If/Switch action routing to per-destination sends |
| Splitter (envelope debatching) | Foreach over the message collection (sequential) |
| Aggregator | Stateful workflow + external state (Service Bus sessions / storage) |
| Scatter-gather | Parallel actions or parallel child workflows + join |
| Publish-subscribe (MessageBox) | Service Bus topics — one subscriber workflow per subscription |
| Message broker | Service Bus + routing workflows |
| Sequential convoy | Service Bus sessions (FIFO) |
| Parallel convoy | Correlated triggers → redesign as fan-in via Service Bus |
| Request-reply | Request trigger + Response action |
| Fire-and-forget | Service Bus send |
| Retry / error handling | Scope + runAfter FAILED branch, retryPolicy on actions |
| Compensation | Explicit compensation workflows (no MSDTC in Azure) |
| Recipient list / dynamic routing | Child workflow + configuration-driven endpoints |
| Message translator | Transform (XSLT) / Data Mapper action |
| Content enricher | Compose / HTTP lookup + Compose |
| Claim check | Blob storage for payload + reference in message |

The detect_patterns MCP tool identifies which of these apply to a parsed
application; generate_architecture maps them onto Azure services.
`,

  'biztalk://reference/gap-analysis': `# Gap Analysis Reference — BizTalk Capabilities Without Direct Equivalents (Condensed)

${NOTE}## Critical (redesign required)

- MessageBox publish-subscribe → Service Bus topics + one workflow per subscriber
- MSDTC distributed transactions / atomic Scope → saga + compensation pattern
- WCF-NetNamedPipe → no Azure equivalent; redesign as HTTP, Service Bus, or Relay
- WCF-NetTcp → wrap in Azure Functions or re-expose as REST
- Dynamic send ports → no connector supports runtime endpoints except HTTP
- SSO affiliate applications → Key Vault + managed identities

## High (significant workaround)

- Business Rules Engine → Azure Rules Engine, inline If/Switch, or Functions
- Flat-file pipeline components → body-only schema support; custom parser for parity
- Correlated (non-activating) receives → HTTP callback + stateful tracking
- Custom pipeline components → one Azure Function per component
- Multiple activating receives → one workflow per trigger, fan-in via Service Bus

## Medium (workaround available)

- Envelope debatching order → Foreach with concurrency 1
- Party resolution → storage lookup
- BAM → Application Insights + tracked properties + workbooks
- Suspend shape → Terminate + notification + separate resume workflow

The generate_gap_analysis MCP tool produces the per-application gap report
with severity, mitigation, and effort estimates.
`,
};
