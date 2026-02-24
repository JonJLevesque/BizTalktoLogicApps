# Enterprise Integration Pattern Migration Guide

> **Purpose**: Migration reference for each enterprise integration pattern from BizTalk to Logic Apps.
> **Source**: Patterns from Gregor Hohpe's Enterprise Integration Patterns (EIP) as implemented in BizTalk.
> **Last updated**: 2026-02-23

---

## 1. Content-Based Router (CBR)

### BizTalk Implementation
```
Orchestration: Decide shape with message field condition
  → Branch A: Send to Port A
  → Branch B: Send to Port B
  → else: Send to Default Port

OR (subscription-based):
  Send Port Group with filter expressions on promoted properties
```

### Logic Apps Implementation
```json
"Route_By_Priority": {
  "type": "If",
  "expression": {
    "or": [
      { "equals": ["@triggerBody()?['Priority']", "HIGH"] },
      { "greater": ["@triggerBody()?['OrderTotal']", 10000] }
    ]
  },
  "actions": {
    "Send_High_Priority": {
      "type": "Http",
      "inputs": {
        "method": "POST",
        "uri": "https://priority-queue.example.com/ingest",
        "body": "@triggerBody()"
      }
    }
  },
  "else": {
    "actions": {
      "Send_Standard": {
        "type": "ServiceProvider",
        "inputs": {
          "parameters": { "entityName": "standard-queue" },
          "serviceProviderConfiguration": {
            "connectionName": "serviceBus",
            "operationId": "sendMessage",
            "serviceProviderId": "/serviceProviders/serviceBus"
          }
        }
      }
    }
  }
}
```

### Multi-Branch (Switch)
```json
"Route_By_Region": {
  "type": "Switch",
  "expression": "@triggerBody()?['Region']",
  "cases": {
    "EMEA": {
      "case": "EMEA",
      "actions": { "Send_To_EMEA": { ... } }
    },
    "APAC": {
      "case": "APAC",
      "actions": { "Send_To_APAC": { ... } }
    }
  },
  "default": {
    "actions": { "Send_To_Default": { ... } }
  }
}
```

**Migration notes**:
- BizTalk promoted property filter (`BTS.MessageType == "Order"`) → Switch expression on message field
- BizTalk send port groups with filters → parallel conditional actions
- Complex numeric routing (`OrderTotal > 10000`) requires orchestration in BizTalk (filter syntax limitation); in Logic Apps, use `@{greater(body()?['OrderTotal'], 10000)}`

---

## 2. Sequential Convoy (Ordered Message Processing)

### BizTalk Implementation
```
Orchestration with correlation set on OrderId
  - First Receive: activating, initializes correlation on OrderId
  - Subsequent Receives: correlated, follow correlation on OrderId
  - Messages processed in sequence within orchestration instance
```

### Logic Apps Implementation
```
Azure Service Bus with Sessions (FIFO per session key)

Trigger:
  - ServiceProvider: receiveQueueMessages with sessionMode: true
  - sessionId = OrderId (correlation key)

Pattern:
  1. Producer sends messages to Session-enabled queue, sessionId = OrderId
  2. Logic Apps trigger receives messages from session (ordered)
  3. Processing happens sequentially within session
```

```json
"When_Session_Message_Received": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "entityName": "orders-queue",
      "receiveMode": "peekLock",
      "sessionId": "@{triggerBody()?['SessionId']}"
    },
    "serviceProviderConfiguration": {
      "connectionName": "serviceBus",
      "operationId": "receiveQueueMessages",
      "serviceProviderId": "/serviceProviders/serviceBus"
    }
  }
}
```

**Migration notes**:
- BizTalk orchestration instance = Service Bus session
- BizTalk correlation set value = Service Bus `sessionId`
- Session-enabled queues maintain FIFO ordering within a session
- Requires Service Bus Standard or Premium tier

---

## 3. Scatter-Gather (Fan-Out + Aggregation)

### BizTalk Implementation
```
Orchestration Parallel Actions shape:
  - Branch 1: Send to Supplier A, receive quote
  - Branch 2: Send to Supplier B, receive quote
  - Branch 3: Send to Supplier C, receive quote
  → Synchronize
  → Aggregate best quote
  → Send result
```

