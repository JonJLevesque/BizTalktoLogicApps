/**
 * btla-proxy — BizTalk to Logic Apps migration proxy
 *
 * Cloudflare Worker entry point (Hono).
 *
 * Routes:
 *   GET  /v1/health   — Health check (no auth)
 *   POST /v1/enrich   — AI enrichment of migration intent (Standard/Premium)
 *   POST /v1/review   — AI quality review of generated workflow (Standard/Premium)
 *
 * Layered system prompts:
 *   Layer 1 ROLE    — role + critical rules      secret SYSTEM_PROMPT_ROLE  (~1.3 KB, cached)
 *   Layer 2 DOMAIN  — all reference tables       KV key "domain"            (~18 KB, cached)
 *   Layer 3 TASK    — enrich or review           secret SYSTEM_PROMPT_*     (~1 KB)
 *
 * Domain prompt lives in KV (Cloudflare secrets cap at 5.1 KB).
 * Both stable layers are marked for prompt caching → ~90% cost reduction on repeat calls.
 */

import { Hono }                              from 'hono';
import type { AppEnv, AnthropicSystemBlock } from './types.js';
import { authMiddleware }                    from './auth.js';
import { rateLimitMiddleware }               from './rate-limit.js';
import { callAnthropic, AnthropicError }     from './anthropic.js';
import { getDomainPrompt }                   from './prompt-loader.js';

const VERSION = '1.0.0';

const app = new Hono<AppEnv>();

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/v1/health', (c) => {
  return c.json({
    status:    'healthy' as const,
    version:   VERSION,
    timestamp: new Date().toISOString(),
  });
});

// ── Enrich ────────────────────────────────────────────────────────────────────

app.post('/v1/enrich',
  authMiddleware,
  rateLimitMiddleware('enrich'),
  async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { prompt } = body;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return c.json({ error: 'Missing required field: prompt' }, 400);
    }

    let domainPrompt: string;
    try {
      domainPrompt = await getDomainPrompt(c.env.PROMPTS);
    } catch (err) {
      console.error('[btla-proxy] Failed to load domain prompt:', err);
      return c.json({ error: 'Service not initialised — domain prompt missing' }, 503);
    }

    const systemLayers: AnthropicSystemBlock[] = [
      { type: 'text', text: c.env.SYSTEM_PROMPT_ROLE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: domainPrompt,              cache_control: { type: 'ephemeral' } },
      { type: 'text', text: c.env.SYSTEM_PROMPT_ENRICH },
    ];

    try {
      const result = await callAnthropic(
        c.env.ANTHROPIC_API_KEY,
        c.env.ANTHROPIC_MODEL,
        systemLayers,
        prompt,
        8192,
      );
      return c.json({ result });
    } catch (err) {
      if (err instanceof AnthropicError) {
        if (err.statusCode === 429) return c.json({ error: 'Upstream AI rate limit — retry shortly' }, 503);
        if (err.statusCode >= 500)  return c.json({ error: 'AI service temporarily unavailable' }, 503);
      }
      console.error('[btla-proxy] /v1/enrich error:', err);
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ── Review ────────────────────────────────────────────────────────────────────

app.post('/v1/review',
  authMiddleware,
  rateLimitMiddleware('review'),
  async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { prompt } = body;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return c.json({ error: 'Missing required field: prompt' }, 400);
    }

    let domainPrompt: string;
    try {
      domainPrompt = await getDomainPrompt(c.env.PROMPTS);
    } catch (err) {
      console.error('[btla-proxy] Failed to load domain prompt:', err);
      return c.json({ error: 'Service not initialised — domain prompt missing' }, 503);
    }

    const systemLayers: AnthropicSystemBlock[] = [
      { type: 'text', text: c.env.SYSTEM_PROMPT_ROLE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: domainPrompt,              cache_control: { type: 'ephemeral' } },
      { type: 'text', text: c.env.SYSTEM_PROMPT_REVIEW },
    ];

    try {
      const result = await callAnthropic(
        c.env.ANTHROPIC_API_KEY,
        c.env.ANTHROPIC_MODEL,
        systemLayers,
        prompt,
        8192,
      );
      return c.json({ result });
    } catch (err) {
      if (err instanceof AnthropicError) {
        if (err.statusCode === 429) return c.json({ error: 'Upstream AI rate limit — retry shortly' }, 503);
        if (err.statusCode >= 500)  return c.json({ error: 'AI service temporarily unavailable' }, 503);
      }
      console.error('[btla-proxy] /v1/review error:', err);
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ── Catch-all ─────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
