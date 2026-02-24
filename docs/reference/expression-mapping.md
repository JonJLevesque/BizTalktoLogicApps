# XLANG/s to WDL Expression Translation Reference

> **Purpose**: Side-by-side translation of BizTalk XLANG/s expressions to Azure Logic Apps WDL expressions.
> **Last updated**: 2026-02-23

---

## 1. Expression Context

### XLANG/s Context
- Used in: Decide shape conditions, While/Until conditions, Expression shapes, MessageAssignment shapes
- Syntax: C#-like (operators, methods, type casts)
- Runs in: .NET CLR on BizTalk host server
- Message access: `MessageName.PromotedProperty` or `xpath(msg, "string(...)")` for body XPath

### WDL Expression Context
- Used in: If action expressions, condition properties, action inputs, variable values
- Syntax: JSON-based predicate format (for conditions) or `@{function()}` inline expressions
- Runs in: Logic Apps runtime
- Message access: `@{body('ActionName')?['field']}` or `@{xpath(xml(body('...')), '/path')}`

---

## 2. Comparison Operators

| XLANG/s | WDL Condition Format | WDL Inline Expression |
|---|---|---|
| `a == b` | `{"equals": ["@{a}", "b"]}` | `@{equals(a, b)}` |
| `a != b` | `{"not": {"equals": ["@{a}", "b"]}}` | `@{not(equals(a, b))}` |
| `a > b` | `{"greater": ["@{a}", b]}` | `@{greater(a, b)}` |
| `a >= b` | `{"greaterOrEquals": ["@{a}", b]}` | `@{greaterOrEquals(a, b)}` |
| `a < b` | `{"less": ["@{a}", b]}` | `@{less(a, b)}` |
| `a <= b` | `{"lessOrEquals": ["@{a}", b]}` | `@{lessOrEquals(a, b)}` |

### Type-Aware Comparison

XLANG/s uses C# type semantics. WDL `equals` is type-sensitive.

```
// XLANG/s numeric comparison
msg.Total > 500.0

// WDL — must ensure numeric type
{"greater": ["@float(body('Parse')?['Total'])", 500]}

// XLANG/s string comparison (case-sensitive by default)
msg.Status == "APPROVED"

// WDL — equals is case-sensitive
{"equals": ["@body('Parse')?['Status']", "APPROVED"]}

// Case-insensitive comparison in WDL
{"equals": ["@toLower(body('Parse')?['Status'])", "approved"]}
```

---

## 3. Boolean Operators

| XLANG/s | WDL Condition Format |
|---|---|
| `a && b` | `{"and": [{condition_a}, {condition_b}]}` |
| `a \|\| b` | `{"or": [{condition_a}, {condition_b}]}` |
| `!condition` | `{"not": {condition}}` |
| `a && b \|\| c` | `{"or": [{"and": [{a}, {b}]}, {c}]}` |

### Examples

```
// XLANG/s
msg.Priority == "HIGH" || msg.Total > 10000.0

// WDL
{
  "or": [
    { "equals": ["@body('Parse')?['Priority']", "HIGH"] },
    { "greater": ["@float(body('Parse')?['Total'])", 10000] }
  ]
}
```

```
// XLANG/s
msg.Status == "ACTIVE" && msg.Region == "EMEA" && !msg.IsBlocked

// WDL
{
  "and": [
    { "equals": ["@body('Parse')?['Status']", "ACTIVE"] },
    { "equals": ["@body('Parse')?['Region']", "EMEA"] },
    { "not": { "equals": ["@string(body('Parse')?['IsBlocked'])", "true"] } }
  ]
}
```

---

## 4. Message Field Access

### XLANG/s: Promoted Properties

```csharp
// Access promoted property (context shorthand)
string city = msg.City;
bool isUrgent = msg.Priority == "URGENT";
double total = msg.OrderTotal;
```

**Migration**: Promoted properties become JSON body fields after a ParseJson/ParseXml action.

```
WDL: @{body('Parse_Message')?['City']}
WDL: @{equals(body('Parse_Message')?['Priority'], 'URGENT')}
WDL: @{float(body('Parse_Message')?['OrderTotal'])}
```

### XLANG/s: XPath Body Access

```csharp
// Extract value from XML message body
string city = xpath(orderMsg, "string(/Order/Customer/City/text())");
double total = System.Convert.ToDouble(xpath(orderMsg, "string(/Order/Total/text())"));
bool hasItems = (bool)xpath(orderMsg, "/Order/Items/Item[1]");
int count = System.Convert.ToInt32(xpath(orderMsg, "count(/Order/Items/Item)"));
```

**Migration**: Use Logic Apps `xpath()` function (requires XML string input):
```
// Get string value
@{xpath(xml(triggerBody()), '/Order/Customer/City')}

// Get first match from array
@{first(xpath(xml(body('Get_XML')), '/Order/Items/Item/ProductCode'))}

// Count elements
@{length(xpath(xml(triggerBody()), '/Order/Items/Item'))}
```