### Logic Apps Implementation
```json
"Initialize_Results": {
  "type": "InitializeVariable",
  "inputs": { "variables": [{ "name": "QuoteResults", "type": "array", "value": [] }] }
},
"Get_Quote_Supplier_A": {
  "type": "Http",
  "inputs": { "method": "POST", "uri": "https://supplier-a.com/quote", "body": "@triggerBody()" },
  "runAfter": { "Initialize_Results": ["SUCCEEDED"] }
},
"Get_Quote_Supplier_B": {
  "type": "Http",
  "inputs": { "method": "POST", "uri": "https://supplier-b.com/quote", "body": "@triggerBody()" },
  "runAfter": { "Initialize_Results": ["SUCCEEDED"] }
},
"Aggregate_Quotes": {
  "type": "Compose",
  "inputs": {
    "bestQuote": "@{min(body('Get_Quote_Supplier_A')?['price'], body('Get_Quote_Supplier_B')?['price'])}",
    "results": ["@body('Get_Quote_Supplier_A')", "@body('Get_Quote_Supplier_B')"]
  },
  "runAfter": {
    "Get_Quote_Supplier_A": ["SUCCEEDED"],
    "Get_Quote_Supplier_B": ["SUCCEEDED"]
  }
}
```

**Migration notes**:
- Parallel Actions shape → multiple actions with same `runAfter` predecessor
- Synchronize shape → action with ALL predecessors in `runAfter`
- Dynamic scatter (unknown number of targets) → ForEach with `runtimeConfiguration.concurrency.repetitions`
- Aggregation logic → Compose action with array expressions

---

## 4. Publish-Subscribe (Pub/Sub)

### BizTalk Implementation
```
MessageBox pub/sub:
  - Publisher: Send to MessageBox with promoted properties
  - Subscribers: Send ports with filter expressions on promoted properties
  - Multiple subscribers receive same message independently

Explicit pub/sub:
  - Publisher: Send to Service Bus topic
  - Subscribers: Receive from topic subscriptions
```

### Logic Apps Implementation
```
Option A: Azure Service Bus Topics (preferred)
  Publisher Logic App → Send to Service Bus topic
  Subscriber Logic Apps → Trigger on topic subscription (independent)

Option B: Azure Event Grid
  Publisher Logic App → Publish custom event to Event Grid
  Subscriber Logic Apps → HTTP webhook trigger subscribed to event type
```

**Publisher:**
```json
"Publish_Order_Event": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "entityName": "orders-topic",
      "message": {
        "contentData": "@{base64(string(triggerBody()))}",
        "userProperties": {
          "MessageType": "OrderCreated",
          "Region": "@{triggerBody()?['Region']}"
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

**Subscriber trigger:**
```json
"When_Order_Published": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "entityName": "orders-topic/subscriptions/billing-sub",
      "receiveMode": "peekLock"
    },
    "serviceProviderConfiguration": {
      "connectionName": "serviceBus",
      "operationId": "receiveTopicMessages",
      "serviceProviderId": "/serviceProviders/serviceBus"
    }
  },
  "recurrence": { "frequency": "Second", "interval": 30 }
}
```

**Migration notes**:
- BizTalk MessageBox filters → Service Bus topic subscription SQL filters
- `BTS.MessageType == "Order"` → filter on `MessageType` user property
- Multiple send port subscribers → multiple Logic Apps on separate subscriptions
- Fan-out automatically handled by Service Bus topics

---

## 5. Request-Reply (Synchronous Call-Response)

### BizTalk Implementation
```
Orchestration:
  Send (request) to port with Request-Response type
  Receive (reply) on same correlated port

OR:
  HTTP 2-way receive location
  Response sent back synchronously
