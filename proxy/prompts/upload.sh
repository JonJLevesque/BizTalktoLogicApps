#!/usr/bin/env bash
# Upload all system prompt layers to Cloudflare.
#
# - SYSTEM_PROMPT_ROLE, ENRICH, REVIEW  → Cloudflare secrets (small, < 5.1 KB)
# - domain prompt                        → KV namespace PROMPTS (large, ~18 KB)
#
# Prerequisites:
#   1. npx wrangler login
#   2. PROMPTS KV namespace created and wrangler.toml updated with its ID
#
# Usage (run from proxy/ directory):
#   chmod +x prompts/upload.sh
#   ./prompts/upload.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Secrets (role, enrich, review — all under 5.1 KB limit) ──────────────────

upload_secret() {
  local name="$1"
  local file="$2"

  if [[ ! -f "$file" ]]; then
    echo "ERROR: $file not found"
    exit 1
  fi

  local size
  size=$(wc -c < "$file" | tr -d ' ')
  echo "  Uploading secret $name ($size bytes)..."
  npx wrangler secret put "$name" < "$file"
  echo "  ✓ $name"
}

echo "Uploading system prompt layers to Cloudflare..."
echo ""

upload_secret "SYSTEM_PROMPT_ROLE"   "$SCRIPT_DIR/role.txt"
upload_secret "SYSTEM_PROMPT_ENRICH" "$SCRIPT_DIR/enrich.txt"
upload_secret "SYSTEM_PROMPT_REVIEW" "$SCRIPT_DIR/review.txt"

# ── Domain prompt → KV (too large for secrets, Cloudflare limit is 5.1 KB) ───

DOMAIN_FILE="$SCRIPT_DIR/domain.txt"

if [[ ! -f "$DOMAIN_FILE" ]]; then
  echo "ERROR: $DOMAIN_FILE not found"
  exit 1
fi

# Get PROMPTS namespace ID from wrangler.toml
PROMPTS_KV_ID=$(grep -A2 '"PROMPTS"' "$(dirname "$SCRIPT_DIR")/wrangler.toml" 2>/dev/null | grep 'id' | head -1 | sed 's/.*= *"//;s/".*//' || echo "")

if [[ -z "$PROMPTS_KV_ID" ]]; then
  # Try alternate toml format
  PROMPTS_KV_ID=$(grep -A2 "PROMPTS" "$(dirname "$SCRIPT_DIR")/wrangler.toml" 2>/dev/null | grep 'id' | head -1 | sed 's/.*= *"//;s/".*//' || echo "")
fi

if [[ -z "$PROMPTS_KV_ID" ]] || [[ "$PROMPTS_KV_ID" == *"REPLACE"* ]]; then
  echo ""
  echo "ERROR: PROMPTS KV namespace ID not set in wrangler.toml."
  echo "Run: npx wrangler kv namespace create PROMPTS"
  echo "Then paste the returned ID into wrangler.toml under the PROMPTS binding."
  exit 1
fi

local_size=$(wc -c < "$DOMAIN_FILE" | tr -d ' ')
echo "  Uploading domain prompt to KV ($local_size bytes, key: 'domain')..."
npx wrangler kv key put --namespace-id "$PROMPTS_KV_ID" "domain" "$(cat "$DOMAIN_FILE")"
echo "  ✓ SYSTEM_PROMPT_DOMAIN (KV)"

echo ""
echo "All prompt layers uploaded successfully."
echo ""
echo "Verify secrets:"
echo "  npx wrangler secret list"
echo ""
echo "Verify KV:"
echo "  npx wrangler kv key get --namespace-id $PROMPTS_KV_ID domain | head -5"
