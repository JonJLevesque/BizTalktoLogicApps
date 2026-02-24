# Migration Decision Trees

> **Purpose**: Systematic decision trees to determine the correct Logic Apps patterns for each migration scenario.
> **Last updated**: 2026-02-23

---

## 1. Which Logic Apps SKU?

```
Step 1: What is the primary hosting requirement?

  Need on-premises connectivity (private network, no public endpoint)?
    YES → Is Azure VNET injection acceptable (managed compute)?
      YES → Logic Apps STANDARD (VNET integration)
      NO  → Logic Apps STANDARD (Hybrid / Azure Arc)

  Need long-running workflows (> 90 days)?
    YES → Logic Apps STANDARD (Stateful, up to 1 year)

  Need stateful execution (dehydration/rehydration)?
    YES → Logic Apps STANDARD (Stateful workflow type)

  Need custom built-in connectors (ServiceProvider, in-process)?
    YES → Logic Apps STANDARD

  Need EDI / B2B integration (X12, EDIFACT, AS2)?
    YES → Either SKU + Integration Account
         (Standard: Integration Account optional for some features)
         (Consumption: Integration Account required for EDI)

  High throughput (> 50 msg/sec sustained)?
    YES → Logic Apps STANDARD (dedicated plan, configurable concurrency)

  Simple, stateless, cloud-only workflows?
    → Logic Apps CONSUMPTION is viable BUT:
    → STANDARD preferred for new BizTalk migrations (parity with BizTalk's stateful model)

RECOMMENDATION: Default to STANDARD for all BizTalk migrations.
  - Stateful execution matches BizTalk orchestration model
  - Built-in ServiceProvider connectors avoid managed connector latency
  - VNET integration matches BizTalk's private network access
  - Per-workflow pricing better for high-volume, predictable workloads
```

---

## 2. Which Connector Type?

```
Step 1: Does the target system have a Microsoft-provided built-in (ServiceProvider) connector?

  Check: /serviceProviders/ catalog in Logic Apps Standard
  Key available built-ins: serviceBus, AzureBlob, sql, sftp, ftp, smtp, eventHubs, documentDb (Cosmos)

  YES, built-in available?
    → USE BUILT-IN (ServiceProvider)
    → Reason: in-process execution, lower latency, no managed connector overhead
    → Config: serviceProviderConnections in connections.json

  NO built-in?
    Step 2: Is it in the managed connector catalog (1,400+ connectors)?
      Check: https://aka.ms/logicapps-connectors

      YES, managed connector available?
        Step 3: Does the target require on-premises / private network access?
          YES → Use MANAGED connector + On-Premises Data Gateway
          NO  → Use MANAGED connector (ApiConnection)

      NO managed connector?
        Step 4: Is the target accessible via HTTP/REST?
          YES → Use built-in HTTP action (no connector overhead)
               → Auth options: None, Basic, OAuth, Certificate, Managed Identity

          NO (proprietary protocol, TCP, named pipe)?
            Step 5: Is there a .NET client library for the protocol?
              YES → Build AZURE FUNCTION wrapping the protocol
                   → Call Azure Function from Logic Apps via HTTP action
              NO  → Redesign endpoint to expose HTTP API
                   → OR: Use Azure Relay for WCF scenarios
```

### Connector Decision Quick-Reference

