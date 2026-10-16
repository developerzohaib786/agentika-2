#!/usr/bin/env bash
# Server side of the CI/CD loop. Run on the server from the repo root after `git pull`:
#   bash scripts/enable-cicd.sh <INCIDENT_WEBHOOK_TOKEN> [--real-rollback]
# - stores the webhook token in .env and as the n8n "Incident webhook token" credential
# - imports + publishes n8n/incident-responder.json (webhook now requires X-Incident-Token)
# - rebuilds the Incident MCP
# - with --real-rollback: ACC_DRY_RUN=false, so an approved Slack rollback really rebuilds the backend
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN=${1:?usage: bash scripts/enable-cicd.sh <INCIDENT_WEBHOOK_TOKEN> [--real-rollback]}
PROJECT_ID=${N8N_PROJECT_ID:-iSXJcCNwIs8wG0Bq}
WORKFLOW_ID=TQpLjt5JpmZrcu6e
n8n() { sudo docker compose exec -T -u node n8n n8n "$@" 2>&1 | grep -iE 'success|error|^publishing' || true; }

echo "== .env"
if grep -q '^INCIDENT_WEBHOOK_TOKEN=' .env; then
  sed -i "s/^INCIDENT_WEBHOOK_TOKEN=.*/INCIDENT_WEBHOOK_TOKEN=$TOKEN/" .env
else
  printf '\nINCIDENT_WEBHOOK_TOKEN=%s\n' "$TOKEN" >> .env
fi
if [ "${2:-}" = "--real-rollback" ]; then
  sed -i 's/^ACC_DRY_RUN=.*/ACC_DRY_RUN=false/' .env
fi
grep -E '^ACC_DRY_RUN=' .env

echo "== n8n credential (header auth for the webhook)"
CRED=$(mktemp); chmod 600 "$CRED"
printf '[{"id":"agIncidentHook01","name":"Incident webhook token","type":"httpHeaderAuth","data":{"name":"X-Incident-Token","value":"%s"}}]' "$TOKEN" > "$CRED"
sudo chown 1000:1000 "$CRED"
sudo docker compose cp "$CRED" n8n:/tmp/hook-cred.json >/dev/null 2>&1
sudo rm -f "$CRED"
n8n import:credentials --input=/tmp/hook-cred.json --projectId="$PROJECT_ID"
sudo docker compose exec -T -u root n8n rm -f /tmp/hook-cred.json

echo "== n8n workflow"
sudo docker compose cp n8n/incident-responder.json n8n:/tmp/incident-responder.json >/dev/null 2>&1
n8n import:workflow --input=/tmp/incident-responder.json --projectId="$PROJECT_ID"
n8n publish:workflow --id="$WORKFLOW_ID"
sudo docker compose exec -T -u root n8n rm -f /tmp/incident-responder.json

echo "== restart"
sudo docker compose up -d --build incident-mcp 2>&1 | tail -1
sudo docker compose restart n8n >/dev/null
sleep 30
sudo docker compose exec -T incident-mcp wget -qO- localhost:3001/healthz; echo
set -a; . ./.env; set +a
echo "webhook without token → $(curl -s -o /dev/null -w '%{http_code}' -X POST "https://$DOMAIN/webhook/incident" -H 'Content-Type: application/json' -d '{}') (expect 403)"
echo "Done."
