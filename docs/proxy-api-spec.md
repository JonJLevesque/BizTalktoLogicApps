# BizTalk Migrate Proxy API — Specification

**Version:** 1.0
**Base URL:** `https://api.biztalkmigrate.com/v1`
**Auth:** Bearer token (BTLA_LICENSE_KEY)
**Privacy:** Request bodies contain structural metadata only — NO raw BizTalk XML is ever sent. No content logging.

---

## Authentication

All endpoints require a valid license key in the `Authorization` header:

```
Authorization: Bearer <BTLA_LICENSE_KEY>
```

Requests without a valid key return `401 Unauthorized`.

---

## Endpoints

### `POST /v1/enrich`

Resolves `TODO_CLAUDE` markers in a partial `IntegrationIntent` using migration domain knowledge.

**Request Body:**

```json
{
  "prompt": "string — user prompt constructed by the runner (structural metadata only)",
  "appName": "string — BizTalk application name",
  "patterns": ["content-based-routing", "sequential-convoy"],
  "gapSummary": "string — optional: gap analysis summary for context"
}
```

**Response `200 OK`:**

```json
{
  "result": "string — enriched IntegrationIntent as JSON"
}
```

**Response `400 Bad Request`:**

```json
{ "error": "Missing required field: prompt" }
```

**Response `401 Unauthorized`:**

```json
{ "error": "Invalid or expired license key" }
```

**Response `429 Too Many Requests`:**

```json
{ "error": "Rate limit exceeded", "retryAfter": 60 }
```

---

### `POST /v1/review`

Reviews a Logic Apps `workflow.json` with quality issues and returns a fixed version.

**Request Body:**

```json
{
  "prompt": "string — review prompt containing workflow JSON and validation issues",
  "currentScore": 68,
  "currentGrade": "C"
}
```

**Response `200 OK`:**

```json
{
  "result": "string — JSON containing { workflow: object, changes: string[] }"
}
```

**Error responses:** Same structure as `/v1/enrich`.

---

### `GET /v1/health`

Returns service health. No authentication required.

**Response `200 OK`:**

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2026-02-23T00:00:00Z"
}
```

---

## Privacy Guarantees

1. **No raw artifact logging** — request bodies are processed and discarded immediately. The runner sends only structural metadata (shape types, adapter names, pattern names, and gap summaries) — never raw BizTalk XML or customer data.
2. **No PII storage** — app names and schema names are not retained post-processing.
3. **TLS required** — all traffic must use HTTPS. HTTP requests are rejected with `400`.
4. **EU data residency available** — contact Me@Jonlevesque.com for a dedicated EU endpoint.
5. **System prompt is server-side only** — the migration domain knowledge (CLAUDE.md) lives on the proxy server. Clients never see or send it.

---

## Rate Limits

| License Tier | `/enrich` calls/hour | `/review` calls/hour |
|---|---|---|
| Free | 0 (not available) | 0 (not available) |
| Standard | 60 | 20 |
| Premium | 300 | 100 |

---

## Client Behavior (Automatic Fallback)

The `ClaudeClient` in `src/runner/claude-client.ts` implements these fallback behaviors so pipeline failures are never fatal:

| Scenario | Client behavior |
|----------|----------------|
| `/enrich` returns non-2xx | Uses partial IntegrationIntent with TODO_CLAUDE markers as-is |
| `/enrich` returns invalid JSON | Uses partial IntegrationIntent as-is |
| `/review` returns non-2xx | Uses original workflow.json unmodified |
| No license key configured | Throws error on first call (surfaced as warning in runner) |
| `BTLA_DEV_MODE=true` | Skips all API calls, returns inputs unchanged |
| `ANTHROPIC_API_KEY` set | Uses Anthropic API directly, bypasses proxy |

---

## Mode Selection (Client-Side)

The client automatically selects its mode based on environment variables:

```
BTLA_DEV_MODE=true         → dev mode (no API calls, instant response)
ANTHROPIC_API_KEY=sk-...   → direct mode (Anthropic API, model: claude-sonnet-4-6)
BTLA_LICENSE_KEY=...    → proxy mode (default for production deployments)
BTLA_PROXY_URL=...      → override proxy URL (default: https://api.biztalkmigrate.com/v1)
```

---

## Support

Email: Me@Jonlevesque.com
Documentation: https://github.com/biztalk-migrate/docs
