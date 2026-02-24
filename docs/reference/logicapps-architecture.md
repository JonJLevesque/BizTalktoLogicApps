# Azure Logic Apps Architecture Reference

> **Purpose**: Local knowledge base for generating valid, idiomatic Logic Apps artifacts.
> **Scope**: Logic Apps Standard (Single-Tenant) — primary migration target. Consumption included for comparison.
> **Last updated**: 2026-02-23
> **WDL Schema**: `https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#`

---

## 1. Hosting Models

| Model | SKU | Billing | Workflows per App | VNET | On-Prem Data Gateway | Target for BizTalk Migration |
|---|---|---|---|---|---|---|
| **Consumption (Multitenant)** | Shared | Per action execution | 1 | ✗ | Via gateway | Only for simple, low-volume |
| **Standard (Single-Tenant)** | WF1/WF2/WF3 | Hosting plan (flat) | Unlimited | ✓ | ✓ | **Primary target** |
| **Standard (ASEv3)** | Isolated | Isolated plan | Unlimited | Full isolation | ✓ | High-security/regulated |
| **Standard (Hybrid)** | Container | Pay per use | Unlimited | On-prem/multi-cloud | Built-in | On-premises or edge |

### Why Standard for BizTalk Migration

1. **Multi-workflow per app** — matches BizTalk's "application contains multiple orchestrations" model
2. **Stateful workflows** — durable, long-running processes matching BizTalk's dehydration model
3. **VNET integration** — connect to on-premises systems via private network
4. **Built-in (in-process) connectors** — higher throughput, lower latency than managed connectors
5. **Compute isolation** — no noisy-neighbor issues for enterprise workloads
6. **Storage** — Azure Storage (Blob, Tables, Queues) used for state, run history, artifacts

---

## 2. Workflow Types (Standard Only)

| Type | Run History | Max Duration | Trigger Types | Optimal For |
|---|---|---|---|---|
| **Stateful** | External Azure Storage | 90 days | All types | Long-running processes, BizTalk migration, durable state |
| **Stateless** | In-memory only | 5 minutes | Push/webhook triggers only | High-throughput, short-lived, simple transformations |

**For BizTalk migration: always use Stateful workflows.**

---

## 3. WDL Schema Structure

```json
{
  "definition": {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "contentVersion": "1.0.0.0",
    "triggers": {
      "TriggerName": { /* exactly one trigger */ }
    },
    "actions": {
      "ActionName": { /* action definitions */ }
    },
    "parameters": {
      "ParameterName": {
        "defaultValue": "...",
        "type": "String"
      }
    },
    "outputs": {}
  },
  "kind": "Stateful"
}
```

### Key Constraints

| Constraint | Consumption | Standard |
|---|---|---|
| Triggers per workflow | 1 | 1 |
| Max actions per workflow | 500 | 500 |
| Max nesting depth | 8 levels | 8 levels |
| Action name max length | 80 chars | 80 chars |
| Max variables | 250 | 250 |
| Max array variable size | 100 MB | 100 MB |
| Run timeout (stateful) | 90 days | 90 days |
| Run timeout (stateless) | N/A | 5 minutes |
| Recurrence minimum | 1 second | 1 second |

---

## 4. Trigger Types

### HTTP Request (Webhook)
```json
"When_HTTP_request_received": {
  "type": "Request",
  "kind": "Http",
  "inputs": {
    "schema": {
      "type": "object",
      "properties": {
        "OrderId": { "type": "integer" },
        "Status":  { "type": "string"  }
      }
    }
  }
}
```
**BizTalk equivalent**: Receive shape bound to HTTP/SOAP receive location (two-way port).

### Recurrence (Timer/Schedule)
```json
"Run_every_hour": {
  "type": "Recurrence",
  "recurrence": {
    "frequency": "Hour",
    "interval": 1,
    "startTime": "2026-01-01T00:00:00Z",
    "timeZone": "UTC"
  }
}
```
**BizTalk equivalent**: Scheduled orchestration or FILE adapter with polling.