### Null-Safe Access in WDL

```
// Safe navigation — returns null instead of error if field absent
@{body('Parse')?['OptionalField']}

// Provide default if null
@{coalesce(body('Parse')?['OptionalField'], 'DEFAULT')}

// Check if null/empty before using
@{if(empty(body('Parse')?['OptionalField']), 'DEFAULT', body('Parse')?['OptionalField'])}
```

---

## 5. String Functions

| XLANG/s (.NET String methods) | WDL Equivalent |
|---|---|
| `System.String.Concat(a, b, c)` | `@{concat(a, b, c)}` |
| `str.ToUpper()` | `@{toUpper(str)}` |
| `str.ToLower()` | `@{toLower(str)}` |
| `str.Trim()` | `@{trim(str)}` |
| `str.TrimStart()` | `@{trimStart(str)}` |
| `str.TrimEnd()` | `@{trimEnd(str)}` |
| `str.Length` | `@{length(str)}` |
| `str.Substring(start, length)` | `@{substring(str, start, length)}` |
| `str.Substring(start)` | `@{substring(str, start)}` |
| `str.IndexOf(search)` | `@{indexOf(str, search)}` |
| `str.LastIndexOf(search)` | `@{lastIndexOf(str, search)}` |
| `str.StartsWith(prefix)` | `@{startsWith(str, prefix)}` |
| `str.EndsWith(suffix)` | `@{endsWith(str, suffix)}` |
| `str.Contains(value)` | `@{contains(str, value)}` |
| `str.Replace(old, new)` | `@{replace(str, old, new)}` |
| `str.Split(delim)[0]` | `@{first(split(str, delim))}` |
| `string.IsNullOrEmpty(s)` | `@{empty(s)}` |
| `string.IsNullOrWhiteSpace(s)` | `@{equals(trim(string(s)), '')}` |
| `str.PadLeft(n, '0')` | No direct WDL — use concat with substring |
| `str.PadRight(n, ' ')` | No direct WDL — use concat with substring |

### StringLeft / StringRight (Common Scripting Functoids)

```
// StringLeft(str, n) — first n characters
// XLANG/s custom function: str.Substring(0, n)
// WDL:
@{substring(str, 0, n)}

// StringRight(str, n) — last n characters
// XLANG/s custom function: str.Substring(str.Length - n)
// WDL:
@{substring(str, sub(length(str), n))}
```

---

## 6. Mathematical Operations

| XLANG/s | WDL Expression |
|---|---|
| `a + b` (numeric) | `@{add(a, b)}` |
| `a - b` | `@{sub(a, b)}` |
| `a * b` | `@{mul(a, b)}` |
| `a / b` | `@{div(a, b)}` |
| `a % b` | `@{mod(a, b)}` |
| `Math.Abs(n)` | `@{abs(n)}` |
| `Math.Round(n, 2)` | `@{float(formatNumber(n, '#.##'))}` |
| `Math.Max(a, b)` | `@{max(a, b)}` (scalar); `@{max(array)}` (array) |
| `Math.Min(a, b)` | `@{min(a, b)}` |
| `Math.Pow(base, exp)` | No direct WDL — Azure Function |
| `Math.Sqrt(n)` | No direct WDL — Azure Function |
| `int.Parse(s)` | `@{int(s)}` |
| `double.Parse(s)` | `@{float(s)}` |

### Counter Pattern (XLANG/s loops → Until + Variable)

```
// XLANG/s While loop with counter
counter = 0;
while (counter < 10) {
  // do something
  counter = counter + 1;
}

// WDL: Initialize Variable → Until loop → Set Variable increment
"Init_Counter": {
  "type": "InitializeVariable",
  "inputs": { "variables": [{ "name": "counter", "type": "Integer", "value": 0 }] }
},
"Loop": {
  "type": "Until",
  "expression": "@greaterOrEquals(variables('counter'), 10)",
  "actions": {
    "Do_Something": { /* ... */ },
    "Increment": {
      "type": "SetVariable",
      "inputs": { "name": "counter", "value": "@{add(variables('counter'), 1)}" },
      "runAfter": { "Do_Something": ["SUCCEEDED"] }
    }
  }
}
```

---

## 7. Date/Time Operations

