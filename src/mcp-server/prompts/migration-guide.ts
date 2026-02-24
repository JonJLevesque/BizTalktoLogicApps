/**
 * MCP Prompt Templates — Guided Migration Conversations
 *
 * These prompts are registered with the MCP server and provide structured
 * starting points for common migration workflows. When Claude invokes a prompt,
 * it receives a full conversation starter with role + content.
 *
 * Prompts:
 *   guided_migration      — Full Mode A pipeline: Understand → Document → Build
 *   guided_greenfield     — Full Mode B pipeline: NLP → Design → Build (Premium)
 *   quick_workflow_build  — Skip analysis, go straight to Build from NLP description
 *   gap_assessment        — Focus only on gap analysis and migration planning
 *   map_conversion        — Focus on converting a single BizTalk map
 */

import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

// ─── Prompt Definitions ───────────────────────────────────────────────────────

export interface PromptDefinition {
  name:        string;
  description: string;
  arguments?:  Array<{
    name:        string;
    description: string;
    required:    boolean;
  }>;
}

export const PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    name:        'guided_migration',
    description:
      'Step-by-step guided migration of a BizTalk application to Azure Logic Apps Standard. ' +
      'Walks through: analyze artifacts → generate migration spec → build Logic Apps package.',
    arguments: [
      { name: 'applicationName', description: 'Name of the BizTalk application', required: true },
      { name: 'artifactCount',   description: 'Number of .odx/.btm/.btp files to analyze', required: false },
    ],
  },
  {
    name:        'guided_greenfield',
    description:
      '[Premium] Guided NLP-driven Logic Apps workflow builder. ' +
      'Walks through: describe integration → design review → generate package.',
    arguments: [
      { name: 'description', description: 'Initial description of the integration requirement', required: false },
    ],
  },
  {
    name:        'quick_workflow_build',
    description:
      '[Premium] Quickly generate a Logic Apps workflow from a plain English description. ' +
      'Skips the full design review for simple, clear requirements.',
    arguments: [
      { name: 'description', description: 'Complete integration description', required: true },
    ],
  },
  {
    name:        'gap_assessment',
    description:
      'Analyze BizTalk artifacts to identify migration gaps, risks, and effort estimates. ' +
      'Focus mode: does not generate Logic Apps code, produces a structured assessment document.',
    arguments: [
      { name: 'applicationName', description: 'BizTalk application name', required: true },
    ],
  },
  {
    name:        'map_conversion',
    description:
      'Convert a single BizTalk .btm map to Logic Apps format (LML/XSLT/Azure Function stub). ' +
      'Use this when you only need to migrate transformation logic.',
    arguments: [],
  },
];

// ─── Prompt Message Builders ──────────────────────────────────────────────────

export function buildPromptMessages(
  promptName: string,
  args: Record<string, string>
): GetPromptResult {
  switch (promptName) {
    case 'guided_migration':
      return guidedMigrationPrompt(args['applicationName'] ?? 'BizTalk Application', args['artifactCount']);
    case 'guided_greenfield':
      return guidedGreenfieldPrompt(args['description']);
    case 'quick_workflow_build':
      return quickWorkflowBuildPrompt(args['description'] ?? '');
    case 'gap_assessment':
      return gapAssessmentPrompt(args['applicationName'] ?? 'BizTalk Application');
    case 'map_conversion':
      return mapConversionPrompt();
    default:
      return { messages: [] };
  }
}

// ─── Guided Migration ─────────────────────────────────────────────────────────

