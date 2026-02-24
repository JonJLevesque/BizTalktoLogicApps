/**
 * License validation middleware.
 *
 * Extracts the Bearer token from the Authorization header, looks up the
 * license record in the LICENSE_KEYS KV namespace, and validates:
 *   - key exists
 *   - active === true
 *   - expiresAt is in the future
 *   - tier is not 'free' (free tier uses Stage 1+2 only, no AI enrichment)
 *
 * On success: sets c.var.license and calls next().
 * On failure: returns 401 or 403 JSON error.
 */

import type { MiddlewareHandler } from 'hono';
import type { AppEnv, LicenseRecord } from './types.js';

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization' }, 401);
  }

  const key = authHeader.slice(7).trim();
  if (!key) {
    return c.json({ error: 'Missing or invalid authorization' }, 401);
  }

  // Look up license in KV
  let record: LicenseRecord | null = null;
  try {
    const raw = await c.env.LICENSE_KEYS.get(`license:${key}`);
    if (!raw) {
      return c.json({ error: 'Invalid license key' }, 401);
    }
    record = JSON.parse(raw) as LicenseRecord;
  } catch {
    return c.json({ error: 'License validation failed' }, 401);
  }

  if (!record.active) {
    return c.json({ error: 'License is inactive' }, 401);
  }

  if (new Date(record.expiresAt) < new Date()) {
    return c.json({ error: 'License has expired' }, 401);
  }

  if (record.tier === 'free') {
    return c.json({ error: 'License tier does not permit API access. Upgrade to Standard or Premium.' }, 403);
  }

  // Tier is guaranteed to be 'standard' | 'premium' after the free check above
  const tier = record.tier as 'standard' | 'premium';

  c.set('license', { key, tier, email: record.email });
  await next();
};
