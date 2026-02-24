# BizTalk Component to Logic Apps Component Mapping

> **Purpose**: Complete component-by-component mapping reference for migration planning.
> **Legend**: ✅ Direct equivalent | ⚠️ Partial (workaround required) | ❌ No equivalent (redesign)
> **Last updated**: 2026-02-23

---

## 1. Orchestration Shapes → Logic Apps Actions

### 1.1 Message Flow Shapes

| BizTalk Shape | Migration Status | Logic Apps Equivalent | Notes |
|---|---|---|---|
| **Receive** (activating) | ✅ Direct | Trigger (Request, ServiceProvider, Recurrence) | Polarity=Implements + activating=true → trigger |
| **Receive** (non-activating, correlated) | ⚠️ Partial | Action (HTTP GET, SB receive) | Correlation must be handled via workflow stateful tracking |
| **Send** (one-way) | ✅ Direct | HTTP action / ServiceProvider action | Map adapter type → connector |
| **Send** (request-reply) | ✅ Direct | HTTP action (with response) | Synchronous call, response captured in output |
| **Send** (solicited receive) | ⚠️ Partial | HTTP action + parse response | Split into send + parse-response steps |

### 1.2 Message Construction Shapes

| BizTalk Shape | Migration Status | Logic Apps Equivalent | Notes |
|---|---|---|---|
| **Construct Message** | ✅ Direct | Compose action | Container for construction logic |
| **Message Assignment** | ✅ Direct | Compose action or Set Variable | `MsgOut = MsgIn` → `"inputs": "@{triggerBody()}"` |
| **Transform** | ✅ Direct | Transform action (XSLT) or Data Mapper LML | BTM map → XSLT or LML; note msxsl:script compatibility |
| **Message Assignment** (field set) | ✅ Direct | Compose action with JSON expression | `Msg.Field = expr` → Compose with `@{...}` expression |

### 1.3 Control Flow Shapes

| BizTalk Shape | Migration Status | Logic Apps Equivalent | Notes |
|---|---|---|---|
| **Decide** | ✅ Direct | If action (Condition/True/False branches) | XLANG/s condition → WDL `@{equals(...)}` etc. |
| **Decide** (multi-branch) | ✅ Direct | Switch action | Multiple branches → cases with expressions |
| **Loop** | ✅ Direct | Until action | `do { ... } while (condition)` → Until loop |
| **ForEach** (message collection) | ⚠️ Partial | ForEach action | BizTalk envelope debatching vs LA iteration |
| **Listen** | ⚠️ Partial | Multiple triggers / Event Grid fan-out | First event wins → Event Grid + concurrent Logic Apps |
| **Delay** | ✅ Direct | Delay action or Delay-Until action | `System.TimeSpan` → ISO 8601 duration string |
| **Suspend** | ❌ No equivalent | Terminate with failure / manual intervention | No native suspend+resume in Logic Apps |
| **Terminate** | ✅ Direct | Terminate action | `"status": "Failed"` or `"Cancelled"` |

### 1.4 Parallel Processing Shapes

| BizTalk Shape | Migration Status | Logic Apps Equivalent | Notes |
|---|---|---|---|
| **Parallel Actions** | ✅ Direct | Multiple actions with same runAfter dependency | Actions with same predecessor run concurrently |
| **Synchronization Scope** | ⚠️ Partial | Join pattern with condition loops | No native fork-join primitive; use Until + flag variable |
| **Parallel Actions** + aggregation | ⚠️ Partial | ForEach (parallel) + Append To Array | Scatter-gather pattern requires array variable accumulation |

### 1.5 Orchestration Invocation Shapes

| BizTalk Shape | Migration Status | Logic Apps Equivalent | Notes |
|---|---|---|---|
| **Call Orchestration** | ✅ Direct | Workflow action (Standard) or HTTP action | `"type": "Workflow"` for same-app workflows |
| **Start Orchestration** | ✅ Direct | Workflow action (async) or Service Bus message | Fire-and-forget → trigger via Service Bus topic |
| **Call Rules** (BRE) | ⚠️ Partial | Azure Functions / inline condition logic | BRE rules → If/Switch + inline expressions or Functions |

### 1.6 Transaction / Compensation Shapes

| BizTalk Shape | Migration Status | Logic Apps Equivalent | Notes |
|---|---|---|---|
| **Scope** (exception handling) | ✅ Direct | Scope action with `runAfter: [Failed]` | Catch-equivalent using Scope + result() filter |
| **Scope** (transaction type Long Running) | ⚠️ Partial | Scope + compensation workflow pattern | Long-running workflows with stateful persistence |
| **Scope** (transaction type Atomic) | ❌ No equivalent | Manual compensation pattern | MSDTC not available; redesign with compensation logic |
| **Compensate** | ❌ No equivalent | Compensation workflow (manual design) | No built-in Compensate; design undo logic explicitly |
| **Throw** | ✅ Direct | Terminate action (status: Failed) | `throw new System.Exception(msg)` → Terminate + message |
| **Catch** | ✅ Direct | Scope action + runAfter: [Failed] actions | Error branch executed when parent scope fails |

