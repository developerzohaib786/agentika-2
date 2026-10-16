#!/usr/bin/env bash
# Fires a fake production alert at the n8n webhook (stand-in for Sentry).
#   bash scripts/fake-alert.sh [webhook-path]   default: incident
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
curl -fsS -X POST "https://${DOMAIN}/webhook/${1:-incident}" \
  -H 'Content-Type: application/json' \
  -d "{
    \"source\": \"fake-alert\",
    \"service\": \"backend\",
    \"title\": \"Elevated 5xx on /api/orders\",
    \"url\": \"${BACKEND_URL}/api/orders\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }"
echo