| XLANG/s | WDL Equivalent | Notes |
|---|---|---|
| `DateTime.Now` | `@{utcNow()}` | WDL always UTC; XLANG/s uses server local time |
| `DateTime.Now.ToString("yyyy-MM-dd")` | `@{utcNow('yyyy-MM-dd')}` | |
| `DateTime.Now.Year` | `@{year(utcNow())}` | |
| `DateTime.Now.Month` | `@{month(utcNow())}` | |
| `DateTime.Now.Day` | `@{dayOfMonth(utcNow())}` | |
| `DateTime.Now.AddDays(7)` | `@{addDays(utcNow(), 7)}` | |
| `DateTime.Now.AddHours(1)` | `@{addHours(utcNow(), 1)}` | |
| `DateTime.Parse(str)` | `@{parseDateTime(str)}` or pass directly | WDL auto-parses ISO 8601 |
| `dt1 > dt2` | `@{greater(ticks(dt1), ticks(dt2))}` | Compare via ticks |
| Age calculation: `today.Year - dob.Year` | `@{sub(year(utcNow()), year(dob))}` | Approximate — no birthday adjustment |

### Age Calculation (CalcularIdade equivalent)

XLANG/s with birthday adjustment:
```csharp
int age = DateTime.Now.Year - dob.Year;
if (dob.Month > DateTime.Now.Month ||
    (dob.Month == DateTime.Now.Month && dob.Day > DateTime.Now.Day)) {
    age--;
}
```

WDL approximation (year-only, no birthday adjustment):
```
@{sub(year(utcNow()), year(body('Parse')?['DateOfBirth']))}
```

WDL with birthday adjustment (complex):
```
@{if(
  or(
    greater(month(parseDateTime(body('Parse')?['DateOfBirth'])), month(utcNow())),
    and(
      equals(month(parseDateTime(body('Parse')?['DateOfBirth'])), month(utcNow())),
      greater(dayOfMonth(parseDateTime(body('Parse')?['DateOfBirth'])), dayOfMonth(utcNow()))
    )
  ),
  sub(sub(year(utcNow()), year(parseDateTime(body('Parse')?['DateOfBirth']))), 1),
  sub(year(utcNow()), year(parseDateTime(body('Parse')?['DateOfBirth'])))
)}
```
> **Note**: For complex date calculations, Azure Functions (.NET) is recommended over inline WDL expressions.

---

## 8. Type Conversions

| XLANG/s | WDL Expression | Notes |
|---|---|---|
| `System.Convert.ToString(n)` | `@{string(n)}` | |
| `System.Convert.ToInt32(s)` | `@{int(s)}` | Throws if not parseable |
| `System.Convert.ToDouble(s)` | `@{float(s)}` | |
| `System.Convert.ToBoolean(s)` | `@{bool(s)}` | "true"/"false" or "1"/"0" |
| `(int)someObject` | `@{int(someObject)}` | |
| `(string)someObject` | `@{string(someObject)}` | |
| `msg is SomeType` | No direct WDL equivalent | |
| `val == null` | `@{empty(val)}` | Also checks empty string |
| `val != null` | `@{not(empty(val))}` | |
| `json_string_to_object` | `@{json(s)}` | Parse JSON string |
| `object_to_json_string` | `@{string(obj)}` | Serialize object |
| `xml_string_to_xml` | `@{xml(s)}` | Parse XML string |
| `xml_to_string` | `@{string(xmlObj)}` | Serialize XML |
| Bytes to Base64 | `@{base64(s)}` | |
| Base64 to string | `@{base64ToString(s)}` | |

---

## 9. XPath in WDL

### Accessing XML Content

In Logic Apps, XML content is treated as a string. The `xpath()` function operates on XML nodes:

```
// Get string value (single value)
@{xpath(xml(body('Get_Document')), '/Order/Customer/Name')}
// Returns array with single text node — use string() or first()

// Get first match as string
@{string(xpath(xml(body('Get_Document')), 'string(/Order/Customer/Name)'))}

// Get all matching elements (returns array)
@{xpath(xml(body('Get_Document')), '/Order/Items/Item')}

// Count elements
@{length(xpath(xml(body('Get_Document')), '/Order/Items/Item'))}

// Conditional — if element exists
@{not(empty(xpath(xml(body('Get_Document')), '/Order/Priority')))}
```

### Namespace-Aware XPath

For XML with namespaces (common in BizTalk schemas):
```
// BizTalk EDI or custom namespace
@{xpath(xml(triggerBody()),
  '/ns0:PurchaseOrder/ns0:OrderId',
  '{"ns0": "http://MyApp.PurchaseOrder"}')}
```

### XPath vs ParseJson/JSONPath

For JSON payloads (more common in Logic Apps):
```
// JSON path — use ?['field'] syntax
@{body('Parse_JSON')?['Customer']?['Name']}

// Nested arrays
@{body('Parse_JSON')?['Items']?[0]?['ProductCode']}
```

---

## 10. Conditional (Ternary) Expressions

```
// XLANG/s (C# ternary)
string route = (msg.Priority == "HIGH") ? "PREMIUM" : "STANDARD";

// WDL if() expression
@{if(equals(body('Parse')?['Priority'], 'HIGH'), 'PREMIUM', 'STANDARD')}

// XLANG/s null coalescing
string val = msg.Name ?? "DEFAULT";

// WDL coalesce
@{coalesce(body('Parse')?['Name'], 'DEFAULT')}
```