```

### Logic Apps Implementation
```json
"Receive_Request": {
  "type": "Request",
  "kind": "Http"
},
"Process_Order": {
  "type": "ServiceProvider",
  "inputs": { ... },
  "runAfter": { "Receive_Request": ["SUCCEEDED"] }
},
"Return_Response": {
  "type": "Response",
  "inputs": {
    "statusCode": 200,
    "headers": { "Content-Type": "application/json" },
    "body": {
      "orderId": "@{triggerBody()?['orderId']}",
      "status": "Accepted",
      "processedAt": "@{utcNow()}"
    }
  },
  "runAfter": { "Process_Order": ["SUCCEEDED"] }
}
```

**For async reply via callback:**
```json
"Return_Accepted_With_Callback_Url": {
  "type": "Response",
  "inputs": {
    "statusCode": 202,
    "headers": { "Location": "@{listCallbackUrl()}" },
    "body": { "status": "Processing", "checkUrl": "@{listCallbackUrl()}" }
  }
}
```

**Migration notes**:
- BizTalk 2-way receive location → HTTP Request trigger + Response action
- `listCallbackUrl()` provides webhook URL for async response scenarios
- Synchronous response must complete within Logic Apps timeout (5 min Consumption, configurable Standard)
- For long-running sync scenarios: return 202 + callback URL pattern

---

## 6. Message Aggregator (Batch Correlation)

### BizTalk Implementation
```
Orchestration with sequential convoy:
  - Receive multiple messages with correlation set
  - Accumulate in a collection
  - Trigger on count OR timeout
  - Process aggregated batch
```

### Logic Apps Implementation
```
Option A: Service Bus + scheduled batch trigger
Option B: Cosmos DB accumulation + timer trigger
Option C: Event Grid + aggregation Logic App (stateful)
```

**Batch-Trigger approach (Consumption):**
```json
"BatchTrigger": {
  "type": "Batch",
  "inputs": {
    "mode": "Inline",
    "configurations": {
      "processBatch": {
        "releaseCriteria": {
          "messageCount": 10,
          "recurrence": { "frequency": "Minute", "interval": 5 }
        }
      }
    }
  }
}
```

**Accumulation via Cosmos DB (Standard):**
```json
"Accumulate_Message": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "containerId": "order-batch",
      "item": {
        "id": "@{triggerBody()?['OrderId']}",
        "batchId": "@{triggerBody()?['BatchId']}",
        "message": "@triggerBody()"
      }
    },
    "serviceProviderConfiguration": {
      "connectionName": "cosmosDb",
      "operationId": "CreateOrUpdateDocument",
      "serviceProviderId": "/serviceProviders/documentDb"
    }
  }
}
```

**Migration notes**:
- BizTalk sequential convoy with time-out → Logic Apps Batch trigger (Consumption) or timer + query pattern (Standard)
- BizTalk message count trigger → Batch trigger `messageCount` release criterion
- BizTalk correlating by header value → `groupName` or `groupId` in Batch trigger

---

## 7. Message Enricher (Content Enrichment)

### BizTalk Implementation
```
Orchestration:
  Receive message
  Call external service/database to get enrichment data
  Construct new message combining original + enrichment
  Send enriched message
```

### Logic Apps Implementation
```json
"Receive_Order": { "type": "Request", "kind": "Http" },
"Get_Customer_Data": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "query": "SELECT * FROM Customers WHERE CustomerId = @customerId",
      "queryParameters": { "customerId": "@{triggerBody()?['CustomerId']}" }
    },
    "serviceProviderConfiguration": {
      "connectionName": "sql",
      "operationId": "executeQueryV2",
      "serviceProviderId": "/serviceProviders/sql"
    }
  },
  "runAfter": { "Receive_Order": ["SUCCEEDED"] }
},
"Enrich_Order": {
  "type": "Compose",
  "inputs": {
    "orderId": "@{triggerBody()?['OrderId']}",
    "customerId": "@{triggerBody()?['CustomerId']}",
    "customerName": "@{body('Get_Customer_Data')?['ResultSets']?['Table1']?[0]?['CustomerName']}",
    "customerTier": "@{body('Get_Customer_Data')?['ResultSets']?['Table1']?[0]?['Tier']}",
    "orderTotal": "@{triggerBody()?['OrderTotal']}"
  },
  "runAfter": { "Get_Customer_Data": ["SUCCEEDED"] }
}
```

**Migration notes**:
- BizTalk Construct Message + field assignments from external data → Compose action combining bodies
- BizTalk orchestration variables → Logic Apps variables or direct body() references
- Enrichment from database → SQL built-in ServiceProvider action
- Enrichment from HTTP service → HTTP action + extract fields via body()

---

## 8. Dead Letter Queue (Dead-Lettering)

### BizTalk Implementation
```
Suspended Message Queue:
  - Failed messages go to BizTalk Admin Console suspended queue
  - Can be resubmitted manually
  - Custom error handling: Catch block → Send to error port
