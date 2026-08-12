# Asset Inventory — BizTalk Migrate (biztalk-migrate)

> Data-room document. Everything a buyer must receive for the product to keep
> working after close. Compiled from repository inspection only (no production
> systems were queried). Where live verification is required, it is flagged as
> a **pre-transfer verification step** for the current owner.
>
> Repo: `https://github.com/JonJLevesque/BTtoLA` · npm package: `biztalk-migrate`
> · Product domain: `biztalkmigrate.com` · Compiled: 2026-08-11

---

## 1. Cloudflare Account (single most critical asset group)

The entire server side of the product runs in one Cloudflare account. The buyer
must receive the Cloudflare account itself (preferred) or a full migration of
every object below into their own account.

### 1.1 Worker: `btla-proxy` (api.biztalkmigrate.com)

Source: `proxy/` in the repo (`proxy/wrangler.toml`, `proxy/src/*.ts`). The
Worker code is fully reproducible from git; its **secrets and KV contents are
not** (see 1.3 and 1.4).

Route (from `proxy/wrangler.toml`):

```
pattern   = "api.biztalkmigrate.com/*"
zone_name = "biztalkmigrate.com"
```

Endpoints served (`proxy/src/index.ts`): `GET /v1/health`, `POST /v1/enrich`,
`POST /v1/review`, `POST /v1/validate`, `POST /v1/license/trial`,
`POST /v1/waitlist`. The npm client defaults to this host
(`src/licensing/license-validator.ts`: `https://api.biztalkmigrate.com`,
overridable via `BTLA_LICENSE_SERVER` / `BTLA_PROXY_URL`), so **if this Worker
goes dark, every installed copy of the product loses AI enrichment and license
validation**.

Plain-text vars (in `wrangler.toml`, no transfer risk):

| Var | Value |
|---|---|
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` |
| `MONTHLY_CALL_LIMIT` | `5000` (hard monthly kill switch) |
| `TRIAL_DAILY_IP_LIMIT` | `3` (trial requests per IP per UTC day) |

### 1.2 KV Namespaces (IDs from `proxy/wrangler.toml`)

| Binding | Namespace ID | Contents | Reproducible from git? |
|---|---|---|---|
| `LICENSE_KEYS` | `b91739c093484cff872c3985e6586f7b` | Live license records, email index, waitlist (see §5) | **NO — customer data, must be exported** |
| `RATE_LIMITS` | `b225597a544f4fa695a72587ab3a7ca5` | Transient rate-limit counters | Yes (disposable, regenerates) |
| `PROMPTS` | `8a9ff0e8cbd24c05bb655fdf589d9659` | Key `domain` → ~18 KB domain-knowledge system prompt (Layer 2) | **NO — see 1.3** |

### 1.3 Worker Secrets — the crown-jewel IP, existing ONLY in Cloudflare

Set via `proxy/prompts/upload.sh` and `npx wrangler secret put`. **By design,
the layered system prompts have NO backup in git** — `git ls-files
proxy/prompts` returns only `upload.sh`; the `.txt` prompt files
(`role.txt`, `domain.txt`, `enrich.txt`, `review.txt`) are deliberately
untracked so zero IP ships in the client or repo. This is the product's core
proprietary migration knowledge.

| Secret / KV key | Layer | Size | Where it lives |
|---|---|---|---|
| `SYSTEM_PROMPT_ROLE` | 1 — role + critical rules | ~1.3 KB | Worker secret |
| `PROMPTS` KV key `domain` | 2 — domain knowledge | ~18 KB | KV (exceeds 5.1 KB secret limit) |
| `SYSTEM_PROMPT_ENRICH` | 3 — enrich task | ~1 KB | Worker secret |
| `SYSTEM_PROMPT_REVIEW` | 3 — review task | ~1 KB | Worker secret |
| `ANTHROPIC_API_KEY` | — | — | Worker secret (buyer supplies their own key; billing relationship transfers) |
| `RESEND_API_KEY` | — | — | Worker secret (see §4) |

> **CRITICAL — ESCROW BEFORE TRANSFER**: Cloudflare Worker secrets are
> write-only; they cannot be read back via wrangler or the dashboard. The
> seller must place the four prompt-layer source files (`role.txt`,
> `domain.txt`, `enrich.txt`, `review.txt`) — either the local originals or a
> KV export of `domain` plus the local secret sources — into escrow before
> close. If the seller's local copies are lost and the Worker is deleted or
> the account access is lost, **the prompts are unrecoverable and the product's
> AI pipeline cannot be reconstituted**.

### 1.4 Cloudflare Pages: `biztalkmigrate` (marketing site)

- Project name: `biztalkmigrate`; serves `https://biztalkmigrate.com`
- Source: `site/index.html` — **intentionally gitignored** (`.gitignore` line
  ~71: `site/`), deployed via `npx wrangler pages deploy site --project-name
  biztalkmigrate`. Like the prompts, the site source exists only on the
  seller's machine and in the deployed Pages project. Must be handed over as
  files (or pulled from the live deployment) — **not in git**.

