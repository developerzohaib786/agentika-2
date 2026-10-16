#!/usr/bin/env bash
# Waits until Alternate Clouds serves the commit we just deployed ($GITHUB_SHA via /version)
# and /health answers 200. The rebuild takes the service offline for 1-2 minutes.
set -uo pipefail
deadline=$(( $(date +%s) + ${DEPLOY_TIMEOUT_SEC:-720} ))
last=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  live=$(curl -fsS -m 10 "$BACKEND_URL/version" 2>/dev/null | jq -r '.commit // empty' 2>/dev/null)
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$BACKEND_URL/health?format=json")
  now="live=${live:-none} health=$code"
  [ "$now" != "$last" ] && echo "$(date -u +%H:%M:%S) $now" && last="$now"
  if [ "$live" = "$GITHUB_SHA" ] && [ "$code" = 200 ]; then
    echo "Commit ${GITHUB_SHA:0:7} is live."
    exit 0
  fi
  sleep 10
done
echo "FAILED_STAGE=deploy-timeout" >> "$GITHUB_ENV"
echo "FAILURE_SUMMARY=Commit ${GITHUB_SHA:0:7} never became live and healthy within ${DEPLOY_TIMEOUT_SEC:-720}s (last: $last)" >> "$GITHUB_ENV"
jq -n --arg s "$last" '[{check:"deploy", detail:$s}]' > "$RUNNER_TEMP/failed_checks.json"
exit 1
