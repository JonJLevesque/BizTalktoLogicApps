/**
 * Claude Client — Dual-mode AI enrichment for the migration runner.
 *
 * Proxy mode (default):
 *   POSTs to a proxy endpoint authenticated with BTLA_LICENSE_KEY.
 *   System prompt (CLAUDE.md domain knowledge) lives on the server.
 *   Raw BizTalk XML never leaves the machine — only structural metadata is sent.
 *
 * Direct mode (when ANTHROPIC_API_KEY is set):
 *   Calls the Anthropic API directly using @anthropic-ai/sdk.
 *   Used for development and self-hosted deployments.
 *
 * Dev mode (BTLA_DEV_MODE=true):
 *   Skips enrichment entirely. Returns the partial intent unchanged.
 *   Used for offline testing without any API key.
 */

import type {
  EnrichmentRequest,
  EnrichmentResponse,
  ReviewRequest,
  ReviewResponse,
} from './types.js';
import type { IntegrationIntent } from '../shared/integration-intent.js';

const DEFAULT_PROXY_URL = 'https://api.biztalkmigrate.com/v1';

// ─── Client ───────────────────────────────────────────────────────────────────

export class ClaudeClient {
  private readonly mode: 'proxy' | 'direct' | 'dev';
  private readonly proxyUrl: string;
  private readonly licenseKey: string | undefined;
  private readonly apiKey: string | undefined;

  constructor() {
    if (process.env['BTLA_DEV_MODE'] === 'true') {
      this.mode = 'dev';
    } else if (process.env['ANTHROPIC_API_KEY']) {
      this.mode = 'direct';
      this.apiKey = process.env['ANTHROPIC_API_KEY'];
    } else {
      this.mode = 'proxy';
      this.licenseKey = process.env['BTLA_LICENSE_KEY'];
    }
    this.proxyUrl = process.env['BTLA_PROXY_URL'] ?? DEFAULT_PROXY_URL;
  }

  get clientMode(): 'proxy' | 'direct' | 'dev' {
    return this.mode;
  }

  /**
   * Enrich a partial IntegrationIntent by resolving all TODO_CLAUDE markers.
   * Returns the unchanged partial intent in dev mode or when enrichment fails.
   */
  async enrich(request: EnrichmentRequest): Promise<EnrichmentResponse> {
    if (this.mode === 'dev') {
      return { enrichedIntent: request.partialIntent, notes: 'Dev mode: enrichment skipped' };
    }

    const prompt = buildEnrichmentPrompt(request);
    try {
      const text =
        this.mode === 'direct'
          ? await this.callDirect(prompt, ENRICHMENT_SYSTEM_PROMPT)
          : await this.callProxy('/enrich', {
              prompt,
              appName: request.appName,
              patterns: request.patterns,
              gapSummary: request.gapSummary,
            });

      const enriched = parseEnrichedIntent(text, request.partialIntent);
      return { enrichedIntent: enriched, notes: 'Enrichment completed' };
    } catch (err) {
      // Non-fatal: fall back to partial intent
      return {
        enrichedIntent: request.partialIntent,
        notes: `Enrichment failed: ${err instanceof Error ? err.message : String(err)}. Using partial intent.`,
      };
    }
  }

  /**
   * Review and fix a workflow.json that has validation errors or low quality grade.
   */
  async review(request: ReviewRequest): Promise<ReviewResponse> {
    if (this.mode === 'dev') {
      return { fixedWorkflowJson: request.workflowJson, changesApplied: [] };
    }

    const prompt = buildReviewPrompt(request);
    try {
      const text =
        this.mode === 'direct'
          ? await this.callDirect(prompt, REVIEW_SYSTEM_PROMPT)
          : await this.callProxy('/review', {
              prompt,
              currentScore: request.currentScore,
              currentGrade: request.currentGrade,
            });

      const fixed = parseFixedWorkflow(text, request.workflowJson);
      return { fixedWorkflowJson: fixed.json, changesApplied: fixed.changes };
    } catch {
      return { fixedWorkflowJson: request.workflowJson, changesApplied: [] };
    }
  }

  // ─── Direct API call (Anthropic SDK) ────────────────────────────────────────

  private async callDirect(userPrompt: string, systemPrompt: string): Promise<string> {
    // Dynamic import so @anthropic-ai/sdk is only loaded when in direct mode.
    // The import path is a string variable to prevent TypeScript from resolving
    // the type at compile time (since the package is optional).
    const sdkPath = '@anthropic-ai/sdk';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkModule = await import(sdkPath) as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const Anthropic = (sdkModule.default ?? sdkModule.Anthropic) as new (opts: { apiKey?: string }) => {
      messages: {
        create(params: {
          model: string; max_tokens: number; system: string;
          messages: Array<{ role: string; content: string }>;
        }): Promise<{ content: Array<{ type: string; text: string }> }>;
      };
    };
    const client = new Anthropic(this.apiKey ? { apiKey: this.apiKey } : {});

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const block = message.content[0] as { type: string; text: string };
    if (block.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic API');
    }
    return block.text;
  }

