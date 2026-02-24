/**
 * license-provisioner — trial key generation and email delivery
 *
 * Handles:
 *   - Generating BTLA-XXXX-XXXX-XXXX keys via crypto.getRandomValues
 *   - Writing LicenseRecord + email index to KV
 *   - Sending license and waitlist emails via Resend REST API
 *   - Deduplication: max 1 trial key per email address
 */

import type { LicenseRecord } from './types.js';

// Unambiguous charset — no 0/O, 1/I/L
const KEY_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SEGMENT_LEN = 4;
const SEGMENT_COUNT = 3; // BTLA-XXXX-XXXX-XXXX

function generateSegment(): string {
  const bytes = new Uint8Array(SEGMENT_LEN);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => KEY_CHARSET[b % KEY_CHARSET.length])
    .join('');
}

export function generateLicenseKey(): string {
  const segments = Array.from({ length: SEGMENT_COUNT }, generateSegment);
  return `BTLA-${segments.join('-')}`;
}

// ── Trial key provisioning ────────────────────────────────────────────────────

export interface ProvisionResult {
  key: string;
  alreadyExists: boolean;
}

/**
 * Provision a 3-day Standard trial key for a given email.
 * Returns the existing key if one was already issued to this email.
 */
export async function provisionTrialKey(
  email: string,
  name: string,
  company: string,
  kv: KVNamespace,
): Promise<ProvisionResult> {
  const emailIndexKey = `email:${email.toLowerCase()}`;

  // Dedup: check if this email already has a key
  const existing = await kv.get(emailIndexKey);
  if (existing) {
    const keys = JSON.parse(existing) as string[];
    if (keys.length > 0) {
      return { key: keys[0], alreadyExists: true };
    }
  }

  const key = generateLicenseKey();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // +3 days

  const record: LicenseRecord & { source: string; name: string; company: string } = {
    active:    true,
    tier:      'standard',
    email:     email.toLowerCase(),
    expiresAt: expiresAt.toISOString(),
    source:    'trial',
    name,
    company,
  };

  await Promise.all([
    kv.put(`license:${key}`, JSON.stringify(record)),
    kv.put(emailIndexKey, JSON.stringify([key])),
  ]);

  return { key, alreadyExists: false };
}

// ── Waitlist ──────────────────────────────────────────────────────────────────

export async function addToWaitlist(
  email: string,
  kv: KVNamespace,
): Promise<{ alreadySignedUp: boolean }> {
  const waitlistKey = `waitlist:${email.toLowerCase()}`;
  const existing = await kv.get(waitlistKey);
  if (existing) return { alreadySignedUp: true };

  await kv.put(waitlistKey, JSON.stringify({
    email:       email.toLowerCase(),
    signedUpAt:  new Date().toISOString(),
  }));

  return { alreadySignedUp: false };
}

// ── Email delivery via Resend ─────────────────────────────────────────────────

const FROM_ADDRESS = 'BizTalk Migrate <keys@biztalkmigrate.com>';
const RESEND_API   = 'https://api.resend.com/emails';

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  resendApiKey: string,
): Promise<void> {
  const res = await fetch(RESEND_API, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[license-provisioner] Resend error ${res.status}: ${body}`);
    // Don't throw — key is already written to KV. Email failure is non-fatal.
  }
}

export async function sendLicenseEmail(
  to: string,
  key: string,
  name: string,
  resendApiKey: string,
): Promise<void> {
  const subject = 'Your BizTalk Migrate 3-Day Trial Key';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0f0f0f; color:#e5e5e5; max-width:600px; margin:0 auto; padding:40px 20px;">
  <div style="background:#1a1a2e; border:1px solid #16213e; border-radius:12px; padding:40px;">
    <h1 style="color:#60a5fa; margin:0 0 8px;">BizTalk Migrate</h1>
    <p style="color:#94a3b8; margin:0 0 32px; font-size:14px;">Your 3-Day Trial Key</p>
    <p style="margin:0 0 24px;">Hi ${name || 'there'},</p>
    <p style="margin:0 0 24px;">Here's your trial key — it gives you full Standard access for 3 days:</p>
    <div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:20px; text-align:center; margin:0 0 32px;">
      <code style="font-family: 'Courier New', monospace; font-size:22px; font-weight:bold; color:#60a5fa; letter-spacing:2px;">${key}</code>
    </div>
    <h2 style="color:#e2e8f0; font-size:16px; margin:0 0 16px;">Get started in 3 minutes</h2>
    <div style="background:#1e293b; border-radius:8px; padding:16px; margin:0 0 16px; font-family:'Courier New',monospace; font-size:13px; color:#e2e8f0;">
      <span style="color:#94a3b8;"># 1. Install</span><br>
      npm install -g biztalk-migrate<br><br>
      <span style="color:#94a3b8;"># 2. Set your key</span><br>
      export BTLA_LICENSE_KEY="${key}"<br><br>
      <span style="color:#94a3b8;"># 3. Run your first migration</span><br>
      biztalk-migrate run \\<br>
      &nbsp;&nbsp;--dir ./your-biztalk-files \\<br>
      &nbsp;&nbsp;--app "YourAppName" \\<br>
      &nbsp;&nbsp;--output ./output
    </div>
    <p style="margin:0 0 24px; font-size:14px; color:#94a3b8;">Your key expires in <strong style="color:#e2e8f0;">3 days</strong>. After that, grab a full license at <a href="https://biztalkmigrate.com" style="color:#60a5fa;">biztalkmigrate.com</a>.</p>
    <hr style="border:none; border-top:1px solid #1e293b; margin:32px 0;">
    <p style="margin:0; font-size:13px; color:#64748b;">Questions? Reply to this email or write to <a href="mailto:me@jonlevesque.com" style="color:#60a5fa;">me@jonlevesque.com</a></p>
  </div>
</body>
</html>`;

  await sendEmail(to, subject, html, resendApiKey);
}

export async function sendWaitlistEmail(
  to: string,
  resendApiKey: string,
): Promise<void> {
  const subject = "You're on the BizTalk Migrate waitlist";
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0f0f0f; color:#e5e5e5; max-width:600px; margin:0 auto; padding:40px 20px;">
  <div style="background:#1a1a2e; border:1px solid #16213e; border-radius:12px; padding:40px;">
    <h1 style="color:#60a5fa; margin:0 0 8px;">BizTalk Migrate</h1>
    <p style="color:#94a3b8; margin:0 0 32px; font-size:14px;">You're on the list</p>
    <p style="margin:0 0 24px;">Thanks for signing up. We'll reach out when full license pricing is available.</p>
    <p style="margin:0 0 24px; font-size:14px; color:#94a3b8;">In the meantime, grab a free 3-day trial key at <a href="https://biztalkmigrate.com" style="color:#60a5fa;">biztalkmigrate.com</a> and run your first migration today.</p>
    <hr style="border:none; border-top:1px solid #1e293b; margin:32px 0;">
    <p style="margin:0; font-size:13px; color:#64748b;">Questions? <a href="mailto:me@jonlevesque.com" style="color:#60a5fa;">me@jonlevesque.com</a></p>
  </div>
</body>
</html>`;

  await sendEmail(to, subject, html, resendApiKey);
}