### ServiceProvider (Built-in Polling)
```json
"When_message_received": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "entityName": "orders-queue",
      "messageCount": 1
    },
    "serviceProviderConfiguration": {
      "connectionName": "serviceBus",
      "operationId": "receiveQueueMessages",
      "serviceProviderId": "/serviceProviders/serviceBus"
    }
  },
  "recurrence": { "frequency": "Second", "interval": 30 }
}
```
**BizTalk equivalent**: Receive location bound to Service Bus or other polling adapter.

### ServiceProvider (Blob — File Polling)
```json
"When_blob_added": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "containerName": "inbound-orders",
      "blobMatchingCondition": { "matchWildcardPattern": "*.xml" }
    },
    "serviceProviderConfiguration": {
      "connectionName": "azureblob",
      "operationId": "getBlob",
      "serviceProviderId": "/serviceProviders/AzureBlob"
    }
  },
  "recurrence": { "frequency": "Minute", "interval": 1 }
}
```
**BizTalk equivalent**: FILE adapter receive location (C:\Input\*.xml).

### ApiConnectionWebhook (Managed Connector Push)
```json
"When_email_arrives": {
  "type": "ApiConnectionWebhook",
  "inputs": {
    "host": {
      "connection": { "referenceName": "office365" }
    },
    "body": { "NotificationUrl": "@{listCallbackUrl()}" }
  }
}
```

---

## 5. Action Types — Complete Reference

### HTTP
```json
"Call_External_API": {
  "type": "Http",
  "inputs": {
    "method": "POST",
    "uri": "https://api.example.com/orders",
    "headers": { "Content-Type": "application/json", "Authorization": "Bearer @{parameters('apiToken')}" },
    "body": "@{body('Compose_Payload')}",
    "authentication": {
      "type": "ManagedServiceIdentity"
    },
    "retryPolicy": { "type": "exponential", "count": 4, "interval": "PT7S" }
  },
  "runAfter": { "Compose_Payload": ["SUCCEEDED"] }
}
```

### Compose (Build Object/Value)
```json
"Build_Response": {
  "type": "Compose",
  "inputs": {
    "orderId":   "@{body('Parse_Order')?['OrderId']}",
    "status":    "Accepted",
    "timestamp": "@{utcNow()}"
  },
  "runAfter": { "Parse_Order": ["SUCCEEDED"] }
}
```
**BizTalk equivalent**: MessageAssignment shape, Expression shape.

### Parse JSON
```json
"Parse_Order": {
  "type": "ParseJson",
  "inputs": {
    "content": "@{triggerBody()}",
    "schema": {
      "type": "object",
      "properties": {
        "OrderId":  { "type": "integer" },
        "Customer": { "type": "string" },
        "Total":    { "type": "number" }
      }
    }
  },
  "runAfter": {}
}
```
**BizTalk equivalent**: XML Disassembler pipeline component (for JSON payloads).

### If (Condition)
```json
"Route_By_Priority": {
  "type": "If",
  "expression": {
    "or": [
      { "equals":  ["@body('Parse_Order')?['Priority']", "HIGH"] },
      { "greater": ["@float(body('Parse_Order')?['Total'])", 10000] }
    ]
  },
  "actions": {
    "Send_High_Priority": { /* actions in true branch */ }
  },
  "else": {
    "actions": {
      "Send_Standard": { /* actions in false branch */ }
    }
  },
  "runAfter": { "Parse_Order": ["SUCCEEDED"] }
}
```
**BizTalk equivalent**: Decide shape.

### Switch
```json
"Route_By_Region": {
  "type": "Switch",
  "expression": "@body('Parse_Order')?['Region']",
  "cases": {
    "EMEA": {
      "case": "EMEA",
      "actions": { "Send_To_EMEA": { /* ... */ } }
    },
    "APAC": {
      "case": "APAC",
      "actions": { "Send_To_APAC": { /* ... */ } }
    }
  },
  "default": {
    "actions": { "Send_To_Default": { /* ... */ } }
  },
  "runAfter": { "Parse_Order": ["SUCCEEDED"] }
}
```
**BizTalk equivalent**: Decide shape with 3+ branches, or Switch shape.

