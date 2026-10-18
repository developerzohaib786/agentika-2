# Agentika 2.0: Autonomous Incident Responder 

A hackathon project (2 days, team of 2). A multi-agent DevOps workflow takes a production alert, triages it, investigates logs, commits and deploys, proposes a fix as a GitHub PR, and waits for a human to approve or reject it in Slack or Telegram.

**Demo:** we break the deployed app live with a bad commit, and the agents find the cause, open a fix PR and roll back or merge after approval.

---

## How it works

```
Sentry alert / curl fake alert
          │  (HTTPS webhook)
          ▼
        n8n ──► Triage agent ─────► severity (P1–P4), dedupe
          │
          ├──► Investigator agent ─► Incident MCP: logs, health, deploy history
          │                         GitHub MCP:   recent commits, diffs
          │
          ├──► Root-cause agent ───► hypothesis + patch + rollback plan
          │                         GitHub MCP: branch + PR
          │
          └──► Slack/Telegram ──────► [Approve] [Reject]
                    │
          Approve ──┴─► merge PR or rollback_to_version, then verify /health
          Reject  ────► escalate to a human (on-call mention)
```

### Agents
| Agent | Input | Tools (MCP) | Output |
|---|---|---|---|
| Triage | Alert JSON | `get_health_status` | severity, affected service, go/no-go |
| Investigator | Triage result | `get_recent_logs`, `get_deploy_history`, GitHub `list_commits`, `get_commit` | evidence bundle (stack trace, suspect commit) |
| Root-cause | Evidence bundle | GitHub `create_branch`, `create_or_update_file`, `create_pull_request` | PR URL, explanation, rollback plan |
| Verifier (on approve) | Action taken | `get_health_status`, `restart_service` | confirmed fixed, or escalate |

Budget: **3–5 tool calls per agent per incident** to stay inside free LLM rate limits.

---

## Free tech stack ($0)

| Layer | Choice | Why / free tier |
|---|---|---|
| Server (orchestration) | AWS EC2 Ubuntu 22.04, t3.micro/t3.small + Elastic IP | Runs Caddy, n8n and the Incident MCP. Free plan credits. Add 2 GB swap. |
| Backend hosting | **Alternate Clouds** (`acc` CLI), built from this GitHub repo (`backend/`) | Public URL `https://<slug>-app.alternatefutures.ai`. Rollback = `acc services rebuild --sha <good-commit>` |
| Containers | Docker + Docker Compose (on EC2) | One `docker compose up` for caddy, n8n, incident-mcp |
| Reverse proxy / TLS | Caddy | Automatic Let's Encrypt certs |
| Domain | DuckDNS subdomain | Free dynamic DNS |
| Orchestration | n8n (self-hosted, SQLite) | AI Agent node + MCP Client Tool node, webhooks, Slack node |
| LLM | Google Gemini API (free tier) | Backup: Groq (free tier) |
| MCP: code | GitHub MCP (`github/github-mcp-server`) | Commits, diffs, branches, PRs, merge. Fine-grained PAT |
| MCP: ops | **Custom Incident MCP** (Node.js, `@modelcontextprotocol/sdk`) | Our differentiator: logs, health, deploys, rollback, restart |
| App under test | Node.js 20 + Express (`backend/`) | Structured JSON logs, `/health`, demo bug surface |
| Alerts | Sentry (free) or a fake alert via curl/Postman | |
| Human approval | Slack free app (interactive buttons) | Fallback: Telegram bot |
| Code host / CI | GitHub free + GitHub Actions | Runs `npm test` on the fix PR |

Not used on purpose: Ollama or any local LLM (not enough RAM), Postgres for n8n (SQLite is enough).

---

## Approach

1. **One ugly end-to-end path first (Day 1).** Fake alert → n8n → one agent → Incident MCP → Slack message. Then add agents one at a time.
2. **MCP before prompts.** Build and test the Incident MCP from n8n's MCP Client Tool before writing any agent logic.
3. **Deterministic demo data.** The backend keeps its recent structured JSON logs in memory and serves them on `GET /internal/logs` (bearer `LOGS_TOKEN`); the MCP reads real logs over HTTPS, with mock fallback.
4. **Human in the loop.** Nothing merges or rolls back without an Approve click. Reject escalates.
5. **Self-verification.** After any action the verifier checks `/health` and the error rate. If it isn't fixed, it rolls back and escalates.
6. **Rate-limit aware.** Few, focused tool calls; short prompts; Groq fallback credential in n8n.
7. **Backup demo.** Pre-record a full run on Day 2 in case the live demo or Wi-Fi fails.

