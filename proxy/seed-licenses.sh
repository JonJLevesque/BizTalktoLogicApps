#!/usr/bin/env bash
# Seed initial license keys into the Cloudflare KV LICENSE_KEYS namespace.
#
# Prerequisites:
#   1. wrangler.toml updated with real KV namespace ID
#   2. npx wrangler login (or CLOUDFLARE_API_TOKEN set)
#
# Usage:
#   export KV_NAMESPACE_ID=<id from wrangler.toml or `wrangler kv namespace list`>
#   chmod +x seed-licenses.sh
#   ./seed-licenses.sh

set -euo pipefail

NAMESPACE_ID="${KV_NAMESPACE_ID:-}"

if [[ -z "$NAMESPACE_ID" ]]; then
  echo "Error: KV_NAMESPACE_ID is not set."
  echo ""
  echo "Get your namespace ID by running:"
  echo "  npx wrangler kv namespace list"
  echo ""
  echo "Then export it:"
  echo "  export KV_NAMESPACE_ID=<your-id>"
  exit 1
fi

put_license() {
  local key="$1"
  local tier="$2"
  local email="$3"
  local expires="$4"

  local json
  json=$(printf '{"active":true,"tier":"%s","email":"%s","expiresAt":"%s"}' \
    "$tier" "$email" "$expires")

  npx wrangler kv key put \
    --namespace-id "$NAMESPACE_ID" \
    "license:${key}" \
    "$json"

  echo "Seeded: $key  (tier: $tier, email: $email, expires: $expires)"
}

echo "Seeding license keys into KV namespace: $NAMESPACE_ID"
echo ""

# ── Demo / internal test keys ─────────────────────────────────────────────────
put_license "BTLA-DEMO-0001" "standard" "demo@biztalkmigrate.com" "2027-01-01T00:00:00Z"
put_license "BTLA-DEMO-PREM" "premium"  "demo@biztalkmigrate.com" "2027-01-01T00:00:00Z"

echo ""
echo "Done. Quick smoke test:"
echo ""
echo "  curl http://localhost:8787/v1/health"
echo ""
echo "  curl -X POST http://localhost:8787/v1/enrich \\"
echo "    -H 'Authorization: Bearer BTLA-DEMO-0001' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"prompt\":\"Enrich this migration intent...\",\"appName\":\"TestApp\"}'"
