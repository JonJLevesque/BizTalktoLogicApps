/**
 * Per-key rate limiter using Cloudflare KV.
 *
 * Three layers of protection:
 *
 *   1. Global monthly kill switch — total calls across ALL keys this calendar month.
 *      When hit, every request returns 503 until the 1st of next month.
 *      Controlled by MONTHLY_CALL_LIMIT var in wrangler.toml (default: 5000).
 *
 *   2. Per-key hourly limit — resets every hour on the hour (UTC).
 *      Standard: 60 enrich/hr, 20 review/hr
 *      Premium:  300 enrich/hr, 100 review/hr
 *
 *   3. Per-key daily limit — resets at midnight UTC.
 *      Standard: 300 enrich/day, 100 review/day
 *      Premium:  2000 enrich/day, 600 review/day
 *
 * KV key formats:
 *   global:calls:<YYYY-MM>                         monthly counter
 *   rl:<licenseKey>:<YYYY-MM-DDTHH>:<endpoint>     hourly counter
 *   rl:<licenseKey>:<YYYY-MM-DD>:<endpoint>:daily  daily counter
 *
 * All three counters are read in parallel (single KV round-trip latency).
 */

import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './types.js';

const HOURLY_LIMITS: Record<string, Record<string, number>> = {
  standard: { enrich: 60,   review: 20  },
  premium:  { enrich: 300,  review: 100 },
};

const DAILY_LIMITS: Record<string, Record<string, number>> = {
  standard: { enrich: 300,  review: 100 },
  premium:  { enrich: 2000, review: 600 },
};

export function rateLimitMiddleware(
  endpoint: 'enrich' | 'review',
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const license = c.get('license');
    const now     = new Date();

    // Build KV keys for all three counters
    const monthBucket = now.toISOString().slice(0, 7);   // "2026-02"
    const hourBucket  = now.toISOString().slice(0, 13);  // "2026-02-24T19"
    const dayBucket   = now.toISOString().slice(0, 10);  // "2026-02-24"

    const monthlyKey = `global:calls:${monthBucket}`;
    const hourKey    = `rl:${license.key}:${hourBucket}:${endpoint}`;
    const dayKey     = `rl:${license.key}:${dayBucket}:${endpoint}:daily`;

    // Read all three counters in parallel — one KV round-trip
    const [monthlyStored, hourStored, dayStored] = await Promise.all([
      c.env.RATE_LIMITS.get(monthlyKey),
      c.env.RATE_LIMITS.get(hourKey),
      c.env.RATE_LIMITS.get(dayKey),
    ]);

    const monthlyCount = monthlyStored !== null ? parseInt(monthlyStored, 10) : 0;
    const hourCount    = hourStored    !== null ? parseInt(hourStored,    10) : 0;
    const dayCount     = dayStored     !== null ? parseInt(dayStored,     10) : 0;

    // ── 1. Global monthly kill switch ─────────────────────────────────────────

    const monthlyLimit = parseInt(c.env.MONTHLY_CALL_LIMIT ?? '5000', 10);

    if (monthlyCount >= monthlyLimit) {
      // Reset timestamp: midnight UTC on the 1st of next month
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const resetTs   = Math.floor(nextMonth.getTime() / 1000);
      c.header('X-RateLimit-Reset', String(resetTs));
      return c.json({
        error: 'Service capacity limit reached — resets on the 1st of next month',
      }, 503);
    }

    // ── 2. Per-key hourly limit ────────────────────────────────────────────────

    const hourLimit = HOURLY_LIMITS[license.tier]?.[endpoint] ?? 60;

    // Hourly reset: start of next hour UTC
    const hourReset = new Date(now);
    hourReset.setMinutes(0, 0, 0);
    hourReset.setHours(hourReset.getHours() + 1);
    const hourResetTs = Math.floor(hourReset.getTime() / 1000);

    if (hourCount >= hourLimit) {
      const retryAfter = hourResetTs - Math.floor(now.getTime() / 1000);
      c.header('X-RateLimit-Limit',     String(hourLimit));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset',     String(hourResetTs));
      c.header('Retry-After',           String(retryAfter));
      return c.json({ error: 'Hourly rate limit exceeded', retryAfter }, 429);
    }

    // ── 3. Per-key daily limit ─────────────────────────────────────────────────

    const dayLimit = DAILY_LIMITS[license.tier]?.[endpoint] ?? 300;

    // Daily reset: midnight UTC
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const dayResetTs = Math.floor(tomorrow.getTime() / 1000);

    if (dayCount >= dayLimit) {
      const retryAfter = dayResetTs - Math.floor(now.getTime() / 1000);
      c.header('X-RateLimit-Limit',     String(dayLimit));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset',     String(dayResetTs));
      c.header('Retry-After',           String(retryAfter));
      return c.json({ error: 'Daily rate limit exceeded', retryAfter }, 429);
    }

    // ── 4. Increment all three counters in parallel ────────────────────────────

    // Monthly TTL: days remaining in month + 2 days buffer
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const daysLeft    = daysInMonth - now.getUTCDate() + 2;

    await Promise.all([
      c.env.RATE_LIMITS.put(monthlyKey, String(monthlyCount + 1), { expirationTtl: daysLeft * 86400 }),
      c.env.RATE_LIMITS.put(hourKey,    String(hourCount + 1),    { expirationTtl: 7200 }),
      c.env.RATE_LIMITS.put(dayKey,     String(dayCount + 1),     { expirationTtl: 172800 }),
    ]);

    // Set response headers (hourly is the primary limit clients care about)
    const remaining = hourLimit - hourCount - 1;
    c.header('X-RateLimit-Limit',     String(hourLimit));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset',     String(hourResetTs));

    c.set('rateLimit', { limit: hourLimit, remaining, reset: hourResetTs });
    await next();
  };
}