## CI/CD

`.github/workflows/ci-cd.yml`, one job (~3 min) on every push to `main`:

1. **Deploy backend**: `acc services rebuild <service> --sha <commit>` (+ `GIT_SHA` so `/version` shows it).
2. **Deploy n8n server**: SSH to EC2 → `git reset --hard origin/main` → `docker compose up -d --build` (re-imports the n8n workflow only if `n8n/` changed).
3. **Health check** (`scripts/ci/health-check.sh`): new commit live → `/api/orders` 200 → `/health` ok → n8n up.
4. **Unhealthy** → `scripts/ci/report-incident.sh` POSTs to `https://<domain>/webhook/incident` (header `X-Incident-Token`) and the agents take over: investigate → fix PR → Slack **Approve rollback**.

GitHub → Settings → Secrets and variables → Actions:
- Secrets: `AF_TOKEN`, `AF_PROJECT_ID`, `AF_BACKEND_SERVICE_ID`, `INCIDENT_WEBHOOK_TOKEN`, `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`
- Variables: `BACKEND_URL`, `INCIDENT_WEBHOOK_URL`
- EC2 security group must allow SSH (22) from GitHub runners.

---

## Repo layout

```
agentika2.0/
├── README.md          ← this file: stack + approach
├── context.md         ← live server state, decisions, progress (keep updated!)
├── .env.example       ← secrets template (real .env stays on the server)
├── backend/           ← Node.js app under test (Express)
│   ├── src/index.js   ← entry point
│   ├── src/app.js     ← routes: /health, /version, /api/orders
│   ├── src/orders.js  ← business logic, the file we break in the demo
│   ├── src/logger.js  ← JSON logs → stdout + logs/app.log
│   ├── test/          ← node:test smoke tests
│   └── Dockerfile
├── incident-mcp/      ← custom MCP server (Streamable HTTP, :3001/mcp)
├── scripts/           ← setup-server.sh (EC2 bootstrap), fake-alert.sh
├── docker-compose.yml ← caddy, n8n, incident-mcp (backend is on Alternate Clouds)
└── Caddyfile          ← public HTTPS → n8n only
```

---

## Run the backend locally

```bash
cd backend
npm install
npm run dev          # http://localhost:3000
npm test
```

Endpoints:
- `GET /health`: status, version, uptime, request/error counts, error rate
- `GET /version`: app version + git SHA
- `GET /api/orders` and `GET /api/orders/:id`: demo business endpoints

- `GET /internal/logs?limit=100&level=error`: recent logs for the Incident MCP. Needs `Authorization: Bearer $LOGS_TOKEN`; returns 401 if `LOGS_TOKEN` is unset.

Env vars: `PORT` (3000), `APP_VERSION`, `GIT_SHA`, `LOG_FILE` (default `backend/logs/app.log`), `LOGS_TOKEN`, `LOG_BUFFER_SIZE` (1000).

## Deploy the backend to Alternate Clouds

```bash
npm install -g @alternatefutures/acc
acc login
acc projects create --name agentika     # once
acc services create --kind github --repo <owner>/<repo> --branch main \
  --root-directory backend \
  --build-command "npm ci --omit=dev" --start-command "node src/index.js" \
  --name backend --env PORT=3000 --env NODE_ENV=production \
  --env APP_VERSION=1.0.0 --env LOGS_TOKEN=<secret> -y
acc services list                       # public URL → BACKEND_URL in .env on EC2
acc services logs backend --tail 100
acc services rebuild backend --sha <commit>   # redeploy/roll back to a commit
```

Notes: custom domains aren't supported for services yet, so use the `*-app.alternatefutures.ai` URL. Don't rely on `LOG_FILE` surviving a redeploy.

---

## Team split
- **Developer:** EC2, Docker, Caddy, backend (Alternate Clouds), Incident MCP, GitHub/Slack integrations.
- **AI/Agent engineer:** agent prompts, n8n workflow, evals, demo script.

## Security
- Secrets only in `.env` on the server or in n8n credentials. Never commit them.
- Port 22 only from your IP; 80/443 public.
- Set an AWS budget alert, and stop the instance after the hackathon.

## Credtis
[DevoraCamp](https://devoracamp.com)
