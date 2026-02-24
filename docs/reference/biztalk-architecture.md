# BizTalk Server Architecture Reference

> **Purpose**: Local knowledge base for the migration engine. Use this to understand BizTalk artifacts before migrating them.
> **Scope**: BizTalk Server 2013 R2, 2016, 2020 (all share the same core architecture).
> **Last updated**: 2026-02-23

---

## 1. Core Architecture — MessageBox Pub/Sub

BizTalk Server implements a **publish/subscribe (pub/sub)** architecture centered on the **MessageBox Database** (SQL Server). Every message is published to the MessageBox; components subscribe to receive messages matching their criteria. Components never communicate directly.

```
External Systems
     │
     ▼ (raw bytes)
[Receive Adapter]  ← runs in a BizTalk Host Instance (Windows service)
     │
     ▼ (raw bytes)
[Receive Pipeline]
  Stage 1: Decode    → decrypt, decompress, MIME decode
  Stage 2: Disassemble → parse format, promote context properties (BTS.MessageType, etc.)
  Stage 3: Validate  → validate XML against schema
  Stage 4: ResolveParty → map sender to party
     │ (BizTalk message + context)
     ▼
[MessageBox Database]   ← SQL Server — THE CENTRAL HUB
     │ evaluates subscriptions
     ├──▶ [Orchestration Engine (XLANG/s)]
     │         │ processes, publishes new messages → back to MessageBox
     │         ▼
     │    [MessageBox Database]
     │
     └──▶ [Send Port subscription match]
               │
               ▼
          [Send Pipeline]
            Stage 1: Pre-Assemble
            Stage 2: Assemble → serialize to output format
            Stage 3: Encode  → encrypt, compress, MIME encode
               │
               ▼
          [Send Adapter] → External System
```

**Migration note**: Logic Apps has no central message store equivalent. The MessageBox's routing function is replaced by:
- Trigger conditions (activation subscriptions)
- Service Bus topics + subscriptions (pub/sub fan-out)
- Service Bus sessions (correlated instance routing)
- Workflow If/Switch actions (CBR)

---

## 2. MessageBox Database

**Role**: SQL Server database that is the heart of BizTalk Server. All messages, orchestration state, and routing rules live here.

### What it stores

| Data | Description |
|---|---|
| Message bodies | Actual message content (stored as binary blobs) |
| Message context | Property bag of metadata (promoted + written properties) |
| Subscriptions | Routing predicates (which component wants which messages) |
| Orchestration state | Dehydrated (serialized) orchestration instances waiting for events |
| Host queues | Messages queued for each BizTalk host |
| Tracking data | BAM event checkpoints, service instance status |

### Pub/Sub Mechanics

1. Component publishes message to MessageBox with context properties
2. MessageBox evaluates all active subscriptions against context
3. Each matching subscription gets a copy of the message
4. Message with NO matching subscription → goes to **Suspended Queue**
5. Routing failure can be configured: suspend vs discard (BTS.SuspendMessageOnRoutingFailure)

---

## 3. Message Context Properties

Every BizTalk message has a **context** — a property bag attached to (not inside) the message body.

### Context Property Types

| Type | Description | Routing? |
|---|---|---|
| **Promoted** | Written to context AND flagged for subscription evaluation | ✓ Yes |
| **Written** | In context but not promoted; accessible to orchestrations/components but not for routing | ✗ No |

### Key System Properties (BTS.* namespace)

| Property | Description | Set By |
|---|---|---|
| `BTS.MessageType` | `http://namespace#RootElement` — the message schema identifier | XML Disassembler |
| `BTS.ReceivePortName` | Name of the receive port that accepted this message | Receive adapter |
| `BTS.ReceivePortID` | GUID of receive port | Runtime |
| `BTS.SPName` | Name of the send port (for outbound routing) | Send infrastructure |
| `BTS.InboundTransportLocation` | Address of the receive location | Receive adapter |
| `BTS.CorrelationToken` | Unique token for correlating messages | Runtime |
| `BTS.IsRequestResponse` | True if this is a two-way port interaction | Runtime |
| `BTS.SuspendMessageOnRoutingFailure` | Suspend vs discard on routing failure | Configurable |
| `BTS.AckRequired` | Whether transport acknowledgment required | Transport |
| `FILE.ReceivedFileName` | Original filename (FILE adapter) | FILE adapter |
| `SMTP.From`, `SMTP.To`, `SMTP.Subject` | Email metadata (SMTP adapter) | SMTP adapter |
| `WCF.Action` | WCF SOAP action | WCF adapters |
| `EdiOverride.*` | EDI interchange properties | EDI components |

