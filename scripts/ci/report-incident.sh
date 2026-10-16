#!/usr/bin/env bash
# Sends the failed deploy to the n8n incident workflow (authenticated with X-Incident-Token).
set -euo pipefail
stage=${FAILED_STAGE:-deploy}
summary=${FAILURE_SUMMARY:-"Deploying ${GITHUB_SHA:0:7} failed (acc rebuild error), see the CI run"}
checks="$RUNNER_TEMP/failed_checks.json"; [ -s "$checks" ] || echo '[]' > "$checks"
payload=$(jq -n \
  --arg title "$summary" --arg stage "$stage" --arg url "$BACKEND_URL" \
  --arg commit "$GITHUB_SHA" --arg prev "${PREVIOUS_SHA:-}" --arg run "$RUN_URL" \
  --arg actor "$GITHUB_ACTOR" --arg msg "$(git log -1 --pretty=%s "$GITHUB_SHA")" \
  --slurpfile checks "$checks" \
  '{source:"ci-cd", service:"backend", title:$title, stage:$stage, url:$url,
    commit:$commit, commit_message:$msg, previous_sha:$prev, pushed_by:$actor,
    run_url:$run, failed_checks:$checks[0], timestamp:(now|todate)}')
echo "$payload" | jq .
curl -fsS -m 20 -X POST "$INCIDENT_WEBHOOK_URL" \
  -H 'Content-Type: application/json' -H "X-Incident-Token: $INCIDENT_WEBHOOK_TOKEN" \
  -d "$payload"
echo
echo "Incident reported. Watch Slack for the rollback approval."