```

### Logic Apps Implementation
```json
"Process_Message_Scope": {
  "type": "Scope",
  "actions": {
    "Process_Order": { ... }
  },
  "runAfter": { "When_Message_Received": ["SUCCEEDED"] }
},
"Handle_Processing_Failure": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "entityName": "orders-queue",
      "deadLetterReason": "ProcessingFailed",
      "deadLetterErrorDescription": "@{result('Process_Message_Scope')[0]['error']['message']}"
    },
    "serviceProviderConfiguration": {
      "connectionName": "serviceBus",
      "operationId": "deadLetterMessage",
      "serviceProviderId": "/serviceProviders/serviceBus"
    }
  },
  "runAfter": { "Process_Message_Scope": ["FAILED"] }
},
"Complete_Message_After_Success": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": { "entityName": "orders-queue" },
    "serviceProviderConfiguration": {
      "connectionName": "serviceBus",
      "operationId": "completeMessage",
      "serviceProviderId": "/serviceProviders/serviceBus"
    }
  },
  "runAfter": { "Process_Message_Scope": ["SUCCEEDED"] }
}
```

**Migration notes**:
- BizTalk suspended queue → Service Bus Dead Letter Queue (DLQ)
- `receiveMode: "peekLock"` required (message not consumed until explicitly completed/dead-lettered)
- BizTalk "Resume" from suspended queue → reprocess messages from DLQ using separate Logic App
- `result()` function gets scope execution details including error message

---

## 9. Retry / Idempotent Receiver

### BizTalk Implementation
```
Adapter retry settings (retry count + retry interval)
Orchestration retry pattern: Until loop around Send shape
Custom pipeline component for idempotency check
```

### Logic Apps Implementation

**Connector-level retry policy:**
```json
"Call_ERP": {
  "type": "Http",
  "inputs": { "method": "POST", "uri": "...", "body": "@triggerBody()" },
  "runtimeConfiguration": {
    "contentTransfer": { "transferMode": "Chunked" }
  },
  "retryPolicy": {
    "type": "exponential",
    "count": 3,
    "interval": "PT10S",
    "minimumInterval": "PT10S",
    "maximumInterval": "PT1H"
  }
}
```

**Idempotency check via Cosmos DB:**
```json
"Check_Idempotency_Key": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "containerId": "processed-ids",
      "itemId": "@{triggerBody()?['OrderId']}"
    },
    "serviceProviderConfiguration": {
      "connectionName": "cosmosDb",
      "operationId": "ReadDocument",
      "serviceProviderId": "/serviceProviders/documentDb"
    }
  }
},
"Skip_If_Already_Processed": {
  "type": "If",
  "expression": { "equals": ["@{outputs('Check_Idempotency_Key')?['statusCode']}", 200] },
  "actions": { "Terminate_Already_Processed": { "type": "Terminate", "inputs": { "runStatus": "Cancelled" } } },
  "else": { "actions": { "Process_Message": { ... } } }
}
```

**Migration notes**:
- BizTalk adapter retry → Logic Apps action `retryPolicy` (fixed/exponential/none)
- Idempotency in BizTalk (via pipeline components) → Cosmos DB or Redis lookup before processing
- BizTalk's "resubmit from suspended queue" → Logic Apps rerun from Run History UI or API

---

## 10. Claim Check (Store and Retrieve Large Messages)

### BizTalk Implementation
```
Custom pipeline component or large message extension:
  - Store large message in SQL/file share
  - Pass only reference token through MessageBox
  - Retrieve at send time
