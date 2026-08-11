/**
 * Gap Analyzer — Stage 2 (Document)
 *
 * Identifies BizTalk capabilities that have no direct equivalent in Azure Logic
 * Apps and recommends mitigation strategies.
 *
 * Gaps are derived from:
 *   - Orchestration-level flags (atomic transactions, BRE calls, compensation, etc.)
 *   - Adapter types in binding files (WCF-NetNamedPipe, WCF-NetTcp)
 *   - Map complexity (scripting functoids, database functoids)
 *   - Pipeline components (custom .NET components)
 *   - Multiple activating receive shapes
 *   - EDI/AS2 pipelines (require Integration Account — low risk but worth flagging)
 *
 * Each gap is rated by severity (critical / high / medium / low) and includes
 * a concrete mitigation strategy with an effort estimate.
 */

import type {
  BizTalkApplication,
  OdxShape,
  ParsedOrchestration,
  ParsedMap,
  ParsedPipeline,
} from '../types/biztalk.js';
import type { MigrationGap, RiskSeverity } from '../types/migration.js';

// ─── Gap Definitions ──────────────────────────────────────────────────────────
// All static gap metadata lives here — no business logic in the definitions.

interface GapDefinition {
  capability: string;
  severity: RiskSeverity;
  description: string;
  mitigation: string;
  baseEffortDays: number;
}