### 1.5 Cloudflare Zone: `biztalkmigrate.com`

DNS zone hosted in the same account; carries the Worker route and Pages
custom-domain records. See §7.

---

## 2. npm Package: `biztalk-migrate`

| Item | Detail |
|---|---|
| Package | `biztalk-migrate` (public, `--access public`, provenance-attested) |
| Local version | `1.0.70` in `package.json` — **pending publish**; registry latest believed 1.0.69/1.0.70 — verify pre-transfer |
| Ownership | Published under the seller's personal npmjs.com account — buyer needs `npm owner add` / account handoff |
| Publish path | `.github/workflows/publish.yml` (workflow_dispatch, bump → tag → `npm publish --provenance`) requires GitHub Actions secret **`NPM_TOKEN`** (npm Automation token) |
| Token/2FA status | Current token is a granular automation token on the seller's account with **2FA disabled for write actions**. Buyer must mint their OWN token post-transfer and rotate the old one; recommend re-enabling 2FA with an automation token exemption |
| Also | `bin` entry `biztalk-migrate`; package name itself is an asset (npm names are first-come) |

**VS Code extension**: `vscode-extension/package.json` declares publisher
`biztalk-migrate`, version 1.0.69. If it has been published to the VS Code
Marketplace, the **publisher account (Azure DevOps org + PAT)** must transfer
too — pre-transfer verification step: confirm marketplace publication status.

---

## 3. GitHub

| Item | Detail |
|---|---|
| Repository | `https://github.com/JonJLevesque/BTtoLA` (transfer via GitHub repo transfer to buyer org) |
| Actions secret `NPM_TOKEN` | Used by `.github/workflows/publish.yml` — buyer sets their own after npm handoff |
| Actions secret `BTLA_LICENSE_KEY` | Used by `.github/workflows/biztalk-migrate.yml` (demo/CI migration run) — currently the seller's premium key; buyer replaces |
| Actions secret `ANTHROPIC_API_KEY` | Also referenced in `biztalk-migrate.yml` — buyer supplies own |
| `secrets.GITHUB_TOKEN` | Automatic; no transfer needed |
| Untracked-but-valuable | Note that several working directories are gitignored (`site/`, `Samples Sandro/`, prompt `.txt` files) — a bare repo transfer does NOT include them; deliver separately |

---

## 4. Resend (transactional email + audience)

Configured in `proxy/src/license-provisioner.ts`:

| Item | Detail |
|---|---|
| Account | Seller's Resend account — transfer account or buyer creates own + re-verifies domain |
| API key | Worker secret `RESEND_API_KEY` (rotate on transfer) |
| From address | `BizTalk Migrate <keys@biztalkmigrate.com>` — requires `biztalkmigrate.com` domain verification (DKIM/SPF DNS records) in Resend |
| Audience ID | `1c79463d-1590-4204-b885-43c5538eae4a` (waitlist contacts, tagged `source: biztalk_migrate_waitlist`) — export contacts as part of customer data |
| Templates | Inline HTML in `license-provisioner.ts`: trial-key email ("Your BizTalk Migrate 3-Day Trial Key") and waitlist confirmation. Both currently link `me@jonlevesque.com` for support (see §6) |

---

## 5. License Data (customer records — a transferred asset)

Lives in KV namespace `LICENSE_KEYS` (`b91739c093484cff872c3985e6586f7b`).
Record shape (`proxy/src/types.ts` + `license-provisioner.ts`):

