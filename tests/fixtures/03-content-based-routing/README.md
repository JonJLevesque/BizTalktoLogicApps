# Fixture 03: Content-Based Routing (Decide Shape)

## What This Tests

A BizTalk orchestration that routes incoming orders to different destinations based on message content:

- **HIGH priority OR total > $10,000** → High-priority processing queue (`C:\Output\HighPriority\`)
- **Otherwise** → Standard processing queue (`C:\Output\Standard\`)

This is the most common enterprise integration pattern: **Content-Based Routing (CBR)**.

In BizTalk this can be implemented two ways:
1. **Orchestration with Decide shape** (this fixture) — explicit routing in code
2. **MessageBox subscriptions + send port filters** (without orchestration) — subscription-based routing

This fixture demonstrates approach #1 (orchestration-based CBR).

## Files

| File | Description |
|---|---|
| `input/HighPriorityOrder.xml` | Order with `Priority=HIGH` — should route to HighPriority output |
| `input/StandardOrder.xml` | Order with `Priority=NORMAL`, total < $10,000 — should route to Standard output |
| `orchestration/OrderRouter.odx.xml` | ODX orchestration with Decide shape |
| `bindings/BindingInfo.xml` | FILE adapter bindings with send port filter conditions |
| `expected-output/HighPriorityRoute.xml` | HighPriorityOrder.xml after routing (same content, different destination) |
| `expected-output/StandardRoute.xml` | StandardOrder.xml after routing |

## Migration Notes

### BizTalk Decide Shape → Logic Apps If (Condition) Action

The BizTalk Decide shape uses XLANG/s expressions (C#-like syntax):
```
IncomingOrder.Priority == "HIGH" || IncomingOrder.OrderTotal > 10000.0
```

Logic Apps equivalent (WDL If action):
```json
{
  "Route_By_Priority": {
    "type": "If",
    "expression": {
      "or": [
        { "equals": ["@body('Parse_Order')?['Priority']", "HIGH"] },
        { "greater": ["@float(body('Parse_Order')?['OrderTotal'])", 10000] }
      ]
    },
    "actions": {
      // High priority path
      "Send_To_High_Priority": { ... }
    },
    "else": {
      "actions": {
        // Standard path
        "Send_To_Standard": { ... }
      }
    },
    "runAfter": { "Parse_Order": ["Succeeded"] }
  }
}
```

### XLANG/s to WDL Expression Translation

| XLANG/s | WDL Equivalent | Notes |
|---|---|---|
| `msg.Priority == "HIGH"` | `@{equals(body('Parse_Order')?['Priority'], 'HIGH')}` | String equality |
| `msg.OrderTotal > 10000.0` | `@{greater(float(body('Parse_Order')?['OrderTotal']), 10000)}` | Numeric comparison |
| `a \|\| b` | `"or": [...]` | Logical OR in If expression |
| `a && b` | `"and": [...]` | Logical AND in If expression |
| `!condition` | `"not": [...]` | Logical NOT |

### Alternative: MessageBox Subscription-Based CBR

For this same pattern without an orchestration, BizTalk uses promoted properties + send port filters.
The `BindingInfo.xml` shows how this looks in filter syntax.

In Logic Apps, subscription-based CBR is best modeled as a **Switch action** when routing to different
Service Bus queues or endpoints by a discrete field value, or as separate workflow triggers
(one per topic subscription on a Service Bus topic).

### Complexity Assessment

| Criterion | Value |
|---|---|
| Pattern | Content-Based Routing (CBR) |
| Complexity tier | **Simple–Moderate** |
| Manual effort | Low — expression translation is deterministic |
| Main risk | Complex XLANG/s expressions with nested conditions |
| Promoted properties | If CBR uses promoted properties (not orchestration Decide), migration pattern differs |