### ForEach (Parallel by default)
```json
"Process_Each_Item": {
  "type": "Foreach",
  "foreach": "@body('Parse_Order')?['Items']",
  "actions": {
    "Process_Item": {
      "type": "Http",
      "inputs": {
        "method": "POST",
        "uri": "https://api.example.com/items",
        "body": "@{items('Process_Each_Item')}"
      }
    }
  },
  "operationOptions": "Sequential",
  "runAfter": { "Parse_Order": ["SUCCEEDED"] }
}
```
**Note**: Default is parallel. Add `"operationOptions": "Sequential"` for sequential.
**BizTalk equivalent**: Looping shape (While/Until) over message collection.

### Until (Loop)
```json
"Retry_Until_Accepted": {
  "type": "Until",
  "expression": "@equals(variables('OrderStatus'), 'ACCEPTED')",
  "limit": { "count": 10, "timeout": "PT1H" },
  "actions": {
    "Poll_Status": { /* polling action */ },
    "Set_Status": {
      "type": "SetVariable",
      "inputs": {
        "name": "OrderStatus",
        "value": "@body('Poll_Status')?['status']"
      },
      "runAfter": { "Poll_Status": ["SUCCEEDED"] }
    }
  },
  "runAfter": {}
}
```
**BizTalk equivalent**: Until shape. For While loop: negate the condition in the Until expression.

### Scope (Error Handling)
```json
"Process_With_Error_Handling": {
  "type": "Scope",
  "actions": {
    "Call_API": { /* risky action */ },
    "Handle_Result": { /* next action */ }
  },
  "runAfter": {}
},
"Get_Scope_Failures": {
  "type": "Query",
  "inputs": {
    "from": "@result('Process_With_Error_Handling')",
    "where": "@equals(item()?['status'], 'Failed')"
  },
  "runAfter": { "Process_With_Error_Handling": ["FAILED"] }
}
```
**BizTalk equivalent**: Scope shape with Catch block.

### Terminate
```json
"Fail_With_Error": {
  "type": "Terminate",
  "inputs": {
    "runStatus": "Failed",
    "runError": {
      "code": "VALIDATION_ERROR",
      "message": "Order validation failed: @{body('Validate_Order')?['error']}"
    }
  },
  "runAfter": { "Validate_Order": ["SUCCEEDED"] }
}
```
**BizTalk equivalent**: Terminate shape or unhandled exception.

### Response (HTTP Reply)
```json
"Send_Response": {
  "type": "Response",
  "kind": "Http",
  "inputs": {
    "statusCode": 200,
    "headers": { "Content-Type": "application/json" },
    "body": "@{outputs('Build_Response')}"
  },
  "runAfter": { "Build_Response": ["SUCCEEDED"] }
}
```
**Required** when trigger is `Request` type (HTTP webhook).

### Initialize Variable / Set Variable
```json
"Init_Counter": {
  "type": "InitializeVariable",
  "inputs": {
    "variables": [{
      "name": "counter",
      "type": "Integer",
      "value": 0
    }]
  },
  "runAfter": {}
},
"Increment_Counter": {
  "type": "SetVariable",
  "inputs": {
    "name": "counter",
    "value": "@{add(variables('counter'), 1)}"
  },
  "runAfter": { "Init_Counter": ["SUCCEEDED"] }
}
```
**BizTalk equivalent**: Variable declaration + Expression/MessageAssignment shape.
**Types**: Boolean, Float, Integer, Object, String, Array

### Append to Array Variable
```json
"Collect_Result": {
  "type": "AppendToArrayVariable",
  "inputs": {
    "name": "results",
    "value": "@body('Process_Item')"
  }
}
```
**BizTalk equivalent**: Message collection in a loop (Aggregation pattern).

### ServiceProvider (Built-in Connector Action)
```json
"Send_To_Service_Bus": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "entityName": "outbound-orders",
      "message": {
        "contentData": "@{base64(body('Compose_Payload'))}",
        "contentType": "application/json",
        "userProperties": {
          "OrderId": "@{body('Parse_Order')?['OrderId']}"
        }
      }
    },
    "serviceProviderConfiguration": {
      "connectionName": "serviceBus",
      "operationId": "sendMessage",
      "serviceProviderId": "/serviceProviders/serviceBus"
    }
  }
}
```

