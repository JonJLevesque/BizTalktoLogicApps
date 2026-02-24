# Fixture 02: Simple File Receive → Transform → Send

## What This Tests

A simple **linear BizTalk orchestration** with three shapes:
1. **Receive** (activating) — reads XML file from `C:\Input\*.xml` via FILE adapter
2. **Construct + Transform** — maps `Order` schema to `ProcessedOrder` schema (adds ProcessedDate, LineTotal, OrderTotal)
3. **Send** — writes result to `C:\Output\%SourceFileName%` via FILE adapter

This is the most common BizTalk pattern — the "Hello World" of BizTalk migration.

## Files

| File | Description |
|---|---|
| `input/SampleOrder.xml` | Source order message (what arrives in C:\Input\) |
| `orchestration/SimpleFileReceive.odx.xml` | ODX XML — the orchestration definition |
| `bindings/BindingInfo.xml` | Binding file — FILE adapter configuration, port bindings |
| `expected-output/ProcessedOrder.xml` | Result after orchestration executes (what appears in C:\Output\) |

## Migration Notes

### BizTalk → Logic Apps Mapping

| BizTalk Component | Logic Apps Equivalent | Notes |
|---|---|---|
| Receive shape (FILE adapter) | Blob Storage trigger (polling) | FILE → Blob is the standard cloud migration. For on-prem files, use FileSystem connector + on-premises data gateway |
| `C:\Input\*.xml` | Blob container `orders-inbound` | Path becomes blob container + file filter |
| Poll interval (`60000ms = 60s`) | Recurrence trigger `PT1M` (1 minute) | Adjust interval to match original |
| XMLReceive pipeline | Built-in Parse XML / Content-Type detection | Standard XML pipeline = no special Logic Apps config needed |
| Construct + Transform shape | Transform XML (built-in) or XSLT action | Map must be separately migrated |
| Send shape (FILE adapter) | Blob Storage → Create blob | Write result to Blob |
| `%SourceFileName%` | `@{triggerBody()?['Name']}` | Logic Apps expression equivalent |
| XMLTransmit pipeline | No action needed | Standard XML output = default |

### Generated Logic Apps workflow.json Pattern

```json
{
  "triggers": {
    "Poll_for_order_files": {
      "type": "ServiceProvider",
      "inputs": {
        "parameters": {
          "containerName": "orders-inbound",
          "blobMatchingCondition": {
            "matchWildcardPattern": "*.xml"
          }
        },
        "serviceProviderConfiguration": {
          "connectionName": "azureblob",
          "operationId": "getBlob",
          "serviceProviderId": "/serviceProviders/AzureBlob"
        }
      },
      "recurrence": { "frequency": "Minute", "interval": 1 }
    }
  },
  "actions": {
    "Transform_Order": {
      "type": "Xslt",
      "inputs": {
        "content": "@{triggerBody()}",
        "integrationAccount": { "map": { "name": "OrderToProcessedOrderMap" } }
      },
      "runAfter": {}
    },
    "Write_Processed_Order": {
      "type": "ServiceProvider",
      "inputs": {
        "parameters": {
          "containerName": "orders-outbound",
          "blobName": "@{triggerBody()?['Name']}",
          "content": "@{body('Transform_Order')}"
        },
        "serviceProviderConfiguration": {
          "connectionName": "azureblob",
          "operationId": "createBlob",
          "serviceProviderId": "/serviceProviders/AzureBlob"
        }
      },
      "runAfter": { "Transform_Order": ["Succeeded"] }
    }
  }
}
```

### Complexity Assessment

| Criterion | Value |
|---|---|
| Pattern | Simple linear (Receive → Transform → Send) |
| Complexity tier | **Simple** |
| Manual effort | Low — automated migration with map review |
| Main risk | Map transformation (verify output fidelity with golden master) |
| FILE adapter note | Cloud deployment → Blob Storage; on-prem deployment → on-premises data gateway |