### Promoting Properties in Schemas

To make a field available for routing, promote it in the XSD:
```xml
<xs:element name="Priority" type="xs:string">
  <xs:annotation>
    <xs:appinfo>
      <b:fieldInfo promoted="true" xpath_gname="Priority" xmlns:b="..."/>
    </xs:appinfo>
  </xs:annotation>
</xs:element>
```

**Migration note**: Promoted properties → Service Bus message application properties (for topic filter expressions) or workflow body fields evaluated by If/Switch actions.

---

## 4. Subscriptions — The Routing Engine

### Activation Subscriptions

Create a **new orchestration instance** when a matching message arrives.

- Generated when orchestration has `Receive` shape with `Activate = true`
- Also generated for receive port / orchestration port binding
- SQL-like predicate: `BTS.MessageType = 'http://Order#Order' AND Order.Status = 'New'`

### Instance Subscriptions

Route to an **existing running** orchestration instance.

- Generated when running orchestration executes a non-activating `Receive` shape
- Matched by **correlation set values** (promoted properties that uniquely identify an instance)
- Example: orchestration waiting for a correlated response has a subscription: `BTS.CorrelationToken = {guid}`

### Send Port Subscriptions

Route outbound messages to send ports.

- Each active send port generates a subscription based on its filter expression
- Filter example: `BTS.MessageType = 'http://Invoice#Invoice' AND Invoice.Priority = 'HIGH'`
- Fan-out: multiple send ports can match the same message simultaneously

**Migration implications**:
| Subscription Type | Logic Apps Equivalent |
|---|---|
| Activation subscription | Trigger (polling, webhook, or timer) |
| Instance subscription | Service Bus session (convoy) or Until loop with correlation check |
| Send port filter | Service Bus topic subscription filter OR If/Switch routing in workflow |
| MessageBox fan-out | Service Bus topic with multiple subscriptions |

---

## 5. Orchestrations — XLANG/s