### Workflow (Call Child Workflow — Standard Only)
```json
"Call_Child_Workflow": {
  "type": "Workflow",
  "inputs": {
    "host": {
      "workflow": { "id": "ChildWorkflowName" }
    },
    "body": {
      "orderId": "@body('Parse_Order')?['OrderId']"
    }
  },
  "runAfter": { "Parse_Order": ["SUCCEEDED"] }
}
```
**BizTalk equivalent**: Call Orchestration shape (synchronous).

### Transform (XSLT / Data Mapper)
```json
"Apply_XSLT_Map": {
  "type": "Xslt",
  "inputs": {
    "content": "@{triggerBody()}",
    "integrationAccount": {
      "map": { "name": "OrderToInvoiceMap" }
    }
  }
}
```
Or with inline Data Mapper (LML):
```json
"Apply_Data_Map": {
  "type": "DataMapper",
  "inputs": {
    "content": "@{triggerBody()}",
    "map": "@parameters('OrderToInvoiceMap')"
  }
}
```
**BizTalk equivalent**: Transform shape.

---

## 6. runAfter — Dependency Model

Every action specifies which preceding actions it depends on and what status is acceptable.

```json
"MyAction": {
  "runAfter": {
    "PreviousAction": ["SUCCEEDED"],
    "AnotherAction":  ["SUCCEEDED", "FAILED", "TIMEDOUT"]
  }
}
```

### Status Values (ALL CAPS in Standard)
- `"SUCCEEDED"` — action completed successfully
- `"FAILED"` — action failed
- `"SKIPPED"` — action was skipped (because its predecessor's runAfter condition wasn't met)
- `"TIMEDOUT"` — action timed out

### Error Handling Pattern
```json
"Happy_Path": {
  "runAfter": {}
},
"Error_Handler": {
  "runAfter": {
    "Happy_Path": ["FAILED", "TIMEDOUT"]
  }
}
```

### Parallel Actions Pattern (Scatter-Gather)
```json
"Branch_A": { "runAfter": { "Trigger": [] } },  /* or from same predecessor */
"Branch_B": { "runAfter": { "Trigger": [] } },
"Aggregate_Results": {
  "runAfter": {
    "Branch_A": ["SUCCEEDED"],
    "Branch_B": ["SUCCEEDED"]
  }
}
```
**BizTalk equivalent**: Parallel Actions shape — all branches run concurrently.

---

## 7. Expression Language

All expressions wrapped in `@{...}` or starting with `@`.

### String Functions
| Function | Example | Result |
|---|---|---|
| `concat(a, b, c)` | `@{concat('Hello', ' ', 'World')}` | `Hello World` |
| `substring(s, start, length)` | `@{substring('Hello', 0, 3)}` | `Hel` |
| `indexOf(s, search)` | `@{indexOf('Hello', 'l')}` | `2` |
| `lastIndexOf(s, search)` | `@{lastIndexOf('Hello', 'l')}` | `3` |
| `toLower(s)` | `@{toLower('HELLO')}` | `hello` |
| `toUpper(s)` | `@{toUpper('hello')}` | `HELLO` |
| `trim(s)` | `@{trim(' hello ')}` | `hello` |
| `startsWith(s, prefix)` | `@{startsWith('Hello', 'He')}` | `true` |
| `endsWith(s, suffix)` | `@{endsWith('Hello', 'lo')}` | `true` |
| `contains(collection, value)` | `@{contains('Hello', 'ell')}` | `true` |
| `replace(s, old, new)` | `@{replace('Hello', 'Hello', 'Hi')}` | `Hi` |
| `split(s, delimiter)` | `@{split('a,b,c', ',')}` | `["a","b","c"]` |
| `length(s or array)` | `@{length('Hello')}` | `5` |
| `string(val)` | `@{string(42)}` | `"42"` |
| `guid()` | `@{guid()}` | UUID string |
| `base64(s)` | `@{base64('Hello')}` | Base64 encoded |
| `base64ToString(s)` | `@{base64ToString('SGVsbG8=')}` | `Hello` |
| `uriComponent(s)` | `@{uriComponent('hello world')}` | `hello%20world` |
| `uriComponentToString(s)` | Decode URI component | |