### 1.7 Infrastructure Shapes

| BizTalk Shape | Migration Status | Logic Apps Equivalent | Notes |
|---|---|---|---|
| **Port** (receive) | ✅ Direct | Trigger configuration | Logical port → trigger connector |
| **Port** (send) | ✅ Direct | Action connector configuration | Logical port → action connector |
| **Role Link** | ❌ No equivalent | Static connector configuration | Dynamic partner routing not natively supported |
| **Correlation Set** | ⚠️ Partial | Stateful workflow + custom correlation expression | Correlation handled by durable execution engine |
| **Correlation Initialize** | ⚠️ Partial | Set Variable (workflow instance tracking) | Use unique ID in workflow run for pseudo-correlation |
| **Correlation Follow** | ⚠️ Partial | Workflow trigger condition / external trigger | Use trigger condition to filter by correlation value |

### 1.8 Expression / Assignment Shapes

| BizTalk Shape | Migration Status | Logic Apps Equivalent | Notes |
|---|---|---|---|
| **Expression** | ✅ Direct | Set Variable action | `variable.Value = expression` → SetVariable |
| **Message Assignment** | ✅ Direct | Compose action | `NewMsg = ExistingMsg` → Compose passthrough |

---

## 2. Pipeline Components → Logic Apps Equivalents

### 2.1 Receive Pipeline Components

| BizTalk Component | Stage | Migration Status | Logic Apps Equivalent |
|---|---|---|---|
| **XML Disassembler** | Disassemble | ✅ Direct | Parse JSON / Parse XML (HTTP body parsing) |
| **Flat File Disassembler** | Disassemble | ⚠️ Partial | Azure Functions (custom parser) or Data Mapper Flat File |
| **EDI Disassembler** | Disassemble | ✅ Direct | X12 Decode / EDIFACT Decode (Integration Account) |
| **MIME/SMIME Decoder** | Decode | ⚠️ Partial | HTTP trigger (multipart) + Compose parsing |
| **XML Validator** | Validate | ⚠️ Partial | Validate action (Integration Account schema) or Inline JSON Schema |
| **Party Resolution** | Resolve Party | ❌ No equivalent | Lookup table via Azure Table Storage / Cosmos DB |
| **BizTalk Framework Disassembler** | Disassemble | ❌ No equivalent | Not applicable (BTF deprecated) |

### 2.2 Send Pipeline Components

| BizTalk Component | Stage | Migration Status | Logic Apps Equivalent |
|---|---|---|---|
| **XML Assembler** | Assemble | ✅ Direct | Compose action (construct XML body) |
| **Flat File Assembler** | Assemble | ⚠️ Partial | Azure Functions (custom formatter) or Data Mapper |
| **EDI Assembler** | Assemble | ✅ Direct | X12 Encode / EDIFACT Encode (Integration Account) |
| **MIME/SMIME Encoder** | Encode | ⚠️ Partial | HTTP action with Content-Type multipart |
| **AS2 Encoder / Decoder** | Encode | ✅ Direct | AS2 actions (Integration Account) |
| **BizTalk Framework Assembler** | Assemble | ❌ No equivalent | Not applicable (BTF deprecated) |

### 2.3 Common Pipeline Scenarios

| BizTalk Pipeline | Equivalent Logic Apps Pattern |
|---|---|
| `XMLReceive` (default) | HTTP Request trigger + Parse JSON or Compose with body() |
| `PassThruReceive` | HTTP Request trigger, no body parsing needed |
| `XMLTransmit` (default) | HTTP action with XML body, Content-Type: application/xml |
| `PassThruTransmit` | HTTP action passing through raw body |
| Custom receive with XML validator | HTTP trigger + Validate action (Integration Account schema) |
| Custom receive with flat file disassembler | Azure Function to parse → invoke Logic Apps workflow |
| EDI receive pipeline | Service Bus trigger → X12/EDIFACT Decode action |
| EDI send pipeline | X12/EDIFACT Encode action → HTTP/Service Bus send |

---

## 3. Adapter → Connector Mapping Summary

> Full details in `connector-mapping.md`. This table provides a quick-reference view for planning.