Orchestrations define business processes. Stored as `.odx` XML files. Compiled to XLANG/s (C#-based language with messaging extensions).

### ODX File Structure

```xml
<om:Module xmlns:om="http://schemas.microsoft.com/BizTalk/2003/DesignerData">
  <om:Property Name="InitialCodeFile" Value="MyOrch.odx"/>
  <om:Property Name="InitialNamespace" Value="MyApp"/>
  <om:Property Name="InitialTypeName" Value="MyOrchestration"/>

  <om:Service Name="MyOrchestration">
    <om:Property Name="Type" Value="Public"/>          <!-- Public/Private/Internal -->
    <om:Property Name="Transaction" Value="None"/>     <!-- None/Atomic/LongRunning -->
    <om:Property Name="Compensation" Value="Default"/>

    <!-- Message type declarations -->
    <om:MessageDeclaration Name="InMsg" Type="MyApp.Schemas.OrderMessage"/>
    <om:MessageDeclaration Name="OutMsg" Type="MyApp.Schemas.InvoiceMessage"/>

    <!-- Variable declarations (any .NET type) -->
    <om:VariableDeclaration Name="orderId" Type="System.String"/>
    <om:VariableDeclaration Name="counter" Type="System.Int32"/>

    <!-- Correlation set declarations -->
    <om:CorrelationDeclaration Name="OrderCorrelation" Type="MyApp.CorrelationTypes.OrderType"/>

    <!-- Port declarations -->
    <om:PortDeclaration Name="ReceivePort" Type="MyApp.IReceiveOrder"
                        Polarity="Implements" Modifier="Private"/>
    <om:PortDeclaration Name="SendPort"    Type="MyApp.ISendInvoice"
                        Polarity="Uses"     Modifier="Private"/>

    <om:Body>
      <om:Shape Name="BodyShape" Type="BodyShape">
        <!-- Shapes nested here -->
      </om:Shape>
    </om:Body>
  </om:Service>
</om:Module>
```

### Port Polarity

| Polarity | Meaning | Migration |
|---|---|---|
| `Implements` | Orchestration IS the service; receives messages inbound | Trigger |
| `Uses` | Orchestration CALLS an external service | Action (HTTP, connector, etc.) |

### Correlation Sets

Used for instance routing — grouping related messages together:

```xml
<!-- Correlation type (defined once, reused) -->
<om:CorrelationType Name="OrderCorrelationType">
  <om:Property Name="PropertyNamespace" Value="http://MyApp.Properties"/>
  <om:Property Name="PropertyName" Value="OrderId"/>
</om:CorrelationType>

<!-- Usage in Receive shape -->
<om:Shape Name="ReceiveConfirm" Type="ReceiveShape">
  <om:Property Name="ActivatesCorrelation" Value="false"/>
  <om:Property Name="FollowsCorrelationSets" Value="OrderCorrelation"/>
</om:Shape>
```

---

## 6. All Orchestration Shapes

### Message Flow

| Shape | Type in ODX | Description | Migration Target |
|---|---|---|---|
| **Receive** (activating) | `ReceiveShape` + `Activate=true` | Creates new orchestration instance | Trigger |
| **Receive** (non-activating) | `ReceiveShape` + `Activate=false` | Routes to existing instance via correlation | ServiceBus receive + Until loop |
| **Send** | `SendShape` | Send message on bound port | HTTP / ServiceBus / Blob / connector action |

### Message Construction

| Shape | Type | Description | Migration Target |
|---|---|---|---|
| **Construct Message** | `ConstructShape` | Container for building messages — required wrapper | (implicit in action) |
| **Transform** | `TransformShape` | Apply BTM map | Transform XML / XSLT / LML action |
| **Message Assignment** | `MessageAssignmentShape` | Set message fields via XLANG/s | Compose action or Initialize Variable |
| **Variable Assignment** | (inside ExpressionShape) | Set variable values | Initialize Variable / Set Variable action |

### Control Flow

| Shape | Type | Description | Migration Target |
|---|---|---|---|
| **Decide** | `DecideShape` (2 branches) | If / else branching; XLANG/s expression per branch | If (Condition) action |
| **Switch** (multi-branch Decide) | `DecideShape` (3+ branches) | Multiple conditions evaluated top-to-bottom | Switch action or nested If |
| **While** | `WhileShape` | Loop WHILE condition is true (check before loop body) | Until action (inverted condition) |
| **Until** | `LoopShape` / `UntilShape` | Loop UNTIL condition is true (check after loop body) | Until action |
| **Listen** | `ListenShape` | Wait for FIRST of multiple events (messages or timeout) | Switch action + Delay |

### Parallel Processing

| Shape | Type | Description | Migration Target |
|---|---|---|---|
| **Parallel Actions** | `ParallelActionsShape` | Execute multiple branches concurrently | Multiple actions with same `runAfter` predecessor |
| **Parallel Branch** | (child of Parallel Actions) | One concurrent branch | Individual actions pointing to same predecessor |

### Orchestration Invocation

| Shape | Type | Description | Migration Target |
|---|---|---|---|
| **Call Orchestration** | `CallOrchestrationShape` | Synchronous call — waits for child to complete | `"type": "Workflow"` (Standard) or HTTP to callable workflow |
| **Start Orchestration** | `StartOrchestrationShape` | Asynchronous — fire and forget | HTTP action (no response wait) |
| **Call Rules** | `CallRulesShape` | Execute a BRE policy | Azure Functions action |

### Transactions and Exceptions

| Shape | Type | Description | Migration Target |
|---|---|---|---|
| **Scope (None)** | `ScopeShape` type=None | Logical grouping for exception handling | Scope action |
| **Scope (Long-Running)** | `ScopeShape` type=LongRunning | Long-running transaction with compensation support | Scope action + compensating child workflow |
| **Scope (Atomic)** | `ScopeShape` type=Atomic | MSDTC distributed transaction | **No equivalent** — redesign required |
| **Catch** | `CatchShape` | Exception handler (typed or generic) | `runAfter: { "Scope": ["Failed"] }` + Get Result |
| **Throw Exception** | `ThrowExceptionShape` | Raise an exception | Terminate action |
| **Compensate** | `CompensateShape` | Invoke compensation scope | HTTP call to compensating workflow |
| **Compensation Scope** | `CompensationShape` | Defines undo logic for a scope | Separate callable Logic Apps workflow |

### Infrastructure

| Shape | Type | Description | Migration Target |
|---|---|---|---|
| **Expression** | `ExpressionShape` | Execute XLANG/s code (variable assignments, calculations) | Compose / Initialize Variable / Set Variable |
| **Delay** | `DelayShape` | Pause for duration or until time | Delay action |
| **Group** | `GroupShape` | Visual grouping only — no runtime effect | Comment / documentation only |
| **Terminate** | `TerminateShape` | End orchestration instance (with error) | Terminate action |
| **Suspend** | `SuspendShape` | Suspend for manual intervention | No equivalent — use notification + manual resume pattern |

---

## 7. XLANG/s Expression Language

Used in: Decide, While, Until, Expression, MessageAssignment shapes.

### Variable Access
```csharp
// Declare (in Service declarations): System.String orderId;
orderId = "ORD-001";
counter = counter + 1;
isApproved = true;
```

### Message Field Access (promoted properties shorthand)
```csharp
// Access promoted property (BizTalk automatically generates property accessor)
string city = IncomingMsg.City;           // shorthand for promoted property
bool isHigh = IncomingMsg.Priority == "HIGH";
```

### XPath on Message Body
```csharp
// Evaluate XPath against the message body XML
string orderId = xpath(myMessage, "string(/Order/OrderId/text())");
double total   = System.Convert.ToDouble(xpath(myMessage, "string(/Order/Total/text())"));
bool hasItems  = xpath(myMessage, "count(/Order/Items/Item) > 0");
```

### Type Operations
```csharp
int n = System.Convert.ToInt32(someString);
string s = System.Convert.ToString(someInt);
double d = System.Convert.ToDouble(numString);
bool b = System.Convert.ToBoolean(flagString);  // "true"/"false"/"1"/"0"
```

### String Operations
```csharp
string full = System.String.Concat(firstName, " ", lastName);
string upper = someString.ToUpper();
int len = someString.Length;
bool contains = someString.Contains("keyword");
string trimmed = someString.Trim();
```

### Comparison and Boolean
```csharp
// Comparison
msg.Status == "Approved"      // equality
msg.Total  != 0               // inequality
msg.Amount >  500.0           // numeric greater
msg.Amount >= 500.0           // numeric greater-or-equal
msg.Amount <  100.0           // less than

// Boolean
msg.Status == "HIGH" && msg.Amount > 10000.0  // AND
msg.Status == "RUSH" || msg.Flags == "URGENT"  // OR
!msg.IsCancelled                               // NOT
```

### Message Construction
```csharp
// Inside a ConstructShape with MessageAssignmentShape:
OutMsg = InMsg;                    // Copy entire message
OutMsg.Status = "Processed";       // Override field (promoted property)
OutMsg.ProcessedDate = System.DateTime.Now.ToString("yyyy-MM-dd");
```

---

## 8. Maps (BTM Files)

Maps transform messages between schemas. Visual editor in BizTalk (VS). Stored as `.btm` XML, compiled to XSLT 1.0 + optional C# (`msxsl:script`).

### BTM XML Structure

```xml
<mapsource:BizTalkMap
  xmlns:mapsource="http://schemas.microsoft.com/BizTalk/2003/mapsource"
  SourceSchemaFileName="Order.xsd"
  TargetSchemaFileName="Invoice.xsd"
  SourceSchemaRootName="Order"
  TargetSchemaRootName="Invoice">

  <!-- Functoid definitions -->
  <FunctionList>
    <Function FID="0x02b6" ... />  <!-- FID = functoid type code -->
  </FunctionList>

  <!-- Links connect: source field → functoid → target field -->
  <!-- See compiled XSLT for actual logic -->
</mapsource:BizTalkMap>
```

### Functoid Categories and Key Functoids

| Category | Key Functoids | FID Range | Migration |
|---|---|---|---|
| **String** | StringConcat, Lowercase, Uppercase, StringFind, StringLeft, StringRight, SubString, StringLength | 0x02b6–0x02c7 | WDL: concat(), toLower(), toUpper(), indexOf(), substring(), length() |
| **Mathematical** | Addition, Subtraction, Multiplication, Division, Modulo, AbsoluteValue, Round, Maximum Value, Minimum Value | 0x0095–0x00a2 | WDL: add(), sub(), mul(), div(), mod() |
| **Logical** | Logical AND, OR, NOT, Logical Numeric, Logical String, Logical Date, Equal, GreaterThan, LessThan | 0x0069–0x0074 | WDL: and(), or(), not(), isFloat(), isString() |
| **Date/Time** | Date, Time, DateAndTime, AddDays | 0x00a4–0x00a7 | WDL: utcNow(), addDays(), formatDateTime() |
| **Conversion** | ASCII to Char, Char to ASCII, Hexadecimal, Octal | 0x00c8–0x00cc | WDL: uriComponent(), string() |
| **Scientific** | Logarithm, CommonLog, NaturalLog, X^Y, Power, SquareRoot, TangentFunc | 0x0100–0x010e | Not commonly used; Azure Function if needed |
| **Cumulative** | CumulativeSum, CumulativeAverage, CumulativeMax, CumulativeMin, CumulativeCount | 0x011e–0x0128 | WDL: sum(), first()/last(), length() on filtered array |
| **Database** | Database Lookup, Value Extractor, Error Return | 0x0160–0x0163 | **No direct equivalent** — Azure Function or HTTP lookup |
| **Advanced: Scripting** | Inline C#/VB.NET/JScript | 0x0018 | Manual translation to WDL/LML expressions |
| **Advanced: Value Mapping** | If condition → field value (conditional copy) | 0x0013/0x0014 | WDL: if() expression or LML conditional |
| **Advanced: Looping** | Creates output loop for input records | 0x0009/0x001a | LML: loop mapping; WDL: ForEach action |
| **Advanced: Cross Reference** | Cross-reference table lookup | 0x030c–0x030f | Azure Function + lookup table |
| **Advanced: Iteration** | Returns record index within loop | 0x001f | LML: index(); WDL: iterationIndexes() in ForEach |

### Scripting Functoid (Critical)

Inline C# compiled into the XSLT as `msxsl:script`. **NOT compatible with Logic Apps XSLT action** (which uses .NET's XslCompiledTransform — no msxsl:script support).

Detection pattern in compiled XSLT:
- Namespace `xmlns:msxsl="urn:schemas-microsoft-com:xslt"` present
- `<msxsl:script language="C#" implements-prefix="userCSharp">` block present
- Functions called as `userCSharp:FunctionName(...)` in XSL templates

**Migration action**: Parse the C# function body, identify pattern, translate to LML expression or WDL expression.

### Map Compilation Output

`.btm` → compiled into application `.dll` AND a `.xsl` XSLT file:
- Simple maps (no scripting): valid XSLT 1.0 — can be used directly in Logic Apps
- Maps with scripting: XSLT + msxsl:script — **must be rewritten** for Logic Apps

---

## 9. Pipelines (BTP Files)

Pipelines are ordered sequences of components that process messages before/after the MessageBox.

### Receive Pipeline Stages

| # | Stage Name | CategoryID | Execution Mode | Common Components |
|---|---|---|---|---|
| 1 | **Decode** | `0xff76a36f...` | All components | MIME/SMIME Decoder, Custom Decoder |
| 2 | **Disassemble** | `0x9d0e4105...` | **First match only** | XML Disassembler, Flat File Disassembler, EDI Disassembler, JSON Disassembler |
| 3 | **Validate** | `0x9d0e4105...` | All components | XML Validator |
| 4 | **ResolveParty** | `0x90d0d89d...` | All components | Party Resolution |

### Send Pipeline Stages

| # | Stage Name | CategoryID | Execution Mode | Common Components |
|---|---|---|---|---|
| 1 | **Pre-Assemble** | `0x6d363189...` | All components | Custom pre-processors |
| 2 | **Assemble** | `0x1e8b9a36...` | **Zero or one** | XML Assembler, Flat File Assembler, EDI Assembler, JSON Assembler |
| 3 | **Encode** | `0xc8c77f83...` | All components | MIME/SMIME Encoder, Custom Encoder |

### Default Pipelines

| Pipeline | Type | Components | Migration Note |
|---|---|---|---|
| `XMLReceive` | Receive | XML Disassembler | Promotes BTS.MessageType; equivalent to ParseJson in Logic Apps |
| `PassThruReceive` | Receive | None | No parsing — message passed as raw bytes |
| `XMLTransmit` | Send | XML Assembler | Serializes to XML — no action needed in Logic Apps for XML output |
| `PassThruTransmit` | Send | None | Transparent — no action needed |
| `EDIReceive` | Receive | EDI Disassembler + Batch Marker | Use X12/EDIFACT Decode action in Logic Apps |
| `EDITransmit` | Send | EDI Assembler | Use X12/EDIFACT Encode action |
| `AS2EdiReceive` | Receive | AS2 Decoder + EDI Disassembler | AS2 Decode → EDI Decode in Logic Apps |
| `AS2EdiSend` | Send | EDI Assembler + AS2 Encoder | EDI Encode → AS2 Encode in Logic Apps |

### Key Pipeline Components → Logic Apps

| BizTalk Component | Migration Target | Notes |
|---|---|---|
| XML Disassembler | Parse JSON or XML Content-Type | Standard XML — automatic in Logic Apps |
| XML Assembler | No action needed | Logic Apps outputs XML natively if input is XML |
| Flat File Disassembler | Flat File Decoding (built-in connector) | Requires flat file schema (FFS) — must be recreated as Data Mapper schema |
| Flat File Assembler | Flat File Encoding (built-in connector) | Same |
| EDI Disassembler | X12/EDIFACT Decode (Integration Account) | Integration Account required |
| EDI Assembler | X12/EDIFACT Encode (Integration Account) | Integration Account required |
| AS2 Decoder | AS2 Decode (Integration Account) | Integration Account required |
| AS2 Encoder | AS2 Encode (Integration Account) | Integration Account required |
| MIME/SMIME Decoder | Azure Function (.NET) | No built-in equivalent |
| MIME/SMIME Encoder | Azure Function (.NET) | No built-in equivalent |
| XML Validator | XML Validation (built-in) | Direct mapping |
| Party Resolution | Azure Function + data store | No built-in equivalent |
| JSON Disassembler | Parse JSON action | Direct mapping |
| JSON Assembler | Compose action + json() | Direct mapping |

---

## 10. Business Rules Engine (BRE)

Declarative rule engine with forward-chaining inference.

### Architecture

- **Rule Store**: SQL Server database (BizTalk BRE database)
- **Rule Policies**: versioned collection of rules (if/then)
- **Rules**: `IF <conditions> THEN <actions>` — conditions can reference facts
- **Facts**: .NET objects, XML documents (via XML schema facts), database rows
- **Vocabularies**: human-readable names for rule terms ("Order Amount" = `order.Total`)
- **Inference**: forward-chaining — keeps firing rules until no more apply
- **Called by**: `Call Rules` shape in orchestration — synchronous call

### Policy File (exported)
```xml
<brl xmlns="http://schemas.microsoft.com/businessruleslanguage/2002">
  <ruleset name="OrderRoutingPolicy">
    <rule name="HighValueOrder" priority="0">
      <conditions>
        <condition>OrderFact.Total &gt; 10000</condition>
      </conditions>
      <actions>
        <action>OrderFact.RouteTo = "PREMIUM"</action>
      </actions>
    </rule>
  </ruleset>
</brl>
```

### Migration Decision

| Complexity | Migration Target |
|---|---|
| ≤ 10 rules, simple value comparisons | Switch/If actions inline in Logic Apps |
| 10–50 rules, moderate conditions | Azure Functions (.NET) — port rule code directly |
| 50+ rules, forward chaining, vocabularies | Azure Rules Engine (preview) or NRules/Drools |
| Database fact provider | Azure Function + SQL/Cosmos DB lookup |
| Independent policy versioning required | Azure Functions with separate deployment |

---

## 11. Business Activity Monitoring (BAM)

Real-time business process visibility platform.

### Key Concepts

- **BAM Activities**: defined schema of business data to track per process instance
- **Tracking Profiles**: map BizTalk shapes/messages to BAM activity fields
- **BAM Portal**: web UI for activity search, aggregation, alerts
- **OLAP Cubes**: pre-aggregated BAM data for analytical reporting
- **BAM Alerts**: SQL Server Notification Services-based alerting

### Migration Target

| BAM Feature | Logic Apps + Azure Replacement |
|---|---|
| BAM Activities (per-instance tracking) | Application Insights custom events / Log Analytics custom tables |
| BAM Activity Search | Log Analytics Kusto queries / Application Insights Search |
| BAM Aggregations (OLAP) | Azure Data Explorer / Power BI with LA source |
| BAM Alerts | Azure Monitor alerts on App Insights metrics |
| BAM Portal | Power BI dashboard / custom Azure Static Web App |

---

## 12. Enterprise Single Sign-On (SSO)

Maps Windows identity credentials to back-end system credentials.

### Components

- **SSO Database** (SQL Server): encrypted credential store
- **Master Secret Server**: holds the encryption master key; must be highly available
- **Affiliate Applications**: logical representation of external systems with credential fields
- **SSO Tickets**: short-lived tokens issued to adapters for credential lookup

### Migration Target

| SSO Component | Azure Replacement |
|---|---|
| SSO Database credential store | Azure Key Vault (secrets, certificates) |
| Windows identity → system credentials | Managed Identity + Key Vault references |
| Per-adapter credential lookup | Connector authentication via Key Vault reference |
| Affiliate application model | Azure AD app registration + service principal |
| SSO Tickets | Azure AD OAuth2 tokens |

---

## 13. EDI / B2B Protocols

### Supported Protocols

| Protocol | Standard | Use Case |
|---|---|---|
| **X12** | ANSI X12 (American EDI) | Purchase orders, invoices, shipping (US/Canada) |
| **EDIFACT** | UN/EDIFACT (International) | European/global B2B |
| **AS2** | Applicability Statement 2 | Secure HTTP-based EDI transport (MIME + S/MIME) |
| **RosettaNet** | RNIF 1.1 / 2.0 | Technology industry B2B (PIPs) |

### Key EDI Concepts

- **Interchange**: envelope containing one or more functional groups
- **Functional Group**: collection of transaction sets of the same type
- **Transaction Set**: the actual business document (e.g., 850 Purchase Order)
- **Partner/Party**: trading partner configuration in BizTalk
- **Agreement**: EDI settings between two specific partners (ISA segment settings, validation rules)
- **Functional Acknowledgment** (997/TA1): sent back to confirm receipt

### Migration to Logic Apps Integration Account

Logic Apps Integration Account supports the same EDI protocols with similar concepts:
- Partners → Integration Account Partners
- Agreements → Integration Account Agreements
- Schemas → Integration Account Schemas (XSD)
- Maps → Integration Account Maps (XSLT/LML)

**Key difference**: BizTalk handles functional acks automatically via pipeline; Logic Apps requires explicit ack workflows.

---

## 14. BizTalk Application Deployment Model

### Application Structure

A BizTalk Application is the deployment unit — equivalent to a Logic Apps Standard app.

| Artifact | Extension | Deployed As | Migration Equivalent |
|---|---|---|---|
| Orchestration | `.odx` → `.dll` | GAC assembly | Logic Apps workflow.json |
| Map | `.btm` → `.dll` + `.xsl` | GAC assembly + XSLT | LML map or XSLT file |
| Pipeline | `.btp` → `.dll` | GAC assembly | Built-in Logic Apps actions |
| Schema | `.xsd` → `.dll` | GAC assembly | Integration Account schema or inline JSON schema |
| Binding file | `.xml` | Deployed separately | connections.json + workflow trigger config |
| BRE Policy | `.xml` | BRE database | Azure Function or inline conditions |
| BAM Activity | `.xml` | BAM database | App Insights event schema |
| .NET assembly | `.dll` | GAC or BizTalk deploy | Azure Function or NuGet package |
| SSO affiliate app | BizTalk admin | SSO database | Key Vault secret |

### Binding File Format

The BindingInfo.xml file connects orchestration ports to physical transports:

```xml
<BindingInfo>
  <SendPortCollection>
    <SendPort Name="SP_Name">
      <PrimaryTransport>
        <Address>...</Address>
        <TransportType Name="FILE"/>
        <TransportTypeData><![CDATA[<CustomProps>...</CustomProps>]]></TransportTypeData>
      </PrimaryTransport>
      <Filter>
        <Group>
          <Statement Property="BTS.MessageType" Operator="0" Value="http://ns#Root"/>
        </Group>
      </Filter>
    </SendPort>
  </SendPortCollection>
  <ReceivePortCollection>
    <ReceivePort Name="RP_Name">
      <ReceiveLocationCollection>
        <ReceiveLocation Name="RL_Name">
          <Address>C:\Input\*.xml</Address>
          <TransportType Name="FILE"/>
          <TransportTypeData><![CDATA[<CustomProps>...</CustomProps>]]></TransportTypeData>
        </ReceiveLocation>
      </ReceiveLocationCollection>
    </ReceivePort>
  </ReceivePortCollection>
</BindingInfo>
```

**Migration engine must extract from BindingInfo.xml**:
1. Adapter type (determines Logic Apps connector)
2. Address (determines trigger path / destination URL)
3. TransportTypeData (adapter-specific config: polling interval, file mask, connection string, etc.)
4. Pipeline name (determines if parsing/serialization actions are needed)
5. Filter expressions (determines routing conditions in Logic Apps)