### Math Functions
| Function | Example |
|---|---|
| `add(a, b)` | `@{add(10, 5)}` → 15 |
| `sub(a, b)` | `@{sub(10, 5)}` → 5 |
| `mul(a, b)` | `@{mul(10, 5)}` → 50 |
| `div(a, b)` | `@{div(10, 5)}` → 2 |
| `mod(a, b)` | `@{mod(10, 3)}` → 1 |
| `min(a, b)` | `@{min(3, 5)}` → 3 |
| `max(a, b)` | `@{max(3, 5)}` → 5 |
| `abs(n)` | `@{abs(-5)}` → 5 |
| `float(s)` | `@{float('3.14')}` → 3.14 |
| `int(s)` | `@{int('42')}` → 42 |
| `rand(min, max)` | Random integer |

### Date/Time Functions
| Function | Example | Notes |
|---|---|---|
| `utcNow()` | `@{utcNow()}` | ISO 8601 UTC timestamp |
| `utcNow(format)` | `@{utcNow('yyyy-MM-dd')}` | Formatted timestamp |
| `formatDateTime(dt, format)` | `@{formatDateTime(utcNow(), 'dd/MM/yyyy')}` | Format a datetime |
| `addDays(dt, n)` | `@{addDays(utcNow(), 7)}` | Add N days |
| `addHours(dt, n)` | | Add N hours |
| `addMinutes(dt, n)` | | Add N minutes |
| `addSeconds(dt, n)` | | Add N seconds |
| `addMonths(dt, n)` | | Add N months |
| `addYears(dt, n)` | | Add N years |
| `convertTimeZone(dt, fromTZ, toTZ)` | | Convert timezone |
| `dayOfWeek(dt)` | Returns 0=Sunday–6=Saturday | |
| `dayOfMonth(dt)` | Returns 1–31 | |
| `month(dt)` | Returns 1–12 | |
| `year(dt)` | Returns year | |
| `ticks(dt)` | DateTime as ticks (100-ns intervals since 1601) | |

### Comparison Functions (in Condition/If expressions)
```json
"expression": {
  "and": [
    { "equals": ["@body('Parse')?['Status']", "Active"] },
    { "greater": ["@float(body('Parse')?['Amount'])", 1000] },
    { "not": { "equals": ["@body('Parse')?['Type']", "Excluded"] } }
  ]
}
```
Functions: `equals`, `notEquals`, `greater`, `greaterOrEquals`, `less`, `lessOrEquals`, `contains`, `startsWith`, `endsWith`, `and`, `or`, `not`

### Collection Functions
| Function | Example |
|---|---|
| `first(array)` | First element |
| `last(array)` | Last element |
| `skip(array, count)` | Skip first N |
| `take(array, count)` | Take first N |
| `union(a, b)` | Merge two arrays (deduplicated) |
| `intersection(a, b)` | Elements in both arrays |
| `indexOf(array, item)` | Find index |
| `contains(array, item)` | Check membership |
| `json(s)` | Parse JSON string to object |
| `xml(s)` | Parse XML string |
| `xpath(xml, xpathExpr)` | Extract value from XML |
| `array(val)` | Wrap value in array |
| `createArray(a, b, c)` | Create array from values |
| `empty(val)` | True if null/empty/empty array |
| `coalesce(a, b)` | First non-null value |

### Reference Functions
| Function | Returns |
|---|---|
| `triggerBody()` | Trigger payload body |
| `triggerOutputs()` | Full trigger outputs (headers, body, etc.) |
| `body('ActionName')` | Output body of named action |
| `outputs('ActionName')` | Full outputs of named action |
| `result('ScopeName')` | Array of action results inside a Scope |
| `variables('name')` | Current value of a variable |
| `parameters('name')` | Value of a workflow parameter |
| `items('ForEachName')` | Current item in ForEach loop |
| `iterationIndexes('ForEachName')` | Current index in ForEach loop |
| `listCallbackUrl()` | Webhook callback URL (for webhook triggers) |
| `workflow()` | Workflow metadata (name, id, run id, etc.) |