```jsonc
// key: license:BTLA-XXXX-XXXX-XXXX
{
  "active": true,
  "tier": "free" | "standard" | "premium",
  "email": "customer@example.com",
  "expiresAt": "2028-10-01T00:00:00Z",
  // trial-provisioned keys additionally carry:
  "source": "trial", "name": "...", "company": "..."
}
// key: email:<lowercased-email>   → ["BTLA-...."]  (dedup index)
// key: waitlist:<lowercased-email> → { "email": "...", "signedUpAt": "..." }
```

Key format: `BTLA-` + 3×4 chars from an unambiguous charset (no 0/O/1/I/L),
generated with `crypto.getRandomValues`.

**Transfer notes:**

- Full KV export of `LICENSE_KEYS` = the active customer list (keys, emails,
  names, companies, tiers, expiry). This is **personal data** — the transfer
  must be handled under GDPR (asset-sale data-transfer clause, privacy-notice
  update, lawful-basis continuity; EU/UK customers likely present). Include a
  data-processing addendum in the sale agreement.
- Waitlist entries (`waitlist:*` in KV + the Resend audience) are marketing
  contacts — same GDPR care.
- `proxy/seed-licenses.sh` seeds demo keys `BTLA-DEMO-0001` (standard) and
  `BTLA-DEMO-PREM` (premium), expiry 2027-01-01. **Pre-transfer verification
  step**: check whether these demo keys exist in prod KV and deactivate or
  disclose them (they grant free premium access).
- The seller's own key `BTLA-YJ7J-U93N-YYRH` (premium, expires 2028-10-01)
  exists in prod KV — deactivate or reassign at close.

---

## 6. Identity Coupling — `me@jonlevesque.com` (fix pre/post close)

The seller's personal email is baked into shipped code, published packages,
and outbound customer email. Every occurrence in tracked files:

| File | Location | Context |
|---|---|---|
| `package.json` | line 5 (`author`), line 14 (`bugs.email`) | npm package metadata (published) |
| `vscode-extension/package.json` | line 7 (`author`), line 16 (`bugs.email`) | extension metadata |
| `LICENSE` | line 61 | "For licensing inquiries" |
| `README.md` | line 439 | Support link (`Me@Jonlevesque.com`) |
| `CLAUDE.md` | Support section | `Me@Jonlevesque.com` |
| `src/mcp-server/server.ts` | line 286 | Support string shown to MCP users |
| `src/runner/markdown-to-html.ts` | line 667 | Footer of every generated HTML migration report |
| `src/runner/report-generator.ts` | lines 15, 657 | Footer of every generated Markdown migration report |
| `src/runner/estate-report-generator.ts` | lines 16, 345 | Estate report footer |
| `proxy/src/license-provisioner.ts` | lines 162, 208 | **Customer-facing emails** (trial + waitlist) |

**Recommendation**: create `support@biztalkmigrate.com` (alias/forward, later a
real mailbox owned by the buyer), replace all 10 locations above in a single
pre-close commit, republish npm + redeploy the Worker. Post-close, the buyer
controls the domain, so the address survives the identity change with no
further code edits. Until republished, already-installed versions and old
emails still point at the seller — agree on a forwarding window.

---

## 7. Domain + DNS: `biztalkmigrate.com`

| Record / config | Purpose | Risk if missed |
|---|---|---|
| Domain registration `biztalkmigrate.com` | Root asset — registrar transfer to buyer | Everything else breaks at renewal |
| Cloudflare zone | Hosts all records; Worker route binds to this zone | Worker route `api.biztalkmigrate.com/*` stops resolving |
| `api.biztalkmigrate.com` | Worker route (proxied) — hardcoded default in every shipped client | All installed clients lose AI + license validation |
| Apex / `www` → Pages project `biztalkmigrate` | Marketing site + trial signup + waitlist forms | New-customer funnel dies |
| Resend DKIM/SPF (+ any MX) records | Sending as `keys@biztalkmigrate.com`; **verify pre-transfer whether MX/inbound routing exists** for replies and for the recommended `support@` alias — repo shows outbound only | License emails land in spam / replies bounce |