| Target | Connector Type | Notes |
|---|---|---|
| Azure Service Bus | Built-in (serviceBus) | Use for all queue/topic operations |
| Azure Blob Storage | Built-in (AzureBlob) | File receive/send via blob |
| Azure SQL / SQL Server (cloud) | Built-in (sql) | Direct SQL, stored procs |
| SQL Server (on-prem) | Built-in (sql) + Gateway | Requires on-prem data gateway |
| SFTP | Built-in (sftp) | Direct mapping from BizTalk SFTP |
| FTP | Built-in (ftp) | Direct mapping from BizTalk FTP |
| SMTP | Built-in (smtp) | Direct from BizTalk SMTP adapter |
| Azure Cosmos DB | Built-in (documentDb) | Document operations |
| Azure Event Hubs | Built-in (eventHubs) | High-throughput event ingestion |
| IBM MQ | Built-in (Standard only) | MQSeries/WebSphere MQ migration |
| SAP ERP (on-prem) | Managed + Gateway | Requires SAP connector + gateway |
| SAP (Azure/RISE) | Managed (cloud) | No gateway needed |
| Oracle DB | Managed | Via managed Oracle connector |
| SharePoint (Online) | Managed | No gateway needed |
| SharePoint (on-prem) | Managed + Gateway | On-premises data gateway |
| Office 365 / Exchange | Managed | Microsoft 365 services |
| HTTP/REST (any) | Built-in HTTP action | Universal fallback |
| WCF-BasicHttp | HTTP action | POST with SOAP headers |
| WCF-NetTcp | Azure Functions | .NET WCF client in Functions |
| WCF-NetNamedPipe | **Redesign required** | N/A |

---

## 3. Which Transformation Approach?

```
Step 1: What is the source data format?

  XML → XML transformation?
    Step 2: Does the BizTalk map contain scripting functoids?
      Check: Look for <ScriptBuffer> in .btm file content
      YES → Scripting functoids present
        Step 3: What does the script do?
          Simple string ops → REWRITE AS XSLT (remove msxsl:script, use XSLT functions)
          Date calculations → Azure Function helper OR WDL expression in XSLT
          Complex C# logic → AZURE FUNCTION (preserve logic, wrap in HTTP endpoint)
          External lookups → AZURE FUNCTION (can call DB/HTTP inside Functions)

      NO → Pure BizTalk functoids only
        Step 4: How complex is the mapping?
          Simple (< 20 links, basic functoids only) → DATA MAPPER LML (YAML format)
          Complex (20–100 links, multiple functoid chains) → XSLT (preserve map logic)
          Very complex (100+ links, looping, complex conditionals) → XSLT + review

  XML → JSON?
    → DATA MAPPER LML (recommended for JSON output)
    → OR: XSLT 3.0 (supports JSON output, requires custom XSLT processor)
    → OR: Azure Functions (complete control)

  JSON → JSON?
    → DATA MAPPER LML
    → OR: Liquid template (for simpler transformations)
    → OR: Compose action with WDL expressions (for trivial mappings)

  JSON → XML?
    → DATA MAPPER LML
    → OR: Azure Functions

  Flat file (CSV, fixed-width) → XML/JSON?
    → Azure Functions (custom parser)
    → OR: Data Mapper Flat File connector (Logic Apps Standard, preview)

  EDI (X12, EDIFACT) → XML?
    → Integration Account: X12 Decode / EDIFACT Decode action
    → Produces standard acknowledgement (997/CONTRL) automatically
```

### Transformation Quick-Reference