| BizTalk Adapter | Logic Apps Connector | Gateway? | Complexity |
|---|---|---|---|
| FILE (cloud) | Azure Blob Storage (built-in) | No | ✅ Easy |
| FILE (on-prem) | File System (built-in + gateway) | Yes | ⚠️ Medium |
| FTP | FTP (built-in) | No | ✅ Easy |
| SFTP | SFTP-SSH (built-in) | No | ✅ Easy |
| HTTP/HTTPS (receive) | HTTP Request trigger | No | ✅ Easy |
| HTTP/HTTPS (send) | HTTP action | No | ✅ Easy |
| SOAP (receive) | HTTP Request trigger | No | ✅ Easy |
| SOAP (send) | HTTP action | No | ✅ Easy |
| WCF-BasicHttp | HTTP action | No | ✅ Easy |
| WCF-WSHttp | HTTP action + WS-Security headers | No | ⚠️ Medium |
| WCF-NetTcp | Azure Functions (.NET) | Varies | ❌ Hard |
| WCF-NetNamedPipe | **NOT MIGRATABLE** | N/A | ❌ Redesign |
| WCF-NetMsmq | Azure Service Bus (built-in) | No | ⚠️ Medium |
| MSMQ | Azure Service Bus (built-in) | No | ⚠️ Medium |
| Service Bus (SB-Messaging) | Azure Service Bus (built-in) | No | ✅ Easy |
| Event Hubs | Azure Event Hubs (built-in) | No | ✅ Easy |
| MQSeries / WebSphere MQ | IBM MQ (built-in Standard) | No | ⚠️ Medium |
| SQL Server (on-prem) | SQL Server (built-in + gateway) | Yes | ⚠️ Medium |
| SQL Server (Azure) | SQL Server (built-in) | No | ✅ Easy |
| Oracle DB | Oracle Database (managed) | Varies | ⚠️ Medium |
| SAP (on-prem) | SAP ERP (managed + gateway) | Yes | ⚠️ Medium |
| POP3 / Exchange | Office 365 Outlook (managed) | No | ✅ Easy |
| SMTP | SMTP (built-in) | No | ✅ Easy |
| EDI (X12 / EDIFACT) | X12 / EDIFACT (Integration Account) | No | ⚠️ Medium |
| AS2 | AS2 (Integration Account) | No | ⚠️ Medium |
| SharePoint (on-prem) | SharePoint Server (managed + gateway) | Yes | ⚠️ Medium |
| SharePoint (Online) | SharePoint Online (managed) | No | ✅ Easy |
| Azure Blob Storage | Azure Blob Storage (built-in) | No | ✅ Easy |
| Azure Queue Storage | Azure Queue Storage (built-in) | No | ✅ Easy |

---

## 4. BizTalk Application Artifact → Logic Apps Artifact Mapping

| BizTalk Artifact | File Extension | Logic Apps Equivalent |
|---|---|---|
| Orchestration | .odx | workflow.json |
| Map | .btm | XSLT (.xsl) or LML (.yml) |
| Pipeline | .btp | Inline connector config or Azure Function |
| Schema | .xsd | JSON Schema (.json) or XSD (Integration Account) |
| Binding file | .xml (BindingInfo) | connections.json + app settings |
| BRE policy | .xml (RuleSet) | Azure Rules Engine / inline conditions |
| BAM definition | .xml (BAM) | Application Insights event tracking |
| SSO application | SSO config | Azure Key Vault secret |
| Orchestration port types | .odx references | Trigger/action connector type |
| Multi-part message type | .odx message def | JSON schema for structured message |
| Property schema | .xsd (property schema) | Context property mapping to trigger metadata |
| Receive port + locations | BindingInfo | Trigger(s) in workflow.json |
| Send port (static) | BindingInfo | Action connector config |
| Send port (dynamic) | BindingInfo + logic | Variable → HTTP URI / connector endpoint |
| Send port group | BindingInfo | Multiple parallel actions or conditional routing |
| Receive pipeline | .btp | Connector + inline body handling |
| Send pipeline | .btp | Connector + inline body construction |

---

## 5. Expression Shape → Action Mapping Reference

### 5.1 Variable Operations

| XLANG/s Pattern | Logic Apps Pattern |
|---|---|
| `string myVar;` | Initialize Variable action: type=string |
| `int counter = 0;` | Initialize Variable action: type=integer, value=0 |
| `myVar = "hello";` | Set Variable action: name=myVar, value="hello" |
| `counter = counter + 1;` | Increment Variable action: name=counter, value=1 |
| `myVar = System.String.Concat(a, b);` | Set Variable: value=`@{concat(variables('a'),variables('b'))}` |

### 5.2 Message Access Patterns