function guidedMigrationPrompt(
  appName: string,
  artifactCount?: string
): GetPromptResult {
  const artifactInfo = artifactCount
    ? ` The application has approximately ${artifactCount} artifact files.`
    : '';

  return {
    description: `Guided migration of "${appName}" to Azure Logic Apps Standard`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `I need to migrate the BizTalk application "${appName}" to Azure Logic Apps Standard.${artifactInfo}\n\n` +
            `Please guide me through the migration process:\n\n` +
            `**Step 1 — Analyze** (I will provide the XML content of each artifact)\n` +
            `Start by asking me to paste the content of each artifact file (.odx, .btm, .btp, binding XML).\n` +
            `Use the appropriate analyze_* tools to parse each one.\n\n` +
            `**Step 2 — Document** (After all artifacts are analyzed)\n` +
            `Use generate_gap_analysis and generate_architecture to produce a migration specification.\n` +
            `Show me the gap analysis and architecture recommendation before proceeding.\n\n` +
            `**Step 3 — Build** (After I approve the migration spec)\n` +
            `Use build_package to generate the complete Logic Apps Standard deployment package.\n` +
            `Show me each generated artifact (workflow.json, connections.json, ARM template).\n\n` +
            `Start by asking for the first artifact.`,
        },
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text:
            `I'll guide you through migrating **"${appName}"** to Azure Logic Apps Standard using the **5-Step Migration Protocol** for maximum accuracy.\n\n` +
            `## 5-Step Migration Protocol\n\n` +
            `I follow this exact sequence to achieve 90%+ accurate Logic Apps output:\n\n` +
            `### Step 1: PARSE (deterministic)\n` +
            `Using MCP tools to parse all BizTalk artifacts into structured data:\n` +
            `- If you have file paths: \`read_artifact\` for each file, or \`list_artifacts\` for a directory\n` +
            `- \`analyze_orchestration\` for each .odx file\n` +
            `- \`analyze_map\` for each .btm file\n` +
            `- \`analyze_bindings\` for BindingInfo.xml\n` +
            `- \`analyze_biztalk_application\` to combine all artifacts\n` +
            `- \`detect_patterns\` + \`assess_complexity\`\n\n` +
            `### Step 2: REASON (AI-driven — the critical step)\n` +
            `- Call \`construct_intent\` → get partial IntegrationIntent with TODO_CLAUDE markers\n` +
            `- I translate all XLANG/s expressions to WDL format\n` +
            `- I fill connector configurations from binding addresses\n` +
            `- I resolve all TODO_CLAUDE markers using migration reference tables\n` +
            `- Call \`validate_intent\` → must return valid: true before proceeding\n\n` +
            `### Step 3: SCAFFOLD (deterministic)\n` +
            `- \`generate_gap_analysis\` → I present gaps for your review\n` +
            `- \`generate_architecture\` → I present the Azure architecture recommendation\n` +
            `- On your approval: \`build_package\` → generates the complete Logic Apps package\n\n` +
            `### Step 4: REVIEW & ENRICH (AI-driven — quality assurance)\n` +
            `After build_package, I review the generated workflow.json and:\n` +
            `- Fix runAfter casing (must be SUCCEEDED/FAILED/TIMEDOUT — ALL CAPS)\n` +
            `- Add retry policies to HTTP actions\n` +
            `- Verify error Scope wraps all main actions\n` +
            `- Replace any remaining TODO placeholders\n` +
            `- Verify connection names match connections.json\n\n` +
            `### Step 5: VALIDATE (deterministic)\n` +
            `- \`validate_workflow\` → structural correctness check\n` +
            `- \`validate_connections\` → connection reference check\n` +
            `- \`score_migration_quality\` → quality grade (target: **B or higher, ≥75/100**)\n` +
            `- Fix any issues, then present final output with deployment instructions\n\n` +
            `---\n\n` +
            `## Conventions I Apply\n\n` +
            `**App settings** — Pascal_Snake_Case: \`[Type]_[Category]_[ServiceName]_[SettingName]\`\n` +
            `- \`KVS_\` prefix for ALL sensitive values → Key Vault: \`@appsetting('KVS_...')\`\n` +
            `- Examples: \`KVS_Storage_Blob_ConnectionString\`, \`Common_API_Sftp_Host\`\n\n` +
            `**Resources**: \`LAStd-{BU}-{Dept}-{Env}\` | Workflows: \`Process-{name}\`\n\n` +
            `---\n\n` +
            `**Let's begin with Step 1.** Please provide the first artifact for **"${appName}"**:\n\n` +
            `- If you have **file paths**: I can use \`read_artifact\` or \`list_artifacts\` directly\n` +
            `- If you want to **paste XML**: start with the .odx orchestration file\n` +
            `- If you have a **directory**: share the path and I'll scan it with \`list_artifacts\``,
        },
      },
    ],
  };
}

// ─── Guided Greenfield ────────────────────────────────────────────────────────

function guidedGreenfieldPrompt(initialDescription?: string): GetPromptResult {
  const hasDescription = !!initialDescription?.trim();

  const userMessage = hasDescription
    ? `I want to build a new Azure Logic Apps workflow. Here's what it should do:\n\n${initialDescription}\n\nPlease guide me through the design and implementation.`
    : `I want to build a new Azure Logic Apps Standard workflow. Please guide me through describing what I need and generating the workflow.`;

  const assistantMessage = hasDescription
    ? buildGreenfieldAssistantResponse(initialDescription!)
    : buildGreenfieldWelcomeMessage();

  return {
    description: 'Guided NLP-driven Logic Apps workflow builder',
    messages: [
      { role: 'user',      content: { type: 'text', text: userMessage } },
      { role: 'assistant', content: { type: 'text', text: assistantMessage } },
    ],
  };
}