const GAP_DEFS = {
  atomicTransaction: {
    capability: 'MSDTC Atomic Transactions',
    severity: 'critical' as RiskSeverity,
    description:
      'Atomic transaction scopes use MSDTC (Microsoft Distributed Transaction Coordinator) for ' +
      'two-phase commit across multiple systems. Logic Apps has no equivalent and cannot enlist ' +
      'in distributed transactions.',
    mitigation:
      'Redesign using the Saga pattern: decompose the atomic operation into a sequence of local ' +
      'transactions, each paired with a compensating action that reverses its effects if a later ' +
      'step fails. Implement compensation via a dedicated Logic Apps workflow invoked from a ' +
      'Scope action with runAfter ["FAILED"].',
    baseEffortDays: 5,
  },

  longRunningTransaction: {
    capability: 'Long-Running Transactions',
    severity: 'high' as RiskSeverity,
    description:
      'Long-running transaction scopes with custom compensation handlers have no direct equivalent. ' +
      'Logic Apps Standard supports stateful workflow persistence but not BizTalk-style compensation handlers.',
    mitigation:
      'Use Scope actions with runAfter ["FAILED", "TIMEDOUT"] to implement error recovery. For ' +
      'compensation logic, call a separate rollback workflow via HTTP action. Consider Service Bus ' +
      'dead-letter queues for failed-message handling in multi-step processes.',
    baseEffortDays: 3,
  },

  compensation: {
    capability: 'Compensate Shape',
    severity: 'high' as RiskSeverity,
    description:
      'Compensate shapes trigger explicit rollback logic in BizTalk long-running transactions. ' +
      'Logic Apps has no built-in compensation mechanism.',
    mitigation:
      'Implement compensation as a separate rollback workflow. Invoke it from Scope action ' +
      'error handlers using an HTTP action. Document each compensating action pair (forward + ' +
      'undo) and implement them as independently invokable Logic Apps workflows.',
    baseEffortDays: 4,
  },

  brePolicy: {
    capability: 'Business Rules Engine (BRE)',
    severity: 'medium' as RiskSeverity,
    description:
      'BizTalk BRE policies execute complex business rules maintained separately from ' +
      'orchestrations in .brl files. Azure Logic Apps now has a direct equivalent: the ' +
      'Azure Logic Apps Rules Engine ships the SAME BRE RETE inference runtime as BizTalk, ' +
      'meaning .brl policy files are often directly reusable with minimal rework. ' +
      'Constraint: the Azure Rules Engine supports XML facts and .NET (Framework) facts ' +
      'ONLY — policies that use database facts (DataConnection/TypedDataTable) or ' +
      'long-term fact retrievers against databases must be reworked to XML or .NET facts.',
    mitigation:
      'Recommended path: migrate policies to the Azure Logic Apps Rules Engine (same BRE ' +
      'RETE runtime — import the .brl policy and vocabulary files into the Rules Engine ' +
      'project; closest structural equivalent, lowest effort). Rework any database facts ' +
      'to XML or .NET Framework facts first. Alternatively: (2) Azure Functions with ' +
      'business logic ported to C# or JavaScript (for complex stateful policies), ' +
      '(3) Inline Logic Apps WDL expressions for simple, stateless rule sets. ' +
      'Each CallRules shape should still be reviewed for runtime dependencies.',
    baseEffortDays: 2,
  },

  // Dated platform deadline — surfaced whenever SB-Messaging / MSMQ-family
  // adapters are detected, because both the interim BizTalk estate and the
  // migrated Logic Apps estate depend on the Service Bus protocol change.
  sbmpRetirement: {
    capability: 'Service Bus SBMP Protocol Retirement (30 September 2026)',
    severity: 'critical' as RiskSeverity,
    description:
      'Azure Service Bus retires the legacy SBMP (NetMessaging) protocol on 30 September 2026. ' +
      'The BizTalk SB-Messaging adapter (and WCF NetMessagingBinding) uses SBMP by default, so ' +
      'BizTalk applications sending to or receiving from Azure Service Bus will STOP WORKING ' +
      'after that date unless switched to AMQP. BizTalk Server 2020 requires update KB5091375 ' +
      'to add AMQP support to the SB-Messaging adapter; earlier BizTalk versions have no AMQP ' +
      'option and must migrate before the retirement date. Migrated Logic Apps workflows are ' +
      'safe: the built-in serviceBus connector already uses AMQP.',
    mitigation:
      'Before 30 September 2026: (1) If the BizTalk estate must keep running during the ' +
      'migration window, install KB5091375 on BizTalk Server 2020 and reconfigure SB-Messaging ' +
      'handlers to AMQP; (2) prioritize migrating SB-Messaging / MSMQ integrations to Logic Apps ' +
      'Standard with the built-in serviceBus connector (AMQP by default); (3) validate firewall ' +
      'rules for AMQP ports 5671/5672, which SBMP did not require.',
    baseEffortDays: 1,
  },

  suspend: {
    capability: 'Suspend Shape',
    severity: 'medium' as RiskSeverity,
    description:
      'Suspend shapes halt orchestration execution until an administrator manually resumes ' +
      'the instance via BizTalk Admin Console. Logic Apps has no manual-resume capability ' +
      'at the action level.',
    mitigation:
      'Replace with an approval workflow: send a notification (email / Teams) to an operator, ' +
      'then wait for a callback using the HTTP Request trigger pattern. For automated resumption, ' +
      'use a Service Bus message as the resume signal and an Until loop waiting for it.',
    baseEffortDays: 2,
  },

  wcfNetNamedPipe: {
    capability: 'WCF-NetNamedPipe Adapter',
    severity: 'critical' as RiskSeverity,
    description:
      'WCF-NetNamedPipe is an in-process, machine-local IPC transport. It is fundamentally ' +
      'incompatible with cloud deployment — Logic Apps cannot communicate via named pipes ' +
      'and this adapter has no equivalent whatsoever in Azure.',
    mitigation:
      'Redesign required: the system communicating via named pipes must be updated. ' +
      'Options: (1) Expose the service via WCF-BasicHttp/WCF-WSHttp and use the Logic Apps ' +
      'HTTP connector, (2) Migrate the service to expose a REST API, ' +
      '(3) Use Azure Service Bus as the decoupled communication channel.',
    baseEffortDays: 8,
  },

  wcfNetTcp: {
    capability: 'WCF-NetTcp Adapter',
    severity: 'high' as RiskSeverity,
    description:
      'WCF-NetTcp uses TCP binary encoding which is not supported by standard HTTP-based ' +
      'connectors. Standard Logic Apps HTTP actions cannot connect to NetTcp endpoints directly.',
    mitigation:
      'Option A (preferred): Update the WCF service to also expose a REST/HTTP endpoint; ' +
      'use the Logic Apps HTTP connector with managed identity authentication. ' +
      'Option B: Deploy Azure Relay Hybrid Connections to proxy the NetTcp endpoint — ' +
      'this requires Azure Relay to be added to the required services.',
    baseEffortDays: 5,
  },

  customCSharpCode: {
    capability: 'Custom C# Helper Assemblies',
    severity: 'high' as RiskSeverity,
    description:
      'ExpressionShape or MessageAssignmentShape blocks call helper assembly methods ' +
      '(e.g., HelperClass.DoWork(msg)) that do not have direct WDL equivalents. The C# code ' +
      'cannot run inside a Logic Apps workflow without a host.',
    mitigation:
      'Use Logic Apps Local Code Functions (preferred): add a .NET class to the lib/custom folder ' +
      'of your Logic Apps project and invoke it via the Execute Code Function action. This runs ' +
      'in-process with the Logic Apps runtime — no separate deployment, no HTTP latency. ' +
      'Only use Azure Functions for code that is very large, needs its own scaling, ' +
      'or must be shared across multiple applications. ' +
      'For each ExpressionShape marked TODO in the workflow, create a corresponding local function stub.',
    baseEffortDays: 3,
  },

  scriptingFunctoid: {
    capability: 'Scripting Functoids (msxsl:script)',
    severity: 'high' as RiskSeverity,
    description:
      'BizTalk scripting functoids have two fundamentally different migration paths depending on ' +
      'the scripting language. Inline XSLT and Inline XSLT Call Template functoids embed pure ' +
      'XSLT and translate directly to Integration Account XSLT with no changes (LOW impact). ' +
      'Inline C#, Inline VB.NET, Inline JScript.NET, and External Assembly functoids compile to ' +
      'msxsl:script blocks (userCSharp: namespace). The Logic Apps Transform XML action uses ' +
      '.NET XSLT without the msxsl extension — these will cause transformation failures at runtime. ' +
      'Additionally, the Integration Account XSLT mapper only supports .NET 2.0 C# syntax: no ' +
      'LINQ, no lambda expressions, no var keyword. Check the <Script Language=\'..\'> attribute ' +
      'in the .btm XML to identify the scripting language for each functoid.',
    mitigation:
      'First identify the scripting language of each functoid (check <Script Language=\'..\'> in ' +
      'the .btm XML). Inline XSLT functoids: embed verbatim in the Integration Account XSLT — ' +
      'no change needed. Inline C#/VB.NET/JScript.NET/External Assembly: ' +
      'Option A (preferred): Rewrite as standard XSLT templates using built-in XSLT string/math ' +
      'functions (normalize-space, substring, translate). Option B: Extract to a Logic Apps Local ' +
      'Code Function (runs in-process, no separate service, .NET 6+ syntax). ' +
      'Each non-XSLT scripting functoid requires individual analysis.',
    baseEffortDays: 3,
  },

  scriptingFunctoidXslt: {
    capability: 'Scripting Functoids (Inline XSLT — directly portable)',
    severity: 'low' as RiskSeverity,
    description:
      'All scripting functoids in this map use Inline XSLT or Inline XSLT Call Template sub-types. ' +
      'These functoids embed pure XSLT 1.0 and do NOT generate userCSharp: extension function calls. ' +
      'They translate directly to the Integration Account XSLT stylesheet with no changes required.',
    mitigation:
      'Embed the Inline XSLT templates verbatim in the Integration Account XSLT stylesheet. ' +
      'Validate by uploading the XSLT to an Integration Account and running a test transform. ' +
      'No Local Code Function or Azure Function is required for this map.',
    baseEffortDays: 0,
  },

  customFunctoid: {
    capability: 'Custom Third-Party Functoids (compiled DLL)',
    severity: 'high' as RiskSeverity,
    description:
      'Functoid IDs ≥ 10000 are third-party compiled DLL functoids — not BizTalk built-ins and not ' +
      'inline scripting. Common sources include the BizTalk Mapper Extensions UtilityPack and other ' +
      'community or ISV libraries. These functoids contain compiled .NET code with no visible source ' +
      'in the .btm file — behavior cannot be inferred from the map XML alone. Logic Apps has no ' +
      'equivalent runtime for compiled functoid DLLs.',
    mitigation:
      'For each custom functoid: (1) identify the source DLL and namespace (visible in the .btm ' +
      'FunctoidID + <ScriptFunctoid> elements); (2) locate the original assembly and read the source ' +
      'code or documentation; (3) rewrite logic as standard XSLT functions, or extract to a Logic ' +
      'Apps Local Code Function (.NET 8 isolated worker, runs in-process). ' +
      'Common community functoids have direct XSLT equivalents — e.g. string padding → format-number(), ' +
      'GUID generator → Logic Apps guid() expression, Base64 encoder → base64().',
    baseEffortDays: 3,
  },

  multiPartMap: {
    capability: 'Multi-Part Maps (Multiple Source Schemas)',
    severity: 'high' as RiskSeverity,
    description:
      'BizTalk Mapper supports maps with multiple source schemas (multiple <SrcTree> entries in ' +
      'the .btm file). The Logic Apps Transform XML action (both Integration Account and Data ' +
      'Mapper) accepts a single XML input document. Multi-source enrichment maps require a ' +
      'workflow-level pre-merge step to combine all source documents before the Transform action.',
    mitigation:
      'Before the Transform action: (1) fetch each additional source document via SQL connector, ' +
      'HTTP action, or variable; (2) use a Compose action to build a merged XML document combining ' +
      'all source data under a single root element; (3) pass the merged document as the single ' +
      'Transform input. The XSLT selects from each source using its namespace prefix.',
    baseEffortDays: 2,
  },

  recordCountAbsolutePath: {
    capability: 'Record Count Functoid Absolute XPath',
    severity: 'medium' as RiskSeverity,
    description:
      'The BizTalk Record Count Functoid compiles to an absolute XPath: count(/s0:Root/Record). ' +
      'Inside a nested xsl:for-each, this returns the global total count for every parent — not ' +
      'the count of children for that specific parent. This is a silent wrong-count bug in BizTalk ' +
      'maps that use Record Count inside a nested loop. The bug replicates to Logic Apps because ' +
      'the XSLT is preserved verbatim.',
    mitigation:
      'In the generated XSLT, rewrite count(/absolute/path) inside xsl:for-each blocks to use ' +
      'relative XPath: count(Child) instead of count(/Root/Parent/Child). If the absolute path ' +
      'cannot be rewritten without schema analysis, flag for manual review.',
    baseEffortDays: 1,
  },

  generateDefaultFixedNodes: {
    capability: 'GenerateDefaultFixedNodes Schema Defaults',
    severity: 'medium' as RiskSeverity,
    description:
      'When a BizTalk map has GenerateDefaultFixedNodes=Yes (the BizTalk compiler default), the ' +
      'compiler auto-emits XSD schema default values for destination elements not explicitly mapped. ' +
      'The Logic Apps Integration Account XSLT engine does NOT apply schema defaults automatically ' +
      '— it only outputs what the XSLT explicitly constructs. Maps that relied on compiler-injected ' +
      'defaults will silently produce incomplete or schema-invalid output.',
    mitigation:
      'Scan the destination schema XSD for elements with default= or fixed= attributes. For each, ' +
      'add an explicit <xsl:choose><xsl:when>...</xsl:when><xsl:otherwise>{default-value}' +
      '</xsl:otherwise></xsl:choose> pattern in the XSLT.',
    baseEffortDays: 1,
  },

  numericSortMissingDataType: {
    capability: 'xsl:sort Missing data-type="number"',
    severity: 'low' as RiskSeverity,
    description:
      'BizTalk Mapper Sorting patterns use xsl:sort. Without data-type="number", numeric fields ' +
      'sort lexicographically (10 sorts before 2 as text). This is a silent data correctness bug ' +
      'in maps that use sorting on numeric fields. Maps migrated verbatim to Integration Account ' +
      'Transform will exhibit the same incorrect sort order.',
    mitigation:
      'Scan generated XSLT for <xsl:sort> elements that lack data-type="number" on fields with ' +
      'numeric-sounding names (Id, Amount, Count, Total, Price, Quantity, Number, Sequence). ' +
      'Add data-type="number" where numeric sort is intended.',
    baseEffortDays: 1,
  },

  databaseFunctoid: {
    capability: 'Database Functoids',
    severity: 'medium' as RiskSeverity,
    description:
      'Database functoids (DB Lookup, Value Extractor) execute SQL queries during map ' +
      'transformation. The Logic Apps Transform XML action cannot make database calls ' +
      'during transformation.',
    mitigation:
      'Decouple data enrichment from transformation: (1) Before the Transform action, ' +
      'call an Azure Function or SQL Server built-in connector to fetch reference data ' +
      'and store in a Logic Apps variable, (2) Pass the enrichment data as XSLT parameters ' +
      'or embed it into the input message before transformation.',
    baseEffortDays: 3,
  },

  customPipelineComponent: {
    capability: 'Custom Pipeline Components',
    severity: 'medium' as RiskSeverity,
    description:
      'Custom pipeline components implement IPipelineComponent and execute .NET code within ' +
      'the BizTalk pipeline. Logic Apps has no pipeline execution model — each stage must ' +
      'be an explicit action.',
    mitigation:
      'Three migration options depending on complexity: (1) Inline Code action (JavaScript, ' +
      'C#, or PowerShell) for simple transformations that fit in ~50 lines, (2) Local Functions ' +
      '(.NET code running in-process with the Logic Apps runtime) for moderate complexity with ' +
      'shared libraries, (3) Azure Function (separate service) for heavy compute or shared-across-workflows ' +
      'logic. Map pipeline stages: Decode → before trigger, Disassemble → Parse JSON/XML, ' +
      'Validate → Condition action, Assemble → Compose/Transform, Encode → after main logic.',
    baseEffortDays: 3,
  },

  flatFilePipelineOutput: {
    capability: 'Flat File Pipeline Component Output Difference',
    severity: 'medium' as RiskSeverity,
    description:
      'The Logic Apps built-in Flat File Decode action produces a different XML structure than ' +
      'the BizTalk FlatFileDisassembler pipeline component. BizTalk generates XML using the ' +
      'flat file schema\'s element names; Logic Apps produces a generic schema-agnostic structure. ' +
      'Downstream maps and validation expecting BizTalk\'s output XML will fail. ' +
      'Additionally, Logic Apps supports only a single Body schema — BizTalk flat files with ' +
      'separate Header, Body, and Trailer schemas require consolidation into one unified schema ' +
      'before migration.',
    mitigation:
      'For output structure differences: After switching to the Logic Apps Flat File Decode action, ' +
      'run the migration test suite against golden-master outputs. Update any downstream XSLT maps ' +
      'or XSD schemas that reference element names specific to BizTalk\'s flat file XML format. ' +
      'The VS Code Data Mapper extension can help visually remap between the old and new structures. ' +
      'For Header/Body/Trailer schemas: Consolidate into a single Body schema, representing ' +
      'header and trailer as record types within the unified schema.',
    baseEffortDays: 2,
  },

  bamTracking: {
    capability: 'Business Activity Monitoring (BAM)',
    severity: 'low' as RiskSeverity,
    description:
      'BizTalk BAM uses a SQL-based BAMPrimaryImport database and interceptors to track ' +
      'business-level KPIs and milestones. The Azure equivalent is Azure Business Process ' +
      'Tracking (now generally available), backed by Application Insights and Log Analytics.',
    mitigation:
      'Configure Azure Business Process Tracking: define tracking profiles that map to your ' +
      'existing BAM activity definitions. Business milestones become tracked properties on ' +
      'workflow runs. Existing BAM views can be recreated in Power BI connecting to the ' +
      'Log Analytics workspace. BAM alerts map to Azure Monitor alert rules.',
    baseEffortDays: 2,
  },

  multipleActivatingReceives: {
    capability: 'Multiple Activating Receive Shapes',
    severity: 'medium' as RiskSeverity,
    description:
      'Multiple activating Receive shapes create multiple entry points into the same ' +
      'orchestration instance. Logic Apps workflows have a single trigger — multiple entry ' +
      'points require separate workflows or a message dispatcher pattern.',
    mitigation:
      'Create one workflow per activating receive, OR create a dispatcher workflow that accepts ' +
      'all message types and routes to the appropriate sub-workflow via Switch action. ' +
      'The multi-entry pattern maps well to Fan-Out / multiple workflows sharing a common ' +
      'process workflow.',
    baseEffortDays: 3,
  },

  ediProcessing: {
    capability: 'EDI/AS2 Processing',
    severity: 'low' as RiskSeverity,
    description:
      'BizTalk EDI/AS2 uses built-in schemas and runtime support. Logic Apps handles EDI ' +
      'through an Integration Account with X12/EDIFACT schemas — functionally equivalent ' +
      'but requires Integration Account configuration and partner setup. ' +
      'NOTE: Integration Accounts are always billable once created: Free (~dev only), ' +
      'Basic (~$300/month), Standard (~$1,000/month). Include this in migration cost planning.',
    mitigation:
      'Create an Integration Account at the appropriate tier (Basic for typical B2B, Standard ' +
      'for large EDI schema sets or RosettaNet). Upload X12/EDIFACT schemas and configure ' +
      'trading partner agreements. Use Logic Apps X12/EDIFACT encode/decode actions which are ' +
      'direct equivalents. Partner agreements replace BizTalk party configuration. BizTalk EDI ' +
      'schemas are available in Microsoft\'s GitHub repository and can be uploaded directly.',
    baseEffortDays: 2,
  },

  messageAggregator: {
    capability: 'Message Aggregator / Sequential Convoy (Correlation Sets)',
    severity: 'high' as RiskSeverity,
    description:
      'The BizTalk MessageBox publish-subscribe aggregator (sequential convoy / correlation pattern) ' +
      'has no direct equivalent in Logic Apps. BizTalk uses correlation sets to correlate multiple ' +
      'inbound messages into a single long-running orchestration instance. Logic Apps workflows have ' +
      'a single trigger — multi-message aggregation requires explicit state management and a ' +
      'message-accumulation loop.',
    mitigation:
      'Recommended approach: replace BizTalk convoy/MessageBox aggregator with a Service Bus ' +
      'peekLockQueueMessagesV2 batch trigger + ForEach loop + dictionary variable keyed by ' +
      'CorrelationId. BizTalk correlation sets map directly to the Service Bus CorrelationId ' +
      'message property — no schema changes needed. XSD flat file schemas from BizTalk work ' +
      'as-is in Logic Apps Artifacts/Schemas/. Use a stateful workflow with an Until loop and ' +
      'Append to Array Variable to accumulate messages until the completion condition is met. ' +
      'For complex correlation with long-running state: store partial message batches in Azure ' +
      'Blob Storage or Cosmos DB keyed by CorrelationId between workflow runs. ' +
      'For hybrid topologies where Azure Service Bus is not reachable from on-premises ' +
      'publishers, the RabbitMQ built-in connector is the official hybrid answer for ' +
      'MessageBox-style publish-subscribe (broker runs on-premises or in the cloud; ' +
      'Logic Apps consumes via the built-in rabbitmq ServiceProvider connector).',
    baseEffortDays: 4,
  },
  swiftMt: {
    capability: 'SWIFT MT Accelerator',
    severity: 'high' as RiskSeverity,
    description:
      'BizTalk SWIFT accelerator handles SWIFT MT message parsing, validation, and routing ' +
      'via the SWIFT Message Pack for BizTalk. Azure Logic Apps has no native SWIFT MT connector. ' +
      'The Azure API for SWIFT (cloud-only) provides SWIFT connectivity but requires enrollment ' +
      'with your SWIFT service bureau and does not replicate the full BizTalk SWIFT pipeline behavior.',
    mitigation:
      'Option A (cloud): Enroll in Azure API for SWIFT — provides ISO 20022 and SWIFT MT support ' +
      'via managed connector. Requires SWIFT connectivity agreement and Service Bureau onboarding (~4–8 weeks). ' +
      'Option B (on-premises): Deploy Azure Functions with the SWIFT Alliance Access SDK or ' +
      'a third-party SWIFT library (e.g., SWIFTNet Link). ' +
      'In both cases, BizTalk SWIFT schemas (MT103, MT202, etc.) must be validated for compatibility ' +
      'with the chosen Azure integration path.',
    baseEffortDays: 10,
  },

  ibmCics: {
    capability: 'IBM CICS Adapter (Host Integration)',
    severity: 'critical' as RiskSeverity,
    description:
      'BizTalk adapters for IBM CICS communicate with mainframe transaction programs via ' +
      'LU 6.2 (SNA) or TCP/IP. Azure Logic Apps has no native CICS connector. ' +
      'This adapter requires on-premises mainframe access and SNA Server or Host Integration Server (HIS).',
    mitigation:
      'Required: Microsoft Host Integration Server (HIS) or Azure Logic Apps on-premises data gateway ' +
      'with HIS Transaction Integrator (TI). Deploy an Azure Function that wraps the HIS TI COM+ component ' +
      'and exposes it as an HTTP endpoint; call from Logic Apps via HTTP action. ' +
      'Alternatively, work with the mainframe team to expose CICS programs as REST APIs via IBM z/OS Connect.',
    baseEffortDays: 15,
  },

  ibmIms: {
    capability: 'IBM IMS Adapter (Host Integration)',
    severity: 'critical' as RiskSeverity,
    description:
      'BizTalk adapters for IBM IMS communicate with IMS transaction programs via LU 6.2 or TCP/IP. ' +
      'Azure Logic Apps has no native IMS connector. Like CICS, this requires Host Integration Server ' +
      'and on-premises mainframe connectivity.',
    mitigation:
      'Same path as CICS: Host Integration Server (HIS) + Transaction Integrator (TI) wrapped in ' +
      'an Azure Function, exposed as HTTP. Alternatively, expose IMS programs via IBM IMS Connect ' +
      'and access via TCP socket from an Azure Function. ' +
      'Coordinate with mainframe operations team — IMS metadata (PCBs, DBDs) must be re-imported into HIS TI.',
    baseEffortDays: 15,
  },

  vasmHostFile: {
    capability: 'IBM Host File / VSAM Adapter',
    severity: 'high' as RiskSeverity,
    description:
      'BizTalk Host File adapter accesses VSAM (Virtual Storage Access Method) files and ' +
      'sequential datasets on IBM mainframes via Host Integration Server. ' +
      'Azure Logic Apps has no native VSAM or Host File connector.',
    mitigation:
      'Option A: Use Host Integration Server (HIS) Managed Data Provider for Host Files — ' +
      'wrap in an Azure Function exposed as HTTP; call from Logic Apps. ' +
      'Option B: Work with mainframe team to expose VSAM data as DB2 tables (if applicable) ' +
      'and use the Logic Apps IBM Db2 built-in connector. ' +
      'Option C: Implement a batch extract/load process — mainframe produces flat files, ' +
      'Azure picks them up via SFTP or Azure Blob. Not real-time, but often sufficient.',
    baseEffortDays: 8,
  },

} satisfies Record<string, GapDefinition>;