| BizTalk Pattern | Logic Apps Equivalent |
|---|---|
| `MyMessage.Field` (promoted property) | `@{triggerBody()?['Field']}` for trigger message |
| `xpath(MyMessage, "//ns:Element/text()")` | `@{xpath(xml(triggerBody()), '//ns:Element/text()')}` |
| `MyMessage(BTS.InboundTransportLocation)` | `@{triggerOutputs()?['headers']?['x-ms-workflow-run-id']}` (partial) |
| `MyMessage(BTS.MessageType)` | `@{triggerBody()?['$schema']}` (JSON) or XPath on XML body |
| `System.Text.Encoding.UTF8.GetString(MyMessage.BinaryField)` | `@{base64ToString(triggerBody()?['BinaryField'])}` |

### 5.3 Conditional Logic Patterns

| BizTalk Decide Shape Condition | Logic Apps If Condition |
|---|---|
| `MyMessage.Priority == "HIGH"` | `@{equals(triggerBody()?['Priority'], 'HIGH')}` |
| `MyMessage.Priority == "HIGH" \|\| MyMessage.Total > 10000` | Combine with `@{or(equals(...), greater(...))}` |
| `counter < 3` | `@{less(variables('counter'), 3)}` |
| `!System.String.IsNullOrEmpty(MyMessage.RefId)` | `@{not(empty(triggerBody()?['RefId']))}` |
| `MyMessage.Type == "A" && MyMessage.Status == "Active"` | `@{and(equals(...,'A'), equals(...,'Active'))}` |

---

## 6. BizTalk Tracking → Logic Apps Observability Mapping

| BizTalk Tracking Feature | Logic Apps Equivalent |
|---|---|
| Message tracking (MessageBox) | Application Insights events + Run History |
| Pipeline tracking | Connector action run details in Run History |
| Orchestration tracking | Workflow run history (full step-by-step) |
| BAM activity | Application Insights custom events |
| BAM view | Azure Monitor Workbooks / Log Analytics queries |
| Health and Activity Monitoring | Azure Monitor + Logic Apps Diagnostics |
| Event log (Windows Event Log) | Application Insights traces |
| BizTalk Administrator console | Azure Portal Logic Apps run history |
| Message body tracking | Tracked Properties (run inputs/outputs per action) |
| Business data tracking (BAM) | `Tracked Properties` configuration in workflow designer |

---

## 7. Migration Complexity Classification

### Per-Shape Complexity

| Complexity | Shapes | Notes |
|---|---|---|
| **Simple (direct)** | Receive (activating), Send, Construct Message, Message Assignment, Transform, Decide, Delay, Expression, Throw | Direct 1:1 mapping, minimal rework |
| **Moderate (workaround)** | Non-activating Receive (correlated), Parallel Actions, Listen, ForEach (envelope debatching), Scope (long running), Role Link | Requires pattern adaptation |
| **Complex (redesign required)** | Compensate, Atomic transaction Scope, Suspend, WCF-NetNamedPipe, MSDTC transactions, BRE (complex rule hierarchies), Multiple activating Receives | Architectural redesign needed |

### Complexity Score Algorithm

```
Score = base_score + modifier_sum

base_score:
  All simple shapes (receive/send/transform/decide): +1 each
  Moderate shapes: +3 each
  Complex shapes: +10 each

modifiers:
  Custom pipeline components: +2 each
  BRE policy calls: +5 each
  MSDTC / atomic transaction scopes: +8 each
  Correlation sets (>2): +3
  Long-running transactions with compensation: +6
  WCF-NetTcp / WCF-NetNamedPipe: +15
  EDI/AS2 processing: +2

Classification:
  0–10: Simple (direct migration)
  11–25: Moderate (standard adaptation)
  26–50: Complex (detailed planning required)
  51+: Highly Complex (consider phased migration or rewrite)
```

---

## 8. Quick Reference: Shape-by-Shape Migration Card

```
Receive (activating)        → Trigger
Receive (non-activating)    → Action (SB receive / HTTP wait)
Send (one-way)              → HTTP / ServiceProvider action
Send (request-reply)        → HTTP action (captures response)
Construct + Transform       → Transform action (XSLT/LML)
Construct + Assign          → Compose / Set Variable
Decide (2 branches)         → If action
Decide (N branches)         → Switch action
Loop                        → Until action
Parallel Actions            → Multiple actions, same runAfter
Listen                      → Event Grid / concurrent workflows
Delay                       → Delay action
Terminate                   → Terminate action (Failed/Cancelled)
Suspend                     → ⚠️ No equivalent → Terminate + retry trigger
Scope (exception)           → Scope action + runAfter:Failed branch
Scope (long-running)        → Scope action + stateful workflow
Scope (atomic)              → ❌ No equivalent → compensation design
Compensate                  → ❌ No equivalent → manual undo workflow
Throw                       → Terminate action (status: Failed)
Call Orchestration          → Workflow action (type: Workflow)
Start Orchestration         → Publish to Service Bus / Event Grid
Call Rules (BRE)            → If/Switch conditions or Azure Functions
Expression                  → Set Variable / Increment Variable
```
