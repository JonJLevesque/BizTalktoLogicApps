# BizTalk Migration Test Fixtures

## Purpose

These fixtures provide **verified input → transform → expected-output test trios** for the migration engine.
They serve three roles:

1. **Engine unit tests** — verify that Stage 1 (Understand) and Stage 3 (Build) produce correct output
2. **LLM grounding** — show the LLM concrete examples of BizTalk artifacts and their expected behavior
3. **Round-trip validation** — run generated Logic Apps against same inputs; output must match golden master

## The Fixture Trio Pattern

Every fixture follows this structure (from Sandro Pereira's BizTalk map testing methodology):

```
fixture-name/
├── README.md            ← What this fixture tests; migration notes; known challenges
├── input/               ← Sample input message(s) — what BizTalk received
├── transform/           ← The BizTalk artifact (XSLT from compiled .btm, orchestration .odx.xml, etc.)
├── expected-output/     ← Actual output from BizTalk (golden master — must be preserved exactly)
└── schemas/             ← XSD schemas for input and/or output (if available)
```

## Reference Fixtures

| # | Fixture | BizTalk Pattern | Migration Challenge |
|---|---|---|---|
| 01 | `01-map-scripting-functoids/` | BTM map → compiled XSLT with embedded C# | C# functoids (StringConcat, age calc, cumulative sums) → WDL expressions or XSLT/LML |
| 02 | `02-simple-file-receive/` | Linear orchestration: Receive → Transform → Send (FILE adapter) | ODX shapes → trigger + actions; FILE adapter → Blob trigger |
| 03 | `03-content-based-routing/` | Decide shape routing by priority/value (XLANG/s expression) | Decide → If/Condition action; XLANG/s `||` `&&` → WDL `or`/`and` |

## Fixtures Still Needed (From Consultant Engagements)

The following fixture types should be added when real-world examples become available:

- `04-sequential-convoy/` — Correlating Receive shapes → Service Bus sessions
- `05-scatter-gather/` — Parallel Actions + aggregation → concurrent runAfter chains
- `06-bre-rules/` — Call Rules shape → Azure Functions
- `07-edi-pipeline/` — X12/EDIFACT pipeline → Integration Account maps
- `08-flat-file-disassemble/` — Flat File Disassembler pipeline → Flat File decoding connector
- `09-error-compensation/` — Scope + Catch + Compensate → Scope + runAfter ["Failed"]
- `10-wcf-service/` — WCF-BasicHttp send port → HTTP action

## Collecting Samples From Consultants

At the start of every migration engagement, ask:

1. **"Do you have sample XML/JSON messages this integration processes?"**
   - Ideal: 3–5 representative messages covering normal + edge cases
   - Minimum: 1 "happy path" message

2. **"Can you run these through BizTalk and save the actual outputs?"**
   - Run BizTalk with message tracking enabled
   - Save raw output from the MessageBox or receive location

3. **"Do you have unit tests or UAT test data from the original project?"**
   - Many BizTalk projects have BTDF unit tests or UAT spreadsheets with expected values

4. **"For maps: can you share the compiled XSLT? (BizTalk project → Maps folder → .xsl)**"
   - The compiled XSLT reveals all functoid logic including C# helper functions

5. **"Are there edge cases you know about — nulls, empties, very large documents?"**
   - Boundary conditions often expose map/orchestration bugs the migration must preserve

## Age Calculation Note

Fixture `01` uses a `CalcularIdade` (Calculate Age) C# functoid that calls `DateTime.Now`.
The expected output was generated on **2026-02-23**. The age value (40) will differ when the
test is run on a different date. Production test suites should mock the current date or
assert age within a range rather than exact equality.

## Sources

- **Sandro Pereira** ([@sandroasp](https://gist.github.com/sandroasp)) — Azure MVP, BizTalk & Logic Apps expert
  - XSLT fixture patterns from his "Como Funcionam os Mapas" (How Maps Work) tutorial series
  - Input/output XML pairs showing BizTalk map engine behavior
- Common BizTalk integration patterns (file receive, CBR, convoy) synthesized from industry examples