// ─── Adapters with known gaps ─────────────────────────────────────────────────

const ADAPTER_GAPS: Record<string, GapDefinition> = {
  'WCF-NetNamedPipe': GAP_DEFS.wcfNetNamedPipe,
  'WCF-NetTcp':       GAP_DEFS.wcfNetTcp,

  // Azure Relay adapters
  'WCF-BasicHttpRelay': {
    capability: 'WCF-BasicHttpRelay Adapter (Azure Service Bus Relay)',
    severity: 'medium' as RiskSeverity,
    description:
      'WCF-BasicHttpRelay routes traffic through Azure Service Bus Relay (now Azure Relay). ' +
      'Logic Apps has no native Azure Relay connector — the relay endpoint is not directly addressable ' +
      'from a Logic Apps HTTP action without additional infrastructure.',
    mitigation:
      'Option A: Replace Azure Relay with a direct HTTPS endpoint — deploy the on-premises service ' +
      'behind an API Management gateway or Azure Application Gateway with a public endpoint. ' +
      'Option B: Use the on-premises data gateway for direct on-premises connectivity from Logic Apps. ' +
      'Option C: Re-expose the on-premises service via Azure Hybrid Connections (WebSocket-based, ' +
      'no firewall changes required) and call it via HTTP action.',
    baseEffortDays: 3,
  },
  'WCF-NetTcpRelay': {
    capability: 'WCF-NetTcpRelay Adapter (Azure Service Bus Relay)',
    severity: 'high' as RiskSeverity,
    description:
      'WCF-NetTcpRelay uses the binary TCP WCF binding tunnelled through Azure Service Bus Relay. ' +
      'Logic Apps cannot speak the binary TCP WCF wire format and has no Azure Relay connector.',
    mitigation:
      'Same path as WCF-NetTcp: wrap the on-premises WCF endpoint in an Azure Function that speaks ' +
      'HTTP to Logic Apps and binary TCP internally to the service. Alternatively, re-expose the ' +
      'service as a REST/JSON endpoint and replace the relay with direct HTTPS + on-premises data gateway.',
    baseEffortDays: 5,
  },

  // SWIFT accelerator
  'SWIFT':            GAP_DEFS.swiftMt,
  'SWIFTAdapter':     GAP_DEFS.swiftMt,
  'Swift':            GAP_DEFS.swiftMt,

  // IBM mainframe adapters (via Host Integration Server)
  'CICS':             GAP_DEFS.ibmCics,
  'IBMCics':          GAP_DEFS.ibmCics,
  'IBM CICS':         GAP_DEFS.ibmCics,
  'IMS':              GAP_DEFS.ibmIms,
  'IBMIms':           GAP_DEFS.ibmIms,
  'IBM IMS':          GAP_DEFS.ibmIms,
  'HostFile':         GAP_DEFS.vasmHostFile,
  'IBMHostFile':      GAP_DEFS.vasmHostFile,
  'VSAM':             GAP_DEFS.vasmHostFile,

  'WCF-Custom': {
    capability: 'WCF-Custom Adapter',
    severity: 'medium' as RiskSeverity,
    description:
      'WCF-Custom is a wrapper adapter that hosts an arbitrary WCF binding (NetTcp, NetNamedPipe, ' +
      'or a custom binding element chain). The actual transport cannot be determined without parsing ' +
      'TransportTypeData — it may hide a non-migratable binding (e.g. NetNamedPipe).',
    mitigation:
      'Inspect the binding type in TransportTypeData of the adapter configuration. ' +
      'If the inner binding is HTTP-based, use the Logic Apps HTTP connector. ' +
      'If NetTcp, follow the WCF-NetTcp mitigation. ' +
      'If NetNamedPipe, redesign is required — no Azure equivalent.',
    baseEffortDays: 1,
  },
};