```

### Logic Apps Implementation
```json
"Store_Large_Payload": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "containerName": "claim-check-store",
      "blobName": "@{concat(triggerBody()?['OrderId'], '-', utcNow(), '.json')}",
      "content": "@triggerBody()"
    },
    "serviceProviderConfiguration": {
      "connectionName": "azureblob",
      "operationId": "uploadBlob",
      "serviceProviderId": "/serviceProviders/AzureBlob"
    }
  }
},
"Send_Claim_Token": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "entityName": "orders-queue",
      "message": {
        "contentData": "@{base64(json(concat('{\"blobName\":\"', body('Store_Large_Payload')?['name'], '\"}')))}",
        "userProperties": { "MessageType": "ClaimToken" }
      }
    },
    "serviceProviderConfiguration": {
      "connectionName": "serviceBus",
      "operationId": "sendMessage",
      "serviceProviderId": "/serviceProviders/serviceBus"
    }
  },
  "runAfter": { "Store_Large_Payload": ["SUCCEEDED"] }
}
```

**Migration notes**:
- Logic Apps has a 100MB action output limit (Standard); use Claim Check for larger payloads
- Azure Blob Storage is the natural claim-check store
- Pass blob name/URL as the claim token through Service Bus

---

## 11. Process Manager (Long-Running Business Process)

### BizTalk Implementation
```
Orchestration with:
  - Multiple correlated receives
  - Wait states (Listen shapes)
  - Long-running transaction scope
  - Compensation logic
  - Timer-based escalation (Listen with Delay branch)
```

### Logic Apps Implementation
```
Standard stateful workflow (durable execution):
  - Stateful = checkpoint + rehydrate between steps
  - No explicit correlation sets; identity = workflow run ID
  - Timer-based escalation: Delay-Until action
  - Compensation: explicit compensating workflow design
```

```json
"Wait_For_Approval": {
  "type": "Http",
  "inputs": {
    "method": "POST",
    "uri": "https://approval-service.example.com/request",
    "body": {
      "orderId": "@{triggerBody()?['OrderId']}",
      "callbackUrl": "@{listCallbackUrl()}"
    }
  }
},
"Escalate_If_Not_Approved": {
  "type": "Delay",
  "inputs": { "interval": { "count": 48, "unit": "Hour" } },
  "runAfter": { "Wait_For_Approval": ["SUCCEEDED"] }
}
```

**Migration notes**:
- BizTalk dehydration/rehydration → Logic Apps Standard stateful execution (automatic persistence)
- BizTalk correlated receive = waiting for callback HTTP trigger to specific run
- BizTalk Listen with Delay → Delay-Until action (set target datetime for escalation)
- BizTalk compensation → design explicit undo Logic App or compensation actions in Scope catch

---

## 12. Message Filter

### BizTalk Implementation
```
Send port subscription filter:
  BTS.MessageType == "http://orders#PurchaseOrder"
  AND Order.Priority == "HIGH"

OR: Orchestration Decision shape discarding messages
```

### Logic Apps Implementation

**At trigger level (Service Bus subscription filter):**
```
Service Bus SQL filter on subscription:
  MessageType = 'PurchaseOrder' AND Priority = 'HIGH'
```

**At action level:**
```json
"Filter_Check": {
  "type": "If",
  "expression": {
    "and": [
      { "equals": ["@{triggerBody()?['MessageType']}", "PurchaseOrder"] },
      { "equals": ["@{triggerBody()?['Priority']}", "HIGH"] }
    ]
  },
  "actions": { "Process_Matching": { ... } },
  "else": {
    "actions": {
      "Terminate_No_Match": {
        "type": "Terminate",
        "inputs": { "runStatus": "Cancelled", "runCause": "MessageFilteredOut" }
      }
    }
  }
}
```

**Migration notes**:
- BizTalk promoted property filter → Service Bus message property SQL filter (server-side, efficient)
- BizTalk message type filter → `triggerBody()?['$schema']` or content-based check
- Non-matching messages: Terminate with Cancelled status (not Failed) to avoid alert noise

---

## 13. Splitter (Message Decomposition)

### BizTalk Implementation
```
XML Disassembler (envelope debatching):
  - Receive envelope document
  - Disassemble into individual messages
  - Publish each message to MessageBox separately

