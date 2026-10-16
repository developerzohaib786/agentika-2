#!/usr/bin/env bash
# Hits the real endpoints of the freshly deployed backend. Each request is repeated so
# the backend's error rate (what the triage agent reads) reflects the breakage, and the
# 500s leave stack traces in /internal/logs for the investigator agent.
set -uo pipefail
failed='[]'
check() { # name, path, expected status, jq test on the body (optional)
  local name=$1 path=$2 want=$3 test=${4:-}
  for i in 1 2 3; do
    local body code
    body=$(curl -s -m 15 -w '\n%{http_code}' "$BACKEND_URL$path")
    code=${body##*$'\n'}; body=${body%$'\n'*}
    if [ "$code" != "$want" ] || { [ -n "$test" ] && ! echo "$body" | jq -e "$test" >/dev/null 2>&1; }; then
      echo "FAIL $name: GET $path → $code (want $want) ${body:0:200}"
      failed=$(jq -c --arg n "$name" --arg p "$path" --arg c "$code" --arg w "$want" --arg b "${body:0:300}" \
        '. + [{check:$n, request:("GET " + $p), status:($c|tonumber? // $c), expected:($w|tonumber), body:$b}]' <<<"$failed")
      return
    fi
  done
  echo "ok   $name"
}

check orders_list    /api/orders       200 'type == "array" and length > 0 and all(.total | type == "number")'
check order_1        /api/orders/1     200 '.id == 1 and (.total | type == "number")'
check order_2        /api/orders/2     200 '.id == 2 and (.total | type == "number")'
check order_empty    /api/orders/3     200 '.total == 0'
check order_missing  /api/orders/999   404
check health         '/health?format=json' 200 '.status == "ok"'

echo "$failed" > "$RUNNER_TEMP/failed_checks.json"
n=$(jq length <<<"$failed")
if [ "$n" -gt 0 ]; then
  echo "FAILED_STAGE=smoke-test" >> "$GITHUB_ENV"
  echo "FAILURE_SUMMARY=$n smoke check(s) failed after deploying ${GITHUB_SHA:0:7}: $(jq -r '[.[] | "\(.request) → \(.status)"] | join(", ")' <<<"$failed")" >> "$GITHUB_ENV"
  exit 1
fi
echo "All smoke checks passed."
