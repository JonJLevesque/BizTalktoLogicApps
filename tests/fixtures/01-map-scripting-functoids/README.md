# Fixture 01: Map with Scripting Functoids

## What This Tests

A BizTalk **BTM (map)** compiled to XSLT that uses C# scripting functoids to perform:

1. **String concatenation** (`StringConcat`) — join first name + space + last name into full name
2. **Age calculation** (`CalcularIdade`) — compute age from date of birth using `DateTime.Now`
3. **Conditional field** — only include postal code if the field is non-empty (LogicalIsString check)
4. **Address passthrough** — copy address fields directly with no transformation
5. **Cumulative sum + segregation** — split billing items into two buckets (low-value `< 500` and high-value `>= 500`) with running totals

## Source

Based on Sandro Pereira's "Como Funcionam os Mapas" (How Maps Work) BizTalk tutorial series.
Original gist: https://gist.github.com/sandroasp/1597897

## Files

| File | Description |
|---|---|
| `input/PeopleOrigin.xml` | Source message — person with address and billing items |
| `transform/PeopleMap.xsl` | Compiled XSLT from BizTalk BTM (contains embedded C# functoids) |
| `expected-output/PeopleDestination.xml` | Output after applying the map (golden master) |
| `schemas/PeopleOrigin.xsd` | XSD for source schema (`http://ComoFuncinamOsMapas.PessoaOrigem`) |
| `schemas/PeopleDestination.xsd` | XSD for target schema (`http://ComoFuncinamOsMapas.PessoaDestino2`) |

## Migration Notes

### BizTalk BTM → Logic Apps

The BTM map file (not included — only compiled XSLT) would reference:
- Source schema: `PeopleOrigin.xsd`
- Target schema: `PeopleDestination.xsd`
- Scripting functoids with inline C# code

### Migration Paths (Stage 3 Build Output)

**Option A: Preserve as XSLT** (Integration Account or Standard built-in)
- Use the compiled `.xsl` file directly
- Register in Integration Account under Integration Account > Maps
- Logic Apps action: `Transform XML` or built-in XSLT action
- Pros: Exact functional match, minimal migration effort
- Cons: C# scripting functoids (`msxsl:script`) are not supported in Logic Apps XSLT — **must rewrite**

**Option B: LML (Data Mapper)** — Recommended for new migrations
- Rewrite as Logic Apps Mapping Language (YAML)
- Name concat: LML `concat()` expression
- Age calc: LML `subtractFromDate()` or custom expression
- Conditional postal: LML `if()` conditional mapping
- Cumulative sums: LML `sum()` with filter
- Pros: Native Logic Apps format, GUI-editable in VS Code Data Mapper
- Cons: More rewrite effort; cumulative filtered sums require specific LML syntax

**Option C: Azure Functions**
- Wrap the XSLT transformation in an Azure Function (.NET)
- The C# functoid code can be preserved largely as-is
- Pros: Exact C# logic preservation
- Cons: Additional Azure resource; testability complexity

### Key Challenge: C# Functoids

The embedded C# in `msxsl:script` blocks will **not** execute in Logic Apps XSLT action.
Logic Apps uses .NET's native XSLT processor which does not support `msxsl:script`.

**What the migration engine must do**:
1. Detect `msxsl:script` blocks in XSLT → flag as "C# functoid" pattern
2. Parse each C# function body (e.g., `CalcularIdade`, `StringConcat`)
3. Map each function to the equivalent WDL expression or LML mapping function
4. Generate the corresponding LML or WDL expression

**Known functoid translations**:
| C# Functoid | LML Equivalent | WDL Expression |
|---|---|---|
| `StringConcat(a, b, c)` | `concat($a, $b, $c)` | `@{concat(a, b, c)}` |
| `CalcularIdade(dob)` | (custom expression or helper) | `@{sub(year(utcNow()), year(dob))}` (approx) |
| `LogicalIsString(val)` | `isString($val)` | `@{equals(string(val), val)}` |
| `StringLeft(s, n)` | `substring($s, 1, $n)` | `@{substring(s, 0, n)}` |

## Age Calculation Date Dependency

⚠️ **Important**: The `CalcularIdade` function calls `DateTime.Now`, so the expected output
age value (`40`) was correct when this fixture was created on **2026-02-23**.

When running automated tests against this fixture, either:
- Mock `DateTime.Now` to `2026-02-23` in the test context
- Assert age is within `[40, 42]` range rather than exact equality
- Update the expected output file when the fixture age needs refreshing

## Test Data

| Field | Value | Notes |
|---|---|---|
| Input: Nome | João | First name |
| Input: Apelido | Silva | Last name (surname) |
| Input: DataNascimento | 1985-07-15 | Born July 15, 1985 |
| Input: CodigoPostal | 1234-567 | Portuguese postal code (non-empty → included in output) |
| Input: Billing Item 1 | 150.00 | Low value (< 500) |
| Input: Billing Item 2 | 600.00 | High value (>= 500) |
| Input: Billing Item 3 | 75.00 | Low value (< 500) |
| Expected: NomeCompleto | João Silva | StringConcat(Nome, " ", Apelido) |
| Expected: Idade | 40 | As of 2026-02-23 |
| Expected: ValoresBaixos | 225.00 | 150.00 + 75.00 |
| Expected: ValoresAltos | 600.00 | 600.00 only |