**Pre-transfer verification step**: dump the full zone file (registrar lock
status, MX, TXT/DKIM, CNAME to Pages) — DNS contents are not in the repo.

---

## 8. Transfer-Day Checklist

| # | Asset | Where it lives | Transfer mechanism | Risk if missed |
|---|---|---|---|---|
| 1 | System prompt layers (ROLE/DOMAIN/ENRICH/REVIEW) | Cloudflare secrets + `PROMPTS` KV `8a9ff0e8…` — **no git backup by design** | Escrow the 4 source `.txt` files + KV export of `domain` BEFORE close; buyer re-runs `proxy/prompts/upload.sh` | **Product's AI core is permanently unrecoverable** |
| 2 | Anthropic API key + billing | Cloudflare secret `ANTHROPIC_API_KEY` | Buyer creates own Anthropic account/key; `wrangler secret put`; seller revokes old | AI calls fail the moment old key is revoked |
| 3 | Cloudflare account (Worker `btla-proxy`, 3 KV namespaces, Pages `biztalkmigrate`, zone) | Cloudflare | Account handoff, or member-invite + re-deploy into buyer account with KV export/import | api.biztalkmigrate.com and website go down |
| 4 | `LICENSE_KEYS` KV data (customers) | KV `b91739c0…` | Bulk KV export → import (or account handoff); GDPR data-transfer clause in APA | Paying customers locked out; legal exposure |
| 5 | Marketing site source | `site/` on seller's machine + live Pages deploy (gitignored) | File handoff; buyer redeploys via `wrangler pages deploy` | Site frozen/unrecoverable on next needed change |
| 6 | Domain `biztalkmigrate.com` | Registrar + Cloudflare zone | Registrar transfer + zone-file dump | Hardcoded client URL dies at renewal/expiry |
| 7 | npm package `biztalk-migrate` | npmjs.com (seller personal account) | `npm owner add <buyer>` then remove seller; buyer mints new automation token; rotate/revoke old token `npm_zoW…` | Cannot ship updates; supply-chain risk from stale token |
| 8 | GitHub repo `JonJLevesque/BTtoLA` | GitHub | Repo transfer to buyer org; buyer re-creates Actions secrets `NPM_TOKEN`, `BTLA_LICENSE_KEY`, `ANTHROPIC_API_KEY` | CI/publish pipeline dead |
| 9 | Resend account, `RESEND_API_KEY`, audience `1c79463d-…`, domain verification | Resend + Cloudflare secret + DNS | Account handoff or buyer account + domain re-verify; export audience; rotate key | Trial-key emails stop → signup funnel silently broken |
| 10 | VS Code Marketplace publisher `biztalk-migrate` (if published) | Azure DevOps / Marketplace | Verify publication status; transfer publisher org | Extension updates impossible |
| 11 | Demo/internal keys (`BTLA-DEMO-0001`, `BTLA-DEMO-PREM`, seller key `BTLA-YJ7J-…`) | Prod `LICENSE_KEYS` KV | **Pre-transfer verification**: audit prod KV, deactivate or disclose | Free premium backdoors survive the sale |
| 12 | Identity decoupling (`me@jonlevesque.com` × 10 tracked locations, §6) | Code, npm metadata, outbound emails, LICENSE | Pre-close commit switching to `support@biztalkmigrate.com` + republish + redeploy; forwarding window on seller mailbox | Support requests route to seller indefinitely |
| 13 | Gitignored working assets (`Samples Sandro/` production fixtures, reference outputs) | Seller's machine only | File handoff (respecting any third-party confidentiality on the samples) | Regression baselines lost |

### Pre-transfer verification steps (owner to run against live systems)

1. `npx wrangler secret list` — confirm all 6 secrets exist on `btla-proxy`.
2. Export `PROMPTS` KV `domain` key and diff against local `domain.txt`.
3. Audit `LICENSE_KEYS` for `BTLA-DEMO-*` and seller-personal keys.
4. Confirm npm registry latest version and owner list for `biztalk-migrate`.
5. Confirm VS Code Marketplace publication status of the extension.
6. Dump `biztalkmigrate.com` zone file (MX/DKIM/SPF, registrar lock, expiry).
7. Confirm Resend domain verification status and export audience contacts.