---

## 11. Common XLANG/s Patterns → WDL

### Pattern: Message Routing Decision

```csharp
// XLANG/s in Decide shape
if (IncomingOrder.Status == "APPROVED" && IncomingOrder.Total > 1000) {
    // route to premium
} else {
    // route to standard
}
```

```json
// WDL If action
"Route": {
  "type": "If",
  "expression": {
    "and": [
      { "equals": ["@body('Parse')?['Status']", "APPROVED"] },
      { "greater": ["@float(body('Parse')?['Total'])", 1000] }
    ]
  },
  "actions": { /* premium path */ },
  "else": { "actions": { /* standard path */ } }
}
```

### Pattern: Message Field Concatenation

```csharp
// XLANG/s MessageAssignment
OutMsg.FullName = System.String.Concat(InMsg.FirstName, " ", InMsg.LastName);
```

```json
// WDL Compose
"Build_Full_Name": {
  "type": "Compose",
  "inputs": "@{concat(body('Parse')?['FirstName'], ' ', body('Parse')?['LastName'])}"
}
```

### Pattern: Loop and Collect (Aggregation)

```csharp
// XLANG/s: loop and accumulate
System.Collections.ArrayList results = new System.Collections.ArrayList();
int i = 0;
while (i < items.Count) {
    results.Add(ProcessItem(items[i]));
    i++;
}
```

```json
// WDL: Initialize array → ForEach → AppendToArrayVariable
"Init_Results": {
  "type": "InitializeVariable",
  "inputs": { "variables": [{ "name": "results", "type": "Array", "value": [] }] }
},
"Process_Items": {
  "type": "Foreach",
  "foreach": "@body('Parse')?['items']",
  "operationOptions": "Sequential",
  "actions": {
    "Process_Item": { "type": "Http", "inputs": { ... } },
    "Collect_Result": {
      "type": "AppendToArrayVariable",
      "inputs": { "name": "results", "value": "@body('Process_Item')" },
      "runAfter": { "Process_Item": ["SUCCEEDED"] }
    }
  }
}
```

### Pattern: Exception Handling with Compensation

```csharp
// XLANG/s Scope + Catch + Compensate
try {
    SendToERP(order);
    UpdateDatabase(order);
} catch (Exception ex) {
    CompensateERP(order);   // undo the ERP send
    LogError(ex);
}
```

```json
// WDL: Scope + runAfter ["FAILED"] + compensating actions
"Try_Process": {
  "type": "Scope",
  "actions": {
    "Send_To_ERP": { ... },
    "Update_Database": { "runAfter": { "Send_To_ERP": ["SUCCEEDED"] }, ... }
  }
},
"Compensate_ERP": {
  "type": "Http",
  "inputs": { "method": "DELETE", "uri": "https://erp.example.com/orders/@{body('Parse')?['OrderId']}" },
  "runAfter": { "Try_Process": ["FAILED"] }
},
"Log_Error": {
  "type": "Http",
  "inputs": { "method": "POST", "uri": "https://logging.example.com/errors", "body": "@result('Try_Process')" },
  "runAfter": { "Compensate_ERP": ["SUCCEEDED", "FAILED"] }
}
```

### Pattern: Call Orchestration (Child Workflow)

```csharp
// XLANG/s: Call Orchestration (synchronous)
CallOrchestration("ProcessPayment", new PaymentRequest { Amount = order.Total });
```

```json
// WDL Standard: Call child workflow
"Process_Payment": {
  "type": "Workflow",
  "inputs": {
    "host": { "workflow": { "id": "ProcessPayment" } },
    "body": { "Amount": "@body('Parse')?['Total']" }
  }
}
```

---

## 12. What Has No Direct WDL Equivalent

| XLANG/s Feature | Mitigation |
|---|---|
| MSDTC Atomic transactions (`Scope` type=Atomic) | Saga pattern: compensating workflows, idempotent operations |
| `Compensate` shape (structured undo) | Explicit compensating HTTP call to rollback workflow |
| `Suspend` shape (manual intervention) | Scope + runAfter ["FAILED"] + notification + separate resume workflow |
| Complex date calculations (age, elapsed) | Azure Functions (.NET) or multi-step WDL expression |
| Regex operations (`Regex.Match`, etc.) | WDL has no regex — Azure Functions |
| Complex collection LINQ queries | Azure Functions or multi-step ForEach + filter |
| .NET custom classes | Azure Functions; or JSON objects with Parse JSON |
| `xpath()` with complex predicates | May require Azure Function for complex XPath 1.0 evaluation |
| Multiple activating Receive shapes | Separate Logic Apps workflow per trigger type |