// ─── Gap factory ──────────────────────────────────────────────────────────────

function makeGap(def: GapDefinition, effortDays: number, artifacts: string[]): MigrationGap {
  return {
    capability:           def.capability,
    severity:             def.severity,
    description:          def.description,
    mitigation:           def.mitigation,
    estimatedEffortDays:  effortDays,
    affectedArtifacts:    artifacts,
  };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Identifies all migration gaps in a BizTalk application.
 * Returns gaps sorted by severity (critical first).
 */
export function analyzeGaps(app: BizTalkApplication): MigrationGap[] {
  const gapMap = new Map<string, MigrationGap>();

  function merge(def: GapDefinition, effortDelta: number, artifact: string): void {
    const existing = gapMap.get(def.capability);
    if (existing) {
      if (!existing.affectedArtifacts.includes(artifact)) {
        existing.affectedArtifacts.push(artifact);
        existing.estimatedEffortDays += effortDelta;
      }
    } else {
      gapMap.set(def.capability, makeGap(def, def.baseEffortDays, [artifact]));
    }
  }

  // ── Orchestration gaps ───────────────────────────────────────────────────
  for (const orch of app.orchestrations) {
    for (const gap of orchestrationGaps(orch)) {
      merge(gap.def, gap.effortDelta, orch.name);
    }
  }

  // ── Map gaps ─────────────────────────────────────────────────────────────
  for (const map of app.maps) {
    for (const gap of mapGaps(map)) {
      merge(gap.def, gap.effortDelta, map.name);
    }
  }

  // ── Pipeline gaps ────────────────────────────────────────────────────────
  for (const pipeline of app.pipelines) {
    for (const gap of pipelineGaps(pipeline)) {
      merge(gap.def, gap.effortDelta, pipeline.name);
    }
  }

  // ── Adapter gaps (from binding files) ────────────────────────────────────
  for (const binding of app.bindingFiles) {
    for (const rl of binding.receiveLocations) {
      const def = ADAPTER_GAPS[rl.adapterType];
      if (def) merge(def, 0, rl.name);
    }
    for (const sp of binding.sendPorts) {
      const def = ADAPTER_GAPS[sp.adapterType];
      if (def) merge(def, 0, sp.name);
    }
  }

  // ── SBMP retirement (SB-Messaging / MSMQ-family adapters) ────────────────
  // Dated rule: Service Bus retires SBMP on 30 September 2026. The BizTalk
  // SB-Messaging adapter uses SBMP by default (BizTalk 2020 needs KB5091375
  // for AMQP). MSMQ / WCF-NetMsmq are included because their migration target
  // is Service Bus and the interim estate commonly bridges via SB-Messaging.
  const SBMP_ADAPTERS = ['SB-Messaging', 'SBMessaging', 'WCF-NetMsmq', 'MSMQ'];
  for (const binding of app.bindingFiles) {
    for (const rl of binding.receiveLocations) {
      if (SBMP_ADAPTERS.includes(rl.adapterType)) merge(GAP_DEFS.sbmpRetirement, 0, rl.name);
    }
    for (const sp of binding.sendPorts) {
      if (SBMP_ADAPTERS.includes(sp.adapterType)) merge(GAP_DEFS.sbmpRetirement, 0, sp.name);
    }
  }

  // ── Multiple activating receives ─────────────────────────────────────────
  const multiActivating = app.orchestrations.filter(o => o.activatingReceiveCount > 1);
  if (multiActivating.length > 0) {
    const gap = makeGap(
      GAP_DEFS.multipleActivatingReceives,
      GAP_DEFS.multipleActivatingReceives.baseEffortDays,
      multiActivating.map(o => o.name)
    );
    gapMap.set(gap.capability, gap);
  }

  // ── Flat file pipeline components ─────────────────────────────────────────
  function isFlatFileComponent(c: { fullTypeName: string; componentType: string }): boolean {
    const tn = c.fullTypeName.toLowerCase();
    return (
      tn.includes('flatfile') ||
      tn.includes('ffdasm') ||
      tn.includes('ffasm') ||
      c.componentType === 'FlatFileDasmComp' ||
      c.componentType === 'FlatFileAsmComp' ||
      c.componentType === 'FFDasmComp' ||
      c.componentType === 'FFAsmComp'
    );
  }

  const flatFileInUse = app.pipelines.some(p => p.components.some(isFlatFileComponent));
  if (flatFileInUse && !gapMap.has(GAP_DEFS.flatFilePipelineOutput.capability)) {
    gapMap.set(
      GAP_DEFS.flatFilePipelineOutput.capability,
      makeGap(
        GAP_DEFS.flatFilePipelineOutput,
        GAP_DEFS.flatFilePipelineOutput.baseEffortDays,
        app.pipelines
          .filter(p => p.components.some(isFlatFileComponent))
          .map(p => p.name)
      )
    );
  }

  // ── BAM tracking (heuristic: orchestrations with correlation sets or long-running txns) ──
  const bamLikely =
    app.orchestrations.some(o => o.correlationSets.length > 0 || o.hasLongRunningTransactions) ||
    app.pipelines.some(p =>
      p.components.some(c =>
        c.fullTypeName.toLowerCase().includes('bam') ||
        c.fullTypeName.toLowerCase().includes('tracking')
      )
    );
  if (bamLikely && !gapMap.has(GAP_DEFS.bamTracking.capability)) {
    gapMap.set(
      GAP_DEFS.bamTracking.capability,
      makeGap(GAP_DEFS.bamTracking, GAP_DEFS.bamTracking.baseEffortDays, ['BAM tracking configuration'])
    );
  }

  // ── EDI/AS2 pipelines ────────────────────────────────────────────────────
  const ediInUse =
    app.bindingFiles.flatMap(b => b.receiveLocations).some(rl =>
      rl.pipelineName.toLowerCase().includes('edi') ||
      rl.pipelineName.toLowerCase().includes('as2')
    ) ||
    app.pipelines.some(p =>
      p.components.some(c =>
        c.fullTypeName.toLowerCase().includes('edi') ||
        c.fullTypeName.toLowerCase().includes('as2') ||
        c.fullTypeName.toLowerCase().includes('x12') ||
        c.fullTypeName.toLowerCase().includes('edifact')
      )
    ) ||
    app.schemas.some(s => s.isEDISchema);

  if (ediInUse && !gapMap.has(GAP_DEFS.ediProcessing.capability)) {
    gapMap.set(
      GAP_DEFS.ediProcessing.capability,
      makeGap(GAP_DEFS.ediProcessing, GAP_DEFS.ediProcessing.baseEffortDays, ['EDI/AS2 configuration'])
    );
  }

  // Sort: critical → high → medium → low
  const ORDER: RiskSeverity[] = ['critical', 'high', 'medium', 'low'];
  return Array.from(gapMap.values()).sort(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity)
  );
}

