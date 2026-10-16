#!/usr/bin/env bash
# 1. wait until Alternate Clouds serves this commit (/version) and /health is 200
# 2. hit /api/orders (real traffic: 500s leave stack traces for the agents)
# 3. /health must be "ok" and n8n must answer
set -uo pipefail
fail() {
  echo "FAILED_STAGE=$1" >> "$GITHUB_ENV"
  echo "FAILURE_SUMMARY=$2" >> "$GITHUB_ENV"
  echo "$3" > "$RUNNER_TEMP/failed_checks.json"
  echo "✖ $2"; exit 1
}

echo "== waiting for ${GITHUB_SHA:0:7} to go live"
deadline=$(( $(date +%s) + ${DEPLOY_TIMEOUT_SEC:-480} ))
until [ "$(curl -fsS -m 10 "$BACKEND_URL/version" 2>/dev/null | jq -r '.commit // empty' 2>/dev/null)" = "$GITHUB_SHA" ] \
   && [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$BACKEND_URL/health?format=json")" = 200 ]; do
  [ "$(date +%s)" -ge "$deadline" ] && fail deploy-timeout \
    "Commit ${GITHUB_SHA:0:7} did not come up healthy within ${DEPLOY_TIMEOUT_SEC:-480}s" '[{"check":"deploy","detail":"timeout"}]'
  sleep 10
done
echo "live"

echo "== /api/orders"
for i in 1 2 3; do
  out=$(curl -s -m 15 -w '\n%{http_code}' "$BACKEND_URL/api/orders"); code=${out##*$'\n'}; body=${out%$'\n'*}
  if [ "$code" != 200 ]; then
    fail health-check "GET /api/orders returned $code after deploying ${GITHUB_SHA:0:7}" \
      "$(jq -nc --arg c "$code" --arg b "${body:0:300}" '[{check:"orders_list",request:"GET /api/orders",status:($c|tonumber? // $c),expected:200,body:$b}]')"
  fi
done
echo "ok"

echo "== /health"
h=$(curl -s -m 10 "$BACKEND_URL/health?format=json")
[ "$(jq -r .status <<<"$h" 2>/dev/null)" = ok ] || fail health-check "Backend /health is not ok after deploying ${GITHUB_SHA:0:7}: $h" \
  "$(jq -nc --arg b "$h" '[{check:"health",request:"GET /health",body:$b}]')"
echo "ok: $h"

echo "== n8n"
n=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "${INCIDENT_WEBHOOK_URL%/webhook/*}/healthz")
[ "$n" = 200 ] && echo "ok" || echo "warning: n8n /healthz returned $n"
echo "All healthy."