function buildGreenfieldWelcomeMessage(): string {
  return (
    `I'll help you design and build an Azure Logic Apps Standard workflow from scratch.\n\n` +
    `## Let's Start with Your Requirements\n\n` +
    `Please describe what your workflow should do. The more detail you provide, the better the generated workflow will be. Consider including:\n\n` +
    `1. **Trigger**: What starts the workflow? (e.g., "a new file appears on SFTP", "HTTP POST request arrives", "every 5 minutes")\n` +
    `2. **Data flow**: What happens to the data? (e.g., "parse CSV", "transform to JSON format", "validate email addresses")\n` +
    `3. **Destinations**: Where does the output go? (e.g., "POST to REST API at api.example.com", "save to SQL table", "send to Service Bus")\n` +
    `4. **Error handling**: What happens on failure? (e.g., "retry 3 times", "dead-letter to queue", "send email alert to ops@company.com")\n` +
    `5. **External systems**: Any specific URLs, queue names, credentials, or authentication methods?\n\n` +
    `What would you like your workflow to do?`
  );
}

function buildGreenfieldAssistantResponse(description: string): string {
  return (
    `Thank you for the description. Let me analyze it and create a design proposal.\n\n` +
    `I'll use \`interpret_nlp\` to extract the integration intent from your description, ` +
    `then \`generate_design\` to produce an architecture specification for your review.\n\n` +
    `*Processing: "${description.substring(0, 80)}${description.length > 80 ? '...' : ''}"*`
  );
}

// ─── Quick Workflow Build ─────────────────────────────────────────────────────

function quickWorkflowBuildPrompt(description: string): GetPromptResult {
  return {
    description: 'Quick Logic Apps workflow generation from description',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Generate a Logic Apps Standard workflow for the following:\n\n${description}\n\n` +
            `Skip the detailed design review — generate the full deployment package directly.`,
        },
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text:
            `I'll generate the Logic Apps workflow package directly using \`create_workflow_from_description\` with \`skipDesignReview: true\`.\n\n` +
            `One moment while I process your description...`,
        },
      },
    ],
  };
}

// ─── Gap Assessment ───────────────────────────────────────────────────────────

function gapAssessmentPrompt(appName: string): GetPromptResult {
  return {
    description: `Gap assessment for migrating "${appName}"`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `I need a migration gap assessment for the BizTalk application "${appName}".\n\n` +
            `Please analyze the artifacts I provide and produce:\n` +
            `1. A complete gap analysis (what has no Logic Apps equivalent)\n` +
            `2. Risk assessment (what might break or need manual work)\n` +
            `3. Effort estimate per component\n` +
            `4. Architecture recommendation for the target Azure environment\n\n` +
            `I'll start by providing the artifact XML files. Please begin by asking for the first one.`,
        },
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text:
            `I'll perform a thorough migration gap assessment for **"${appName}"**.\n\n` +
            `## Gap Assessment Process\n\n` +
            `I'll analyze your artifacts using the Stage 1 tools, then apply gap analysis and ` +
            `risk assessment using the Stage 2 tools to produce a comprehensive report.\n\n` +
            `**To begin, please paste the XML content of the first BizTalk artifact:**\n\n` +
            `- Orchestration (.odx) — describes the business process flow\n` +
            `- Map (.btm) — describes data transformations\n` +
            `- Binding XML — describes adapter/connector configurations\n` +
            `- Pipeline (.btp) — describes message processing\n\n` +
            `Start with whichever artifact type you have available.`,
        },
      },
    ],
  };
}

// ─── Map Conversion ───────────────────────────────────────────────────────────

function mapConversionPrompt(): GetPromptResult {
  return {
    description: 'BizTalk .btm map conversion to Logic Apps format',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `I have a BizTalk map (.btm file) that I need to convert to Logic Apps format.\n\n` +
            `Please analyze it and tell me:\n` +
            `1. What transformation approach is recommended (LML for Data Mapper, XSLT, or Azure Function stub)\n` +
            `2. The converted file content\n` +
            `3. Any warnings or manual steps required\n\n` +
            `I'll paste the .btm XML content in my next message.`,
        },
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text:
            `I'll analyze your BizTalk map and convert it to the best Logic Apps format.\n\n` +
            `**Conversion strategy:**\n` +
            `- **LML (YAML)**: Used for simple direct-link maps without functoids — works with Data Mapper\n` +
            `- **XSLT**: Used for functoid-based maps that can be translated to standard XSL transforms\n` +
            `- **Azure Function stub**: Used for scripting functoids (C# inline code) that cannot be automatically translated\n\n` +
            `**Please paste the .btm file XML content now.**`,
        },
      },
    ],
  };
}