// ─── Per-artifact gap extractors ──────────────────────────────────────────────

interface GapHit { def: GapDefinition; effortDelta: number }

/** Returns true if the C# expression looks like a helper assembly method call. */
function isComplexCSharp(expr: string): boolean {
  return (
    /\w+\.\w+\(/.test(expr) ||       // method calls like Helper.Process(msg)
    expr.includes('namespace ') ||    // namespace declarations
    expr.includes('using ') ||        // using statements
    expr.split('\n').length > 3        // multi-line code blocks
  );
}

/** Recursively collects all ExpressionShape/MessageAssignmentShape code expressions. */
function collectExpressions(shapes: OdxShape[]): string[] {
  const exprs: string[] = [];
  for (const shape of shapes) {
    if (
      (shape.shapeType === 'ExpressionShape' || shape.shapeType === 'MessageAssignmentShape') &&
      shape.codeExpression
    ) {
      exprs.push(shape.codeExpression);
    }
    if (shape.children) exprs.push(...collectExpressions(shape.children));
  }
  return exprs;
}

function orchestrationGaps(orch: ParsedOrchestration): GapHit[] {
  const hits: GapHit[] = [];
  if (orch.hasAtomicTransactions)     hits.push({ def: GAP_DEFS.atomicTransaction,     effortDelta: 2 });
  if (orch.hasLongRunningTransactions) hits.push({ def: GAP_DEFS.longRunningTransaction, effortDelta: 1 });
  if (orch.hasCompensation)            hits.push({ def: GAP_DEFS.compensation,           effortDelta: 2 });
  if (orch.hasBRECalls)                hits.push({ def: GAP_DEFS.brePolicy,              effortDelta: 1 });
  if (orch.hasSuspend)                 hits.push({ def: GAP_DEFS.suspend,                effortDelta: 1 });

  // Detect correlation sets → Message Aggregator / Sequential Convoy pattern
  if (orch.correlationSets.length > 0) {
    hits.push({ def: GAP_DEFS.messageAggregator, effortDelta: orch.correlationSets.length });
  }

  // Detect ExpressionShapes with complex C# code (helper assembly calls)
  const complexExprs = collectExpressions(orch.shapes).filter(isComplexCSharp);
  if (complexExprs.length > 0) {
    hits.push({ def: GAP_DEFS.customCSharpCode, effortDelta: Math.min(complexExprs.length, 5) });
  }

  return hits;
}

function mapGaps(map: ParsedMap): GapHit[] {
  const hits: GapHit[] = [];

  if (map.hasScriptingFunctoids) {
    const scriptingFunctoids = map.functoids.filter(f => f.isScripting);
    const count = scriptingFunctoids.length;

    // EMAP-05: Distinguish Inline XSLT (directly portable, LOW) from Inline C#/VB/JScript (HIGH).
    // An Inline XSLT functoid's scriptCode contains <xsl: elements; it does NOT generate userCSharp: calls.
    // If scriptLanguage is set by the parser, use it; otherwise fall back to heuristic.
    const inlineXsltFunctoids = scriptingFunctoids.filter(f =>
      f.scriptLanguage === 'xslt' ||
      (!f.scriptLanguage && (f.scriptCode?.includes('<xsl:') ?? false))
    );
    const allInlineXslt = inlineXsltFunctoids.length === count && count > 0;

    if (allInlineXslt) {
      // All Inline XSLT — directly portable to Integration Account, LOW severity
      hits.push({ def: GAP_DEFS.scriptingFunctoidXslt, effortDelta: 0 });
    } else {
      // At least one Inline C#/VB/JScript/External Assembly — requires Local Code Function, HIGH severity
      hits.push({ def: GAP_DEFS.scriptingFunctoid, effortDelta: Math.max(1, count) });
    }
  }

  // EMAP-05 secondary: catch userCSharp: in xsltContent even if parser didn't flag hasScriptingFunctoids
  if (!map.hasScriptingFunctoids && map.xsltContent?.includes('userCSharp:')) {
    hits.push({
      def: {
        capability: GAP_DEFS.scriptingFunctoid.capability,
        severity: 'high' as RiskSeverity,
        description:
          GAP_DEFS.scriptingFunctoid.description +
          ' userCSharp: extension calls detected in extracted XSLT — functoid type may not ' +
          'have been flagged by the Stage 1 parser.',
        mitigation: GAP_DEFS.scriptingFunctoid.mitigation,
        baseEffortDays: GAP_DEFS.scriptingFunctoid.baseEffortDays,
      },
      effortDelta: 1,
    });
  }

  // Custom third-party DLL functoids (ID >= 10000)
  const customFunctoids = map.functoids.filter(f => f.category === 'custom');
  if (customFunctoids.length > 0) {
    hits.push({ def: GAP_DEFS.customFunctoid, effortDelta: customFunctoids.length });
  }

  if (map.hasDatabaseFunctoids) {
    hits.push({ def: GAP_DEFS.databaseFunctoid, effortDelta: 1 });
  }

  // EMAP-06: Multi-part map detection (multiple source schemas)
  const additionalSourceCount = map.additionalSourceSchemaRefs?.length ?? 0;
  if (additionalSourceCount > 0) {
    hits.push({ def: GAP_DEFS.multiPartMap, effortDelta: additionalSourceCount });
  }

  // EGAP-03: GenerateDefaultFixedNodes — IA XSLT engine doesn't auto-apply schema defaults
  if (map.mapProperties?.generateDefaultFixedNodes) {
    hits.push({ def: GAP_DEFS.generateDefaultFixedNodes, effortDelta: 1 });
  }

  // EGAP-02: Record Count Functoid using absolute XPath inside nested for-each (requires xsltContent)
  if (map.xsltContent && /count\(\//.test(map.xsltContent)) {
    hits.push({ def: GAP_DEFS.recordCountAbsolutePath, effortDelta: 1 });
  }

  // EGAP-05: xsl:sort missing data-type="number" on what may be numeric fields (requires xsltContent)
  if (map.xsltContent &&
      /<xsl:sort/.test(map.xsltContent) &&
      !/<xsl:sort[^>]*data-type="number"/.test(map.xsltContent)) {
    hits.push({ def: GAP_DEFS.numericSortMissingDataType, effortDelta: 1 });
  }

  return hits;
}

// Known community pipeline component class name fragments → targeted gap descriptions.
// These are well-documented components with known migration paths.
const KNOWN_COMMUNITY_COMPONENTS: Array<{ fragment: string; note: string }> = [
  {
    fragment: 'JSONEncoder',
    note: 'JSON encoding: replace with Logic Apps built-in JSON() expression or Liquid transform.',
  },
  {
    fragment: 'JSONDecoder',
    note: 'JSON decoding: replace with Logic Apps Parse JSON action using a generated schema.',
  },
  {
    fragment: 'ZipDeflate',
    note: 'ZIP/deflate compression: replace with Logic Apps Data Operations or Azure Function.',
  },
  {
    fragment: 'ZipInflate',
    note: 'ZIP/inflate decompression: replace with Azure Function (.NET DeflateStream).',
  },
  {
    fragment: 'PdfDecoder',
    note: 'PDF extraction: replace with Azure Function using a PDF parsing library (e.g. iText, PdfSharp).',
  },
  {
    fragment: 'RemoveXmlNamespace',
    note: 'Namespace removal: replace with an XSLT identity transform that strips namespace declarations.',
  },
  {
    fragment: 'FlatFileDecoder',
    note: 'Custom flat-file decoder: replace with Logic Apps Flat File Decode action or Azure Function for exact parity.',
  },
  {
    fragment: 'FlatFileEncoder',
    note: 'Custom flat-file encoder: replace with Logic Apps Flat File Encode action or Azure Function.',
  },
  {
    fragment: 'Base64Encoder',
    note: 'Base64 encoding: replace with Logic Apps base64() WDL expression — no custom component needed.',
  },
  {
    fragment: 'Base64Decoder',
    note: 'Base64 decoding: replace with Logic Apps base64ToString() WDL expression.',
  },
];

function pipelineGaps(pipeline: ParsedPipeline): GapHit[] {
  if (!pipeline.hasCustomComponents) return [];

  const customComponents = pipeline.components.filter(c => c.isCustom);
  const hits: GapHit[] = [];

  for (const comp of customComponents) {
    // Check if this is a known community component with a specific migration note
    const known = KNOWN_COMMUNITY_COMPONENTS.find(k =>
      comp.fullTypeName.includes(k.fragment) || comp.componentType.includes(k.fragment)
    );

    if (known) {
      hits.push({
        def: {
          capability: `Custom Pipeline Component: ${comp.componentType}`,
          severity: 'medium' as RiskSeverity,
          description:
            `The pipeline contains a known community custom component (${comp.fullTypeName}). ` +
            'This component has no direct Logic Apps equivalent but has a documented migration path.',
          mitigation: known.note,
          baseEffortDays: 1,
        },
        effortDelta: 0,
      });
    }
  }

  // Roll up remaining unknown custom components into a single generic gap
  const unknownCount = customComponents.filter(c =>
    !KNOWN_COMMUNITY_COMPONENTS.some(k =>
      c.fullTypeName.includes(k.fragment) || c.componentType.includes(k.fragment)
    )
  ).length;

  if (unknownCount > 0) {
    hits.push({ def: GAP_DEFS.customPipelineComponent, effortDelta: unknownCount });
  }

  return hits;
}