  // ─── Proxy API call ──────────────────────────────────────────────────────────

  private async callProxy(path: string, body: Record<string, unknown>): Promise<string> {
    if (!this.licenseKey) {
      throw new Error(
        'No license key configured. Set BTLA_LICENSE_KEY env var or pass --license.'
      );
    }

    const response = await fetch(`${this.proxyUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.licenseKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Proxy API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as { result?: string; text?: string };
    return data.result ?? data.text ?? JSON.stringify(data);
  }
}

// ─── System Prompts ───────────────────────────────────────────────────────────

const ENRICHMENT_SYSTEM_PROMPT = `You are a BizTalk to Logic Apps migration expert.
Your task is to enrich a partial IntegrationIntent by replacing all TODO_CLAUDE markers with correct Logic Apps WDL values following the migration domain rules.

Key rules:
- runAfter status values must be ALL CAPS: "SUCCEEDED", "FAILED", "TIMEDOUT", "SKIPPED"
- Always target Logic Apps Standard (Stateful)
- ServiceProvider connectors preferred over managed
- Never hardcode connection strings — use @appsetting('KVS_...') references
- Translate XLANG/s expressions to WDL format per the mapping tables
- Loop (While) conditions must be INVERTED for Until action

Return ONLY a valid JSON object containing the enriched IntegrationIntent.
Do not include any explanation outside the JSON object.`;

const REVIEW_SYSTEM_PROMPT = `You are a BizTalk to Logic Apps migration expert.
Your task is to fix a Logic Apps workflow.json that has validation errors or quality issues.

Apply these critical WDL rules:
- runAfter values must be ALL CAPS: ["SUCCEEDED"], ["FAILED"], ["TIMEDOUT"], ["SKIPPED"]
- Stateful workflow: "kind": "Stateful"
- Schema URL must be present in definition.$schema
- ServiceProvider connector structure: inputs.serviceProviderConfiguration with connectionName, operationId, serviceProviderId
- If action expression must be JSON predicate object, NOT a string
- First action runAfter must be {} (empty), not missing
- Never hardcode connection strings

Return a JSON object with:
- "workflow": the fixed workflow JSON object
- "changes": array of strings describing each change made`;

// ─── Prompt Builders ──────────────────────────────────────────────────────────

function buildEnrichmentPrompt(request: EnrichmentRequest): string {
  return `Enrich this partial IntegrationIntent for the BizTalk application "${request.appName}".

Detected patterns: ${request.patterns.join(', ') || 'none'}
${request.gapSummary ? `Gap summary: ${request.gapSummary}` : ''}

Replace all TODO_CLAUDE markers with correct values:
- Expression markers: translate XLANG/s to WDL format
- Map name markers: derive from shape.mapClass or BTM file names
- Connector config: use address from binding + adapter-to-connector mapping
- Duration markers: convert TimeSpan to ISO 8601 (e.g., PT30S, PT1H)
- Workflow name markers: derive from called orchestration name

Partial IntegrationIntent:
${JSON.stringify(request.partialIntent, null, 2)}

Return only the enriched IntegrationIntent as a JSON object.`;
}

function buildReviewPrompt(request: ReviewRequest): string {
  const errorIssues = request.validationIssues.issues.filter((i) => i.severity === 'error');
  const issueList =
    errorIssues.length > 0
      ? errorIssues.map((i) => `- [${i.rule}] ${i.message}${i.path ? ` at ${i.path}` : ''}`).join('\n')
      : 'No errors — improve quality score';

  return `Fix this Logic Apps workflow.json.
Current quality: ${request.currentScore}/100 (Grade ${request.currentGrade}).

Validation errors to fix:
${issueList}

Workflow:
${request.workflowJson}

Return JSON: { "workflow": <fixed workflow object>, "changes": ["change 1", "change 2", ...] }`;
}

// ─── Response Parsers ────────────────────────────────────────────────────────

function parseEnrichedIntent(text: string, fallback: IntegrationIntent): IntegrationIntent {
  const jsonMatch =
    text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1]!.trim() : text.trim();

  try {
    const parsed = JSON.parse(jsonStr) as IntegrationIntent;
    if (parsed.trigger && Array.isArray(parsed.steps)) {
      return parsed;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function parseFixedWorkflow(
  text: string,
  fallback: string
): { json: string; changes: string[] } {
  const jsonMatch =
    text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1]!.trim() : text.trim();

  try {
    const parsed = JSON.parse(jsonStr) as { workflow?: unknown; changes?: string[] };
    if (parsed.workflow) {
      return {
        json: JSON.stringify(parsed.workflow, null, 2),
        changes: parsed.changes ?? [],
      };
    }
    return { json: fallback, changes: [] };
  } catch {
    return { json: fallback, changes: [] };
  }
}