---

## 8. Error Handling

### Retry Policies

```json
"retryPolicy": {
  "type": "exponential",     // "fixed" | "exponential" | "none"
  "count": 4,                // max retry attempts (max: 90)
  "interval": "PT7S",        // initial interval (ISO 8601 duration)
  "minimumInterval": "PT5S", // for exponential
  "maximumInterval": "PT1H"  // for exponential
}
```

**Default retry**: 4 retries, exponential backoff starting at 7 seconds.

### Scope + result() Pattern (BizTalk Scope + Catch)

```json
"Try_Scope": {
  "type": "Scope",
  "actions": {
    "Risky_Operation": { ... }
  }
},
"Handle_Failures": {
  "type": "Foreach",
  "foreach": "@result('Try_Scope')",
  "actions": {
    "Log_Failure": { ... }
  },
  "runAfter": { "Try_Scope": ["FAILED", "TIMEDOUT"] }
},
"Get_Failed_Actions": {
  "type": "Query",
  "inputs": {
    "from": "@result('Try_Scope')",
    "where": "@equals(item()?['status'], 'Failed')"
  },
  "runAfter": { "Try_Scope": ["FAILED"] }
}
```

---

## 9. Integration Account

Cloud container for B2B and enterprise integration artifacts. Required for EDI, AS2, XSLT maps (Consumption), and cross-workflow map sharing.

### Artifact Types

| Type | Description | BizTalk Equivalent |
|---|---|---|
| **Schemas (XSD)** | Message schemas for validation and parsing | BizTalk schemas in GAC |
| **Maps (XSLT/LML)** | Transformation stylesheets | BTM maps compiled to XSLT |
| **Partners** | Trading partner configurations | BizTalk Parties |
| **Agreements** | EDI settings between two partners | BizTalk Agreements |
| **Certificates** | X.509 certs for signing/encryption | BizTalk Certificates |
| **RosettaNet PIPs** | RosettaNet Process Integration Profiles | BizTalk RosettaNet |

### When Integration Account is Required

| Need | Consumption | Standard |
|---|---|---|
| X12 encode/decode | ✓ Required | ✓ Required |
| EDIFACT encode/decode | ✓ Required | ✓ Required |
| AS2 encode/decode | ✓ Required | ✓ Required |
| XSLT maps (cross-workflow) | ✓ Required | Optional (can inline) |
| Schema validation (shared) | ✓ Required | Optional (can inline) |

**Standard-specific**: Maps and schemas can be stored directly in the Logic Apps Standard app (no Integration Account needed for maps/schemas in Standard). Integration Account still required for EDI/AS2 protocols.

---

## 10. Connector Types

| Type | Hosting | Performance | Config Location | Examples |
|---|---|---|---|---|
| **Built-in (ServiceProvider)** | In-process with workflow | Highest (no external hop) | connections.json serviceProviderConnections | Service Bus, Blob, SQL, HTTP, SFTP, Event Hubs |
| **Managed (ApiConnection)** | Microsoft-hosted proxy | Standard | connections.json managedApiConnections | Office 365, SAP, Salesforce, Dynamics |
| **Custom Built-in** | In-process (Standard only) | In-process | NuGet package | Custom .NET connector |
| **Custom Managed** | Microsoft-hosted proxy | Standard | Custom API definition | OpenAPI-defined custom APIs |

### connections.json Structure

```json
{
  "serviceProviderConnections": {
    "serviceBus": {
      "parameterValues": {
        "connectionString": "@appsetting('SERVICE_BUS_CONNECTION')"
      },
      "serviceProvider": {
        "id": "/serviceProviders/serviceBus"
      }
    },
    "azureblob": {
      "parameterValues": {
        "connectionString": "@appsetting('BLOB_CONNECTION')"
      },
      "serviceProvider": {
        "id": "/serviceProviders/AzureBlob"
      }
    }
  },
  "managedApiConnections": {
    "office365": {
      "api": { "id": "/subscriptions/.../providers/Microsoft.Web/locations/eastus/managedApis/office365" },
      "connection": { "id": "/subscriptions/.../resourceGroups/rg/providers/Microsoft.Web/connections/office365" },
      "authentication": { "type": "ManagedServiceIdentity" }
    }
  }
}
```