| Source | Target | Tool | Notes |
|---|---|---|---|
| XML | XML (simple) | Data Mapper LML | Preferred for new/simple maps |
| XML | XML (complex) | XSLT | Preserve BizTalk map logic where possible |
| XML | XML (with C# functoids) | XSLT (rewritten) or Azure Functions | msxsl:script must be removed |
| XML | JSON | Data Mapper LML | Native JSON output support |
| JSON | JSON | Data Mapper LML or Compose | Use LML for non-trivial mappings |
| JSON | XML | Data Mapper LML or Azure Functions | Less common direction |
| Flat File | XML/JSON | Azure Functions | No native flat file disassembler in LA |
| EDI X12 | XML | X12 Decode (Integration Account) | Standard EDI handling |
| EDI EDIFACT | XML | EDIFACT Decode (Integration Account) | Standard EDI handling |
| HL7 | XML/FHIR | HL7 FHIR connector | Healthcare-specific managed connector |

---

## 4. Which Messaging Service?

```
Step 1: What is the primary requirement?

  Ordered message processing with correlation?
    → AZURE SERVICE BUS with Sessions (FIFO per session key)
    → Session ID = BizTalk correlation set value

  High throughput event streaming (> 1,000 events/sec)?
    → AZURE EVENT HUBS
    → Use Event Hubs trigger in Logic Apps

  Fan-out to many consumers (> 10 subscribers)?
    → AZURE EVENT GRID (publish once, subscribe many)
    → Or SERVICE BUS Topics (for queuing semantics + filters)

  Reliable queue with dead-letter support?
    → AZURE SERVICE BUS Queue
    → Dead-letter queue built in
    → Peek-lock + complete/dead-letter from Logic Apps

  Replacing MSMQ?
    → AZURE SERVICE BUS Queue (for simple queue replacement)
    → SERVICE BUS with Sessions (for transactional MSMQ)

  Replacing BizTalk MessageBox pub/sub?
    → SERVICE BUS Topic + Subscriptions with SQL filters
    → Filter by message property (replaces promoted property subscriptions)

  Time-based batching / scheduled processing?
    → SERVICE BUS with batch receiver
    → OR: Schedule trigger + SQL/Cosmos query for accumulated messages

  Replacing WCF-NetMsmq?
    → SERVICE BUS Queue (same semantics, cloud-native)
```

### Messaging Service Quick-Reference

| Scenario | Service | Tier |
|---|---|---|
| Simple queue | Service Bus Queue | Basic |
| Ordered processing (FIFO) | Service Bus Queue + Sessions | Standard |
| Pub/Sub with filtering | Service Bus Topic + Subscriptions | Standard |
| High-throughput streaming | Event Hubs | Standard / Dedicated |
| Event-driven fan-out | Event Grid | Standard |
| Transactional messaging | Service Bus + Outbox Pattern | Standard |
| Dead-letter queue | Service Bus Queue (DLQ built-in) | Basic |
| Message deferral | Service Bus Defer API | Standard |
| Scheduled messages | Service Bus ScheduledEnqueueTimeUtc | Standard |

---

## 5. Which Error Handling Pattern?

```
Step 1: What should happen when the action fails?

  Retry the same action?
    → Action retryPolicy (built-in to all actions)
    → Types: fixed, exponential, none
    → Max retries: 90 (Logic Apps Standard)
    → Use exponential for downstream service protection

  Dead-letter the message?
    → Service Bus peek-lock + deadLetterMessage action on failure
    → Scope action catches failure → deadLetterMessage in Scope catch

  Send to error queue / error handler?
    → Scope action + runAfter: [FAILED] → Service Bus send to error-queue

  Notify on failure?
    → Scope action + runAfter: [FAILED] → SMTP / Teams / Service Bus notification

  Compensate (undo previous steps)?
    → Scope action + runAfter: [FAILED] → compensating HTTP/connector actions
    → Must design compensation actions explicitly per step

  Terminate the workflow with error?
    → Terminate action: status=Failed, code="ErrorCode", message="details"

  Log and continue (best-effort)?
    → runAfter: [SUCCEEDED, FAILED] on logging action
    → Main flow continues regardless of intermediate action status

Step 2: Do you need error detail?
  → result() function: gets status, inputs, outputs, error of completed actions
  → @{result('ScopeName')[0]['error']['message']} = exception message
  → @{result('ScopeName')[0]['outputs']} = action outputs even on failure
```

### Error Pattern Quick-Reference

| BizTalk Pattern | Logic Apps Equivalent |
|---|---|
| Catch block in Scope | Scope action + runAfter: FAILED |
| Terminate orchestration on error | Terminate action (status: Failed) |
| Suspended queue (manual review) | Service Bus Dead Letter Queue |
| BizTalk error report message | Dead letter with error details in user properties |
| Retry N times | retryPolicy on action (type: fixed, count: N) |
| Retry with backoff | retryPolicy (type: exponential) |
| Compensation in catch block | Compensation actions in Scope catch branch |
| Escalation on timeout | runAfter: TIMEDOUT branch + notification action |
| Resume from suspended | Rerun from Run History / resubmit from DLQ workflow |

---

## 6. Orchestration Complexity → Migration Approach

```
Simple (score 0–10):
  Characteristics: linear flow, 1–5 shapes, no BRE, no transactions, standard adapters
  Approach: Direct migration — standard workflow JSON generation
  Timeline: 0.5–1 day per orchestration

Moderate (score 11–25):
  Characteristics: Decide/Switch routing, standard error handling, managed connectors, BAM tracking
  Approach: Guided migration with pattern library
  Timeline: 1–3 days per orchestration

Complex (score 26–50):
  Characteristics: Multiple correlation sets, BRE calls, custom pipeline components, parallel branches
  Approach: Architect-led migration with redesign for gap components
  Timeline: 3–10 days per orchestration + gap component work

Highly Complex (score 51+):
  Characteristics: MSDTC, WCF-NetTcp/NetNamedPipe, complex BRE hierarchies, atomic transactions
  Approach: Phased migration — start with gap mitigation, then migrate incrementally
  Timeline: 2–8 weeks per orchestration group
  Recommendation: Consider hybrid coexistence while redesigning critical components
```

---

## 7. BizTalk Application → Azure Architecture

```
Single orchestration, simple adapter:
  → 1 Logic Apps Standard workflow
  → Built-in connectors only
  → No Integration Account needed

Multiple orchestrations, shared logic:
  → Multiple Logic Apps workflows
  → Shared child workflows for common patterns
  → App Settings for shared configuration
  → Stateful Standard plan

B2B / EDI application:
  → Logic Apps Standard workflow
  → Integration Account (Standard tier) for maps/schemas/agreements
  → Service Bus for partner message routing
  → AS2/X12/EDIFACT actions from Integration Account

Complex orchestration suite with BRE:
  → Logic Apps Standard workflows
  → Azure Functions for BRE logic (or Azure Rules Engine)
  → Application Insights for observability
  → Key Vault for credentials

High-volume processing:
  → Logic Apps Standard with concurrency configuration
  → Event Hubs trigger (for stream processing)
  → Service Bus with sessions (for ordered processing)
  → Azure Monitor + alerts for throughput monitoring

On-premises integration:
  → Logic Apps Standard with VNET integration
  → On-premises data gateway (for SQL, SharePoint, File, SAP)
  → Azure ExpressRoute or VPN (for direct network access)
  → Private Endpoints for Azure resources

Legacy WCF (NetTcp) integration:
  → Logic Apps Standard + Azure Functions (.NET) for WCF client
  → Azure Relay (for WCF relay scenarios)
  → HTTP action from Logic Apps → Function → WCF service
```

---

## 8. Integration Account — When Is It Required?

```
Is EDI (X12 or EDIFACT) processing needed?
  YES → Integration Account REQUIRED
       (Decode/Encode operations require Integration Account maps and partners)

Is AS2 messaging needed?
  YES → Integration Account REQUIRED (certificates, partners, agreements)

Are there complex XSLT maps (> simple inline)?
  Logic Apps Standard: Integration Account OPTIONAL
    (Can reference local XSLT files in Standard project artifact folder)
  Logic Apps Consumption: Integration Account REQUIRED for maps

Are there XML schemas for validation?
  Logic Apps Standard: Integration Account OPTIONAL (inline schema in Validate action)
  Logic Apps Consumption: Integration Account REQUIRED for schema validation

RECOMMENDATION:
  Standard SKU: Integration Account optional unless EDI/AS2 or cross-workflow shared artifacts
  Consumption SKU: Integration Account required for any maps, schemas, EDI

Integration Account Tier Selection:
  Basic: X12 + EDIFACT only, no XML maps, no XSLT
  Standard: All artifacts (maps, schemas, assemblies, certificates, partners)
  Premium: Enterprise features (higher message counts, premium support)
  Free (developer): Same as Standard but usage-limited (not for production)
```
