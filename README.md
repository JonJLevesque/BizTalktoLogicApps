# BizTalk to Logic Apps Migration Tool

**Migrate Microsoft BizTalk Server applications to Azure Logic Apps — automatically.**

Point it at a folder of BizTalk files. Get back a deployable Azure project, a gap analysis, and a migration report. No deep Azure expertise required.

> **Why this exists**: Microsoft BizTalk Server reaches end of extended support in **October 2028**. Every organization running BizTalk must migrate. This tool makes that process fast, systematic, and correct.

---

## What You Get

Run one command. Get back:

```
output/
├── ProcessOrder/
│   └── workflow.json          ← Your migrated Logic Apps workflow
├── connections.json           ← Azure service connections
├── host.json                  ← Runtime configuration
├── local.settings.json        ← App settings template (fill in connection strings)
├── infra/
│   └── main.bicep             ← Azure deployment template
└── migration-report.md        ← Gap analysis, effort estimates, what needs manual work
```

Everything in that folder can be deployed directly to Azure Logic Apps Standard.

---

## Before You Start

You need three things:

1. **Node.js 20 or later** — [nodejs.org](https://nodejs.org)
2. **Your BizTalk application's export files** — see below
3. **A license key** — [biztalkmigrate.com](https://biztalkmigrate.com) (free tier available)

### How to export your BizTalk files

In BizTalk Administration Console:

1. Right-click your application → **Export → MSI file** — this gives you the `.odx`, `.btm`, and `.btp` files
2. Right-click your application → **Export → Bindings** → save as `BindingInfo.xml`

Put all those files in one folder. That folder is your input.

---

## Install

```bash
git clone https://github.com/jonlevesque/BiztalktoLogicapps.git
cd BiztalktoLogicapps
npm install
npm run build
```

---

## Run Your First Migration

```bash
BTLA_LICENSE_KEY=your-key-here node dist/cli/index.js run \
  --dir ./path/to/biztalk-files \
  --app "YourApplicationName" \
  --output ./output
```

That's it. The tool:
1. Parses every `.odx`, `.btm`, `.btp`, and `BindingInfo.xml` it finds
2. Scores complexity, detects integration patterns, identifies gaps
3. Sends the migration intent to the AI for enrichment (via the proxy — your BizTalk files never leave your machine)
4. Generates the Logic Apps project
5. Validates the output and scores quality (target: grade B or higher)
6. Writes `migration-report.md`

Console output looks like:

```
[PARSE   ] Found 4 artifacts — 2 orchestrations, 1 map, 1 binding
[REASON  ] Enriching migration intent...
[SCAFFOLD] Generating Logic Apps package...
[VALIDATE] Quality: 83/100  Grade B
✔ Migration complete — output written to ./output
```

### Try it without a license key (dev mode)

```bash
BTLA_DEV_MODE=true node dist/cli/index.js run \
  --dir tests/fixtures/02-simple-file-receive \
  --app "SimpleFileReceive" \
  --output ./test-output
```

Dev mode skips the AI enrichment step and runs fully offline. Good for testing the install.

---

## License Tiers

| What you can do | Free | Standard | Premium |
|---|:---:|:---:|:---:|
| Parse BizTalk artifacts (Stage 1) | ✅ | ✅ | ✅ |
| Gap analysis + architecture recommendation (Stage 2) | ✅ | ✅ | ✅ |
| Generate Logic Apps workflows, connections, infra (Stage 3) | — | ✅ | ✅ |
| Build a deployable Logic Apps package | — | ✅ | ✅ |
| Greenfield NLP — design a new workflow from a description | — | — | ✅ |
| 50+ pre-built workflow templates | — | — | ✅ |

Get your key at [biztalkmigrate.com](https://biztalkmigrate.com) or email [Me@Jonlevesque.com](mailto:Me@Jonlevesque.com).

Set it as an environment variable so you don't have to type it every time:

```bash
# macOS / Linux — add to ~/.zshrc or ~/.bashrc
export BTLA_LICENSE_KEY="your-key-here"

# Windows (PowerShell)
$env:BTLA_LICENSE_KEY="your-key-here"
```

---

## Three Ways to Use It

### 1. CLI — quickest

```bash
node dist/cli/index.js run --dir ./artifacts --app "MyApp" --output ./output
```

Full CLI reference: run `node dist/cli/index.js --help`

### 2. VS Code Extension — recommended for day-to-day work

Open this repo folder in VS Code. The extension activates automatically when you open any `.odx`, `.btm`, `.btp`, or `BindingInfo.xml` file.

Use the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

- **BizTalk Migrate: Run Migration** — the one-command pipeline with a folder picker and real-time progress
- **BizTalk Migrate: Analyze Directory** — Stage 1 + 2 only (free tier)
- **BizTalk Migrate: Open Migration Dashboard** — visual gap analysis and component mapping
- **BizTalk Migrate: Browse Template Library** — 50+ pre-built patterns (Premium)

Set your license key in VS Code settings: `biztalkMigrate.licenseKey`

### 3. Claude Desktop (interactive guided migration)

Connect the MCP server to Claude Desktop for an interactive, step-by-step guided migration. Claude walks through each artifact with you, shows you the migration plan before generating code, and explains every decision.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "biztalk-migration": {
      "command": "node",
      "args": ["/absolute/path/to/BiztalktoLogicapps/dist/mcp-server/server.js"],
      "env": {
        "BTLA_LICENSE_KEY": "your-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. Then start a migration by asking: *"Migrate my BizTalk application"* and Claude guides you through each step.

---

## Understanding the Output

### migration-report.md

This is the file to share with your customer first. It contains:

- **Complexity score** — Simple / Moderate / Complex / Highly Complex
- **Gap analysis** — what BizTalk features have no direct Azure equivalent, how much manual work each gap requires, and what the mitigation is
- **Architecture recommendation** — which Azure services you need (Logic Apps, Service Bus, Integration Account, API Management, etc.)
- **Component mapping** — every orchestration shape, adapter, and map matched to its Logic Apps equivalent
- **Effort estimate** — person-days broken down by component

Review the report before deploying. The gaps section tells you exactly what needs human attention.

### Quality grades

The tool scores every generated workflow 0–100 before writing it to disk:

| Grade | Score | Meaning |
|---|---|---|
| A | ≥90 | Deployment-ready |
| B | 75–89 | Ready to deploy; minor improvements noted |
| C | 60–74 | Deployable but review before production |
| D | 40–59 | Issues to address |
| F | <40 | Structural problems — check the error log |

Target **grade B or higher** before handing off to a customer.

### local.settings.json

This file contains placeholder references for every connection string and secret the workflow needs. Before deploying:

- **`KVS_` prefix** → store the real value in Azure Key Vault; set the App Setting to a Key Vault reference
- **`Common_` prefix** → non-sensitive values (hostnames, ports) that you set directly

```json
{
  "Values": {
    "KVS_Storage_Blob_ConnectionString": "← store this in Key Vault",
    "Common_API_Sftp_Host": "sftp.yourcompany.com"
  }
}
```

---

## Deploying to Azure

### VS Code Logic Apps Extension (recommended for development)

1. Install the **Azure Logic Apps (Standard)** extension in VS Code
2. Open the generated output folder
3. Right-click the Logic App resource → **Deploy to Logic App**
4. Fill in App Settings from `local.settings.json`

### Azure CLI (recommended for production)

```bash
az deployment group create \
  --resource-group rg-integration-prod \
  --template-file output/infra/main.bicep \
  --parameters @output/infra/parameters.json

az logicapp deployment source config-zip \
  --resource-group rg-integration-prod \
  --name LAStd-YourApp-Prod \
  --src ./logic-apps-package.zip
```

### GitHub Actions

The repo includes `.github/workflows/biztalk-migrate.yml`. Add `BTLA_LICENSE_KEY` to your repo's GitHub secrets, then trigger the workflow from the Actions tab. It produces a downloadable Logic Apps package and renders the migration report directly in the Actions job summary.

---

## Common Issues

**"License validation failed"**
Check that `BTLA_LICENSE_KEY` is set. Free tier only covers Stage 1 + Stage 2 — Stage 3 (generate workflow.json) requires Standard or higher.

**Workflow deploys but triggers don't fire**
The connection name in `workflow.json` must exactly match the key in `connections.json` (case-sensitive). Check the `connectionName` field inside `serviceProviderConfiguration`.

**"TODO_CLAUDE" appears in workflow.json**
The AI couldn't automatically translate a value (usually a complex condition expression). Ask Claude to fill it in, or check the expression against the XLANG/s translation guide in `README-internal.md`.

**XSLT fails with "msxsl:script not supported"**
BizTalk scripting functoids use `<msxsl:script>` C# blocks that aren't supported in Azure Logic Apps XSLT. The migration report flags these as requiring manual rewrite or an Azure Function.

**Loop conditions seem inverted**
This is correct. BizTalk `LoopShape` runs *while* a condition is true; Logic Apps `Until` action runs *until* a condition is true. The generated code inverts the expression automatically — review loop conditions before deploying.

---

## What BizTalk Features Migrate Automatically

**Direct mappings (no manual work):**
- FILE, FTP, SFTP, HTTP, SOAP, Service Bus, SQL, SMTP, Event Hubs, Azure Blob, IBM MQ, SAP, EDI/X12/EDIFACT/AS2 adapters
- Receive → trigger, Send → action, Transform → XSLT, Decide → If/Switch, Delay, Terminate, Call Orchestration, Sequential Convoy → Service Bus sessions

**Partial mappings (review required):**
- While loops (condition inverted), Scope/error handling, parallel actions, Listen shapes, Suspend shapes

**Gaps requiring redesign:**
- WCF-NetNamedPipe (no Azure equivalent — architectural redesign required)
- MSDTC atomic transactions (replaced by Saga/compensation pattern)
- WCF-NetTcp (requires Azure Relay or Azure Functions wrapper)

The migration report identifies which category every component in your application falls into.

---

## For Consultants: Running Engagements

**Before the first meeting**, run Stage 1 + Stage 2 only (free):

```bash
node dist/cli/index.js analyze --app "AppName" --dir ./artifacts
```

This produces the complexity score and gap analysis in seconds — enough to size the engagement and identify blockers before writing a SOW.

**At the start of the engagement**, collect from the customer:
- Sample input messages (3–5 representative XML files)
- Golden master output files (from BizTalk message tracking)
- XSD schemas from the VS project
- Compiled XSLT maps

These become test fixtures that prove the migration is functionally correct.

**During the migration**, work orchestration by orchestration. Review the migration spec for each one before building — the spec is cheap to correct, the generated JSON is not.

**Quality target**: Grade B (≥75/100) before customer handoff.

---

## Support

Questions, issues, or consultant seat pricing: **[Me@Jonlevesque.com](mailto:Me@Jonlevesque.com)**

Technical reference (architecture, MCP tools, WDL rules, adapter mappings): [README-internal.md](README-internal.md)