### Key Built-in (ServiceProvider) Connectors

| Connector | Service Provider ID | Key Operations |
|---|---|---|
| Azure Service Bus | `/serviceProviders/serviceBus` | sendMessage, receiveQueueMessages, receiveTopicMessages, completeMessage |
| Azure Blob Storage | `/serviceProviders/AzureBlob` | getBlob, createBlob, updateBlob, deleteBlob, listBlobs |
| SQL Server | `/serviceProviders/sql` | executeQuery, executeStoredProcedure, insertRow, updateRow, getRow |
| Azure Event Hubs | `/serviceProviders/eventHubs` | sendEvent, receiveEvents |
| SFTP-SSH | `/serviceProviders/sftpWithSsh` | getFileContent, createFile, updateFileContent, listFolder |
| FTP | `/serviceProviders/ftp` | getFileContent, createFile, updateFileContent |
| SMTP | `/serviceProviders/smtp` | sendEmail |
| IBM MQ | `/serviceProviders/ibmMQ` | receiveMessage, sendMessage |
| HTTP | Built-in | Any HTTP/HTTPS call |
| Flat File | `/serviceProviders/flatFileOperations` | encodeFlatFile, decodeFlatFile |
| XML | `/serviceProviders/xmlOperations` | xmlValidate, xmlTransform |
| Azure Queues | `/serviceProviders/azurequeues` | sendMessage, receiveMessage |
| Azure Files | `/serviceProviders/azureFile` | getFileContent, createFile |
| Cosmos DB (Standard) | `/serviceProviders/documentdb` | queryDocuments, createDocument, replaceDocument |
| Azure Key Vault | `/serviceProviders/keyvault` | getSecret, setSecret |

---

## 11. Logic Apps Standard Project Structure

```
MyLogicApp/
├── host.json                         ← Runtime configuration
├── connections.json                  ← Connection references
├── parameters.json                   ← Parameter values (per-environment)
├── local.settings.json               ← Local dev settings (NOT deployed)
│
├── WorkflowName/
│   └── workflow.json                 ← Workflow definition (WDL)
│
├── WorkflowName2/
│   └── workflow.json
│
└── Artifacts/
    ├── Maps/                         ← XSLT or LML map files
    ├── Schemas/                      ← XSD schemas
    └── TrackingProfiles/             ← Tracking configuration
```

### host.json Key Settings

```json
{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle.Workflows",
    "version": "[1.*, 2.0.0)"
  },
  "extensions": {
    "workflow": {
      "settings": {
        "Runtime.FlowRetentionDays": "90"
      }
    },
    "serviceBus": {
      "prefetchCount": 0,
      "messageHandlerOptions": {
        "autoComplete": false,
        "maxConcurrentCalls": 16
      }
    }
  }
}
```

---

## 12. Limits Reference

| Limit | Value | Notes |
|---|---|---|
| Max actions per workflow | 500 | Split complex orchestrations into child workflows |
| Max nesting depth | 8 | ForEach inside If inside Scope = 3 levels |
| Max variables | 250 | |
| Max run timeout (stateful) | 90 days | |
| Max body size (actions) | 100 MB | Chunking for large content |
| Max array variable size | 100 MB | |
| Concurrent runs (stateful) | Configurable | Default: unlimited; set concurrencyControl |
| ForEach concurrency | 50 parallel | Configurable 1–50 |
| Until loop iterations | 5,000 | |
| Until loop timeout | ISO 8601 duration (default PT1H) | |
| Recurrence min interval | 1 second | |
| HTTP timeout | 120 seconds | Increase via `operationOptions: DisableAsyncPattern` |
| Retry max count | 90 | Default 4 |
