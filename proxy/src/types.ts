/**
 * Shared types for the btla-proxy Cloudflare Worker.
 */

// ── Cloudflare bindings ──────────────────────────────────────────────────────

/** KV namespaces, secrets, and vars injected by the Cloudflare runtime. */
export interface Bindings {
  // KV namespaces
  LICENSE_KEYS: KVNamespace;
  RATE_LIMITS:  KVNamespace;

  // KV namespace for large prompt content (secrets have a 5.1 KB limit)
  PROMPTS: KVNamespace; // stores key "domain" → domain knowledge prompt (~18 KB)

  // Secrets — small prompt components + API key (set via wrangler secret put)
  ANTHROPIC_API_KEY:    string;
  SYSTEM_PROMPT_ROLE:   string; // Layer 1: role + critical rules  (~1.3 KB, cached)
  SYSTEM_PROMPT_ENRICH: string; // Layer 3: enrich task instructions (~1 KB)
  SYSTEM_PROMPT_REVIEW: string; // Layer 3: review task instructions (~1 KB)
  // Layer 2 (domain, ~18 KB) lives in PROMPTS KV under key "domain"
  RESEND_API_KEY: string;       // Resend transactional email API key

  // Vars (set in wrangler.toml)
  ANTHROPIC_MODEL:    string;
  MONTHLY_CALL_LIMIT: string; // hard kill when total monthly calls hit this number
}

// ── License ──────────────────────────────────────────────────────────────────

/** Record stored in LICENSE_KEYS KV as JSON under key `license:<key>`. */
export interface LicenseRecord {
  active:    boolean;
  tier:      'free' | 'standard' | 'premium';
  email:     string;
  expiresAt: string; // ISO 8601 date string
}

/** Validated license info attached to the request context by auth middleware. */
export interface LicenseInfo {
  key:   string;
  tier:  'standard' | 'premium';
  email: string;
}

// ── Rate limiting ────────────────────────────────────────────────────────────

/** Rate limit state attached to the request context. */
export interface RateLimitInfo {
  limit:     number;
  remaining: number;
  reset:     number; // Unix timestamp of next hour boundary
}

// ── Hono app env ─────────────────────────────────────────────────────────────

/** Full Hono environment type used by the app and all middlewares. */
export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    license:   LicenseInfo;
    rateLimit: RateLimitInfo;
  };
};

// ── Request / response shapes ────────────────────────────────────────────────

export interface EnrichRequest {
  prompt:      string;
  appName?:    string;
  patterns?:   string[];
  gapSummary?: string;
}

export interface ReviewRequest {
  prompt:        string;
  currentScore?: number;
  currentGrade?: string;
}

export interface ProxyResponse {
  result: string;
}

export interface ErrorResponse {
  error: string;
  code?: string;
}

export interface HealthResponse {
  status:    'healthy';
  version:   string;
  timestamp: string;
}

// ── Anthropic API (subset) ───────────────────────────────────────────────────

/**
 * A single block in a layered system prompt.
 * Setting cache_control marks this block (and all prior blocks) as cacheable.
 * Use on the ROLE and DOMAIN layers to get ~90% cost reduction on repeated calls.
 */
export interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface AnthropicRequest {
  model:      string;
  max_tokens: number;
  system:     AnthropicSystemBlock[];
  messages:   Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AnthropicContentBlock {
  type:  string;
  text?: string;
}

export interface AnthropicResponse {
  id:          string;
  type:        string;
  role:        string;
  content:     AnthropicContentBlock[];
  model:       string;
  stop_reason: string;
  usage:       { input_tokens: number; output_tokens: number };
}