OR: Orchestration Loop shape iterating over collection
```

### Logic Apps Implementation
```json
"Parse_Batch": {
  "type": "ParseJson",
  "inputs": {
    "content": "@triggerBody()",
    "schema": {
      "type": "object",
      "properties": {
        "Orders": { "type": "array", "items": { "$ref": "#/definitions/Order" } }
      }
    }
  }
},
"Process_Each_Order": {
  "type": "Foreach",
  "foreach": "@body('Parse_Batch')?['Orders']",
  "actions": {
    "Send_Individual_Order": {
      "type": "Http",
      "inputs": {
        "method": "POST",
        "uri": "https://order-processor.example.com/order",
        "body": "@items('Process_Each_Order')"
      }
    }
  },
  "runtimeConfiguration": {
    "concurrency": { "repetitions": 1 }
  },
  "runAfter": { "Parse_Batch": ["SUCCEEDED"] }
}
```

**Migration notes**:
- BizTalk envelope debatching → ForEach over parsed array
- `concurrency.repetitions: 1` for sequential processing; remove/increase for parallel
- BizTalk `%MessageID%` tracking per debatched message → generate GUID per item: `@{guid()}`
- XML envelope splitting → `xpath()` in ForEach or Transform action to extract nodes

---

## 14. Wire Tap (Message Inspection / Audit)

### BizTalk Implementation
```
Custom pipeline component that copies messages to audit port
OR: BAM activity tracking
```

### Logic Apps Implementation
```json
"Process_Message": { "type": "Http", "inputs": { ... } },
"Audit_Log": {
  "type": "ServiceProvider",
  "inputs": {
    "parameters": {
      "containerName": "audit-log",
      "blobName": "@{concat('audit/', utcNow('yyyy/MM/dd'), '/', triggerBody()?['OrderId'], '.json')}",
      "content": {
        "timestamp": "@{utcNow()}",
        "workflowRunId": "@{workflow()['run']['name']}",
        "triggeredBy": "@{triggerOutputs()?['headers']?['x-ms-client-request-id']}",
        "message": "@triggerBody()",
        "processingResult": "@{body('Process_Message')}"
      }
    },
    "serviceProviderConfiguration": {
      "connectionName": "azureblob",
      "operationId": "uploadBlob",
      "serviceProviderId": "/serviceProviders/AzureBlob"
    }
  },
  "runAfter": { "Process_Message": ["SUCCEEDED", "FAILED", "TIMEDOUT"] }
}
```

**Migration notes**:
- BizTalk pipeline tracking → Tracked Properties (built-in run history + Application Insights)
- BizTalk BAM activity → Application Insights `trackEvent` via Azure Monitor
- Wire tap pattern → parallel action (same runAfter predecessor) writing to Blob/Cosmos
- `"SUCCEEDED", "FAILED", "TIMEDOUT"` in runAfter ensures audit happens regardless of outcome

---

## 15. Pattern Detection Reference

Use this table when analyzing BizTalk orchestrations to identify which patterns are present:

| If you see in BizTalk... | Pattern | Logic Apps Design |
|---|---|---|
| Correlation set + multiple Receives | Sequential Convoy | Service Bus Sessions |
| Decide shape with adapter sends | Content-Based Router | If / Switch action |
| Parallel Actions + merge/sync | Scatter-Gather | Parallel actions + Compose aggregation |
| MessageBox pub/sub (multiple send ports, same msg) | Publish-Subscribe | Service Bus Topics |
| Receive + Call external + Construct | Message Enricher | HTTP/SQL action + Compose |
| Catch block → dead-letter send port | Dead Letter Queue | Service Bus DLQ |
| Loop around Send with retry | Retry | Action retryPolicy |
| Listen with Delay branch | Escalation / Timeout | Delay-Until action |
| ForEach over message collection | Splitter | ForEach action |
| Pipeline wire tap component | Wire Tap | Parallel Blob/AI audit action |
| Long orchestration with Suspend | Process Manager | Standard stateful workflow |
| Correlation + Wait states | Durable Correlation | HTTP callback + listCallbackUrl() |
| Atomic transaction scope | Compensating Transaction | Compensation workflow design |
