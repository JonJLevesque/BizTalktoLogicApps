# BizTalk Migrate

**Automatically migrate Microsoft BizTalk Server applications to Azure Logic Apps.**

Point it at a folder of BizTalk files. Get back a ready-to-deploy Azure project, a gap analysis, and a migration report — in minutes.

> **Why this exists**: Microsoft BizTalk Server reaches end of extended support in **October 2028**. Every organization running BizTalk must migrate before then. This tool makes that fast, systematic, and correct.

🌐 **[biztalkmigrate.com](https://biztalkmigrate.com)** — get a free 3-day trial key, no credit card required

---

## What You Need Before Starting

Three things:

1. **Node.js 20 or later** — download free from [nodejs.org](https://nodejs.org). Click the big "LTS" button and install it like any other program.

2. **Your BizTalk application's export files** — see the section below on how to get these

3. **A license key** — get one free at [biztalkmigrate.com](https://biztalkmigrate.com)

---

## Step 1 — Export Your BizTalk Files

You need to pull your application's files out of BizTalk first. Here's how:

**In BizTalk Administration Console:**

1. Expand **Applications** in the left panel
2. Right-click the application you want to migrate
3. Click **Export → MSI file** — save it somewhere and extract it. This gives you `.odx`, `.btm`, and `.btp` files.
4. Right-click the same application again
5. Click **Export → Bindings** → save the file as **`BindingInfo.xml`**

Now put all of those files into a single folder on your computer. Example:

```
C:\Users\YourName\Documents\my-biztalk-export\
    OrderProcessing.odx
    OrderMap.btm
    ReceivePipeline.btp
    BindingInfo.xml
```

That folder is your **input folder**. You'll need its path in the next step.

---

## Step 2 — Install the Tool

Open a terminal (Command Prompt, PowerShell, or Terminal on Mac) and run:

```bash
npm install -g biztalk-migrate
```

This installs the `biztalk-migrate` command globally on your computer. You only need to do this once.

**Verify it installed correctly:**

```bash
biztalk-migrate --version
```

You should see a version number printed. If you get "command not found", close and reopen your terminal and try again.

---

## Step 3 — Set Your License Key

You need to tell the tool your license key. The easiest way is to set it as an environment variable so you don't have to type it every time.

**On Mac or Linux** — add this line to your `~/.zshrc` or `~/.bashrc` file, then restart your terminal:

```bash
export BTLA_LICENSE_KEY="BTLA-XXXX-XXXX-XXXX"
```

**On Windows (PowerShell):**

```powershell
$env:BTLA_LICENSE_KEY="BTLA-XXXX-XXXX-XXXX"
```

> Replace `BTLA-XXXX-XXXX-XXXX` with your actual key from the email we sent you.

**Or** you can include the key directly in the run command (see next step).

---

## Step 4 — Run Your Migration

This is the command that does the actual migration. It has three parts you need to fill in yourself:

```
biztalk-migrate run --dir YOUR_FOLDER --app "YOUR_APP_NAME" --output YOUR_OUTPUT_FOLDER
```

### What to Replace

| What you see | What it means | Example |
|---|---|---|
| `YOUR_FOLDER` | The folder containing your BizTalk export files from Step 1 | `./my-biztalk-export` or `C:\Users\Jon\Documents\my-biztalk-export` |
| `"YOUR_APP_NAME"` | A name for this application — used in the report and output file names. Can be anything. | `"OrderProcessing"` or `"InvoiceSystem"` |
| `YOUR_OUTPUT_FOLDER` | Where you want the generated Logic Apps files to be saved. The tool creates this folder if it doesn't exist. | `./output` or `C:\Users\Jon\Documents\logic-apps-output` |

---

### Real Examples

**Example 1 — files on your Desktop (Mac):**

Your BizTalk export is in a folder called `biztalk-files` on your Desktop.

```bash
biztalk-migrate run \
  --dir ~/Desktop/biztalk-files \
  --app "OrderSystem" \
  --output ~/Desktop/logic-apps-output
```

**Example 2 — files in Documents (Windows):**

Your BizTalk export is in `C:\Users\Jon\Documents\BizTalk-Export`.

```powershell
biztalk-migrate run --dir "C:\Users\Jon\Documents\BizTalk-Export" --app "OrderSystem" --output "C:\Users\Jon\Documents\LogicApps-Output"
```

**Example 3 — current folder (the folder you have open in your terminal):**

```bash
biztalk-migrate run --dir ./artifacts --app "OrderSystem" --output ./output
```

> **Tip:** If your folder path has spaces in it (like `My Documents`), wrap the whole path in quotes: `--dir "C:\Users\Jon\My Documents\BizTalk Export"`

---

### Running from an MSI File

If you have a BizTalk MSI export (the `.msi` file from the BizTalk Administration Console), you can pass it directly without extracting it first:

```bash
biztalk-migrate run \
  --from-msi ./MyBizTalkApp.msi \
  --app "OrderSystem" \
  --output ./output
```

The tool extracts the artifacts from the MSI automatically.

---

### Including Your License Key in the Command

If you didn't set it as an environment variable, add `BTLA_LICENSE_KEY=your-key` to the front of the command:

**Mac / Linux:**

```bash
BTLA_LICENSE_KEY="BTLA-XXXX-XXXX-XXXX" biztalk-migrate run \
  --dir ~/Desktop/biztalk-files \
  --app "OrderSystem" \
  --output ~/Desktop/logic-apps-output
```

**Windows (PowerShell):**

```powershell
$env:BTLA_LICENSE_KEY="BTLA-XXXX-XXXX-XXXX"
biztalk-migrate run --dir "C:\Users\Jon\Documents\BizTalk-Export" --app "OrderSystem" --output "C:\Users\Jon\Documents\Output"
```

---

### What You'll See While It Runs

The tool prints progress as it works:

```
[PARSE   ] Scanning artifacts in ./biztalk-files...
[PARSE   ] Found 4 artifacts — 2 orchestrations, 1 map, 1 binding
[REASON  ] Enriching migration intent...
[SCAFFOLD] Generating Logic Apps package...
[VALIDATE] Quality: 100/100  Grade A
✔ Migration complete — output written to ./logic-apps-output
```

The whole thing typically takes **1–2 minutes**.

---

## Step 5 — Look at What Was Generated

Open your output folder. You'll find:

```
logic-apps-output/
├── OrderSystem.code-workspace     ← Open this in VS Code to get the full project view
├── OrderProcessingOrch/
│   └── workflow.json              ← Orchestration converted to Logic Apps (one folder per orchestration)
├── OrderFulfillmentOrch/
│   └── workflow.json              ← Second orchestration, if your app has multiple
├── Artifacts/
│   ├── Maps/                      ← Converted XSLT/LML maps
│   └── Schemas/                   ← Original XSD schemas, copied for reference
├── connections.json               ← Azure service connections your workflows need
├── host.json                      ← Logic Apps runtime settings
├── local.settings.json            ← Template for your connection strings (fill these in)
├── arm-template.json              ← Azure ARM deployment template
├── arm-parameters.json            ← ARM parameters file
├── tests/
│   ├── OrderProcessingOrch.tests.json   ← Workflow test specifications
│   └── OrderProcessingOrchTests.cs      ← MSTest scaffold (optional)
├── .vscode/
│   └── settings.json              ← VS Code settings for Logic Apps extension
├── migration-report.md            ← Open this first — explains what migrated and what didn't
└── migration-report.html          ← Same report, formatted for browser / print-to-PDF
```

> **If your BizTalk application has multiple orchestrations**, each one gets its own folder and `workflow.json`. They share `connections.json`, `host.json`, and the `Artifacts/` folder.

**Start by opening `migration-report.md`.** It's a plain text file that tells you:

- ✅ What migrated automatically (no manual work needed)
- ⚠️ What migrated with caveats (needs review before deploying)
- ❌ What couldn't be migrated automatically (needs manual work — the report explains what to do)

---

## Understanding the Quality Grade

The tool scores the generated workflow 0–100 and gives it a letter grade:

| Grade | Score | What it means |
|---|---|---|
| **A** | ≥ 90 | Deployment-ready. Very little to review. |
| **B** | 75–89 | Ready to deploy. Minor notes in the report. |
| **C** | 60–74 | Deployable but review the report before going to production. |
| **D** | 40–59 | Issues to address. Read the report carefully. |
| **F** | < 40 | Structural problems. Check the error section in the report. |

Most applications score **Grade A** automatically. If you get lower, the migration report's **Actionable Fix List** tells you exactly what to change and how.

---

## Common Problems and Fixes

**"command not found: biztalk-migrate"**

The npm global install didn't add itself to your PATH. Try:

```bash
# Mac / Linux
export PATH="$PATH:$(npm config get prefix)/bin"
# To make it permanent, add that line to your ~/.zshrc or ~/.bashrc

# Windows — close and reopen PowerShell as Administrator, then:
npm install -g biztalk-migrate
```

---

**"License validation failed"**

- Check that `BTLA_LICENSE_KEY` is set to your actual key (not the placeholder `BTLA-XXXX-XXXX-XXXX`)
- The Free tier only runs analysis (Stages 1 and 2). Generating `workflow.json` requires a Standard key. Get one at [biztalkmigrate.com](https://biztalkmigrate.com).

---

**"No artifacts found"**

The tool didn't find any `.odx`, `.btm`, `.btp`, or `BindingInfo.xml` files in the folder you gave it. Double-check the `--dir` path is pointing to the right place.

Quick check — list the files in your folder:

```bash
# Mac / Linux
ls ~/Desktop/biztalk-files

# Windows
dir "C:\Users\Jon\Documents\BizTalk-Export"
```

You should see your `.odx`, `.btm`, etc. files listed.

---

**"TODO_CLAUDE appears in workflow.json"**

This is rare — it means the AI couldn't automatically translate a specific expression (usually a complex inline C# condition). You'll need to fill it in manually. The migration report's **Actionable Fix List** will tell you exactly where it is and what kind of expression is needed.

---

**"msxsl:script not supported"**

One of your BizTalk maps uses C# scripting inside the XSLT — Azure Logic Apps doesn't support that. The tool generates a **Local Code Function stub** (`.cs` file) as a starting point. The migration report flags exactly which maps are affected and what the stub does.

---

**Loop conditions look backwards**

This is correct and expected. BizTalk runs a loop *while* a condition is true. Logic Apps runs a loop *until* a condition is true. The tool automatically inverts the condition — review loop logic before deploying to confirm the inversion is correct for your use case.

---

## What BizTalk Features Migrate Automatically

**No manual work needed:**
FILE, FTP, SFTP, HTTP, SOAP, Service Bus, SQL, SMTP, Event Hubs, Azure Blob, IBM MQ, SAP, EDI/X12/EDIFACT/AS2 adapters, Receive shapes, Send shapes, Transform/XSLT maps, Decide → If/Switch, While loops (condition auto-inverted), Delay, Terminate, Call Orchestration, Sequential Convoy, Parallel Actions, Local Code Functions (C# expression stubs generated)

**Needs review (migrates but check the report):**
Scope/error handling, Listen shapes, Correlated receives, Suspend with retry

**Requires redesign (tool flags and explains in the report):**
WCF-NetNamedPipe, MSDTC atomic transactions, WCF-NetTcp, MessageBox publish-subscribe, Compensation patterns

The migration report categorizes every component in your application. You'll know before deploying.

---

## License Tiers

| | Free | Standard | Premium |
|---|:---:|:---:|:---:|
| Analyze BizTalk artifacts | ✅ | ✅ | ✅ |
| Gap analysis + architecture recommendation | ✅ | ✅ | ✅ |
| Generate Logic Apps workflow.json, connections, infra | — | ✅ | ✅ |
| Full deployable Logic Apps package | — | ✅ | ✅ |
| Greenfield NLP (design new workflows from plain English) | — | — | ✅ |
| 50+ pre-built workflow templates | — | — | ✅ |

Get your key at [biztalkmigrate.com](https://biztalkmigrate.com).

---

## Other Ways to Use It

### VS Code Extension

Open your BizTalk export folder in VS Code. The extension activates automatically when you open any `.odx`, `.btm`, or `.btp` file.

Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows) to open the Command Palette, then type:

- **BizTalk Migrate: Run Migration** — same pipeline as the CLI, with a folder picker and live progress
- **BizTalk Migrate: Analyze Directory** — analysis only (free)
- **BizTalk Migrate: Open Migration Dashboard** — visual gap analysis

Set your key in VS Code settings under `biztalkMigrate.licenseKey`.

### GitHub Actions

The repo includes `.github/workflows/biztalk-migrate.yml`. Add `BTLA_LICENSE_KEY` to your repo's GitHub secrets, trigger it from the Actions tab, and it uploads the Logic Apps package as a downloadable artifact.

### Claude Desktop (interactive guided migration)

Connect the MCP server to Claude Desktop for a step-by-step guided migration where Claude walks through each artifact, shows the migration plan, and explains every decision.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "biztalk-migration": {
      "command": "npx",
      "args": ["-y", "biztalk-migrate", "mcp"],
      "env": {
        "BTLA_LICENSE_KEY": "BTLA-XXXX-XXXX-XXXX"
      }
    }
  }
}
```

> **Note:** The `mcp` subcommand starts the stdio MCP server. It requires a valid license key.

Restart Claude Desktop. Then say: *"Migrate my BizTalk application"* and Claude will guide you through it.

---

## For Consultants

**Before the first client meeting** (runs on the Free tier, takes seconds):

```bash
biztalk-migrate run \
  --dir ./client-export \
  --app "ClientOrderSystem" \
  --output ./pre-engagement-report
```

Open `migration-report.md`. You'll have the complexity score, gap count, and estimated effort before you've billed a single hour — enough to write a SOW.

**Quality target for customer handoff**: Grade A (≥90/100). Most applications reach this automatically. The migration report's Actionable Fix List closes the remaining gap.

---

### Estate Assessment (Multiple Applications)

When a client has dozens of BizTalk applications, run the estate command across the entire export folder to get a portfolio-level view — complexity distribution, wave planning, and connector inventory — in one report:

```bash
biztalk-migrate estate \
  --dir ./client-biztalk-exports \
  --output ./estate-report.md
```

This generates `estate-report.md` (and `estate-report.html`) with:
- Application inventory with complexity scores and wave assignments
- Connector/adapter summary across all apps
- Effort estimates by wave
- Common gaps and risks across the estate

No license key required for estate assessment.

---

## Support

Questions, bugs, or consultant seat pricing:

📧 **[Me@Jonlevesque.com](mailto:Me@Jonlevesque.com)**
🌐 **[biztalkmigrate.com](https://biztalkmigrate.com)**
