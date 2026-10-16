# Context: Current State

> Living document. Update it whenever server state, decisions or progress change, so a teammate (or an AI assistant) can pick up instantly.

**Last updated:** 2026-10-16
**Phase:** Day 0 / setup. Local scaffolding only, no server yet.

---

## Goal
Autonomous Incident Responder for the Agentika 2.0 hackathon (workflow automation track). Alert → triage → investigate → root cause → GitHub PR → Slack approval → merge/rollback → verify. See `README.md` for stack and approach.

Judging focus: real problem, multi-agent/MCP depth, reliability, clean live demo.

---

## Server state

| Item | Status | Value / notes |
|---|---|---|
| AWS account + budget alert | ⬜ TODO | |
| EC2 instance (Ubuntu 22.04, t3.micro/small) | ⬜ TODO | instance id: — |
| Elastic IP | ⬜ TODO | IP: — |
| Security group (80/443 open, 22 my IP only) | ⬜ TODO | |
| 2 GB swap | ⬜ TODO | |
| Docker + Compose installed | ⬜ TODO | |
| DuckDNS subdomain → Elastic IP | ⬜ TODO | domain: —.duckdns.org |
| Caddy HTTPS working | ⬜ TODO | |
| n8n running (SQLite) | ⬜ TODO | URL: https://—.duckdns.org |
| Alternate Clouds project + `acc` CLI login | ⬜ TODO | project id: — |
| Backend service on Alternate Clouds (GitHub, `backend/`) | 🟨 live, old commit | URL: https://alternate-silent-dust-5778-github-app.alternatefutures.ai · `/health` ✅ `/api/orders` ✅ `/internal/logs` 404 (redeploy latest + set `LOGS_TOKEN`) · service id: — |
| `LOGS_TOKEN` set on backend + Incident MCP | ⬜ TODO | |
| Incident MCP container (EC2) | ⬜ TODO | internal: http://incident-mcp:<port> · talks to backend via `BACKEND_URL` |
| GitHub MCP | ⬜ TODO | hosted endpoint + fine-grained PAT |
| Gemini key in n8n credentials | ⬜ TODO | Groq as backup |
| Slack app (Request URL → n8n webhook) | ⬜ TODO | Telegram fallback |
| Sentry project / fake alert curl | ⬜ TODO | |

Legend: ⬜ TODO · 🟨 in progress · ✅ done · ❌ blocked

---

## Code state

| Component | Status | Notes |
|---|---|---|
| `README.md` | ✅ | stack + approach |
| `context.md` | ✅ | this file |
| `backend/` Node.js app | ✅ scaffolded | Express; `/health`, `/version`, `/api/orders`; JSON logs to stdout + `LOG_FILE`; `node:test` smoke tests |
| `incident-mcp/` | ✅ built | Streamable HTTP at `http://incident-mcp:3001/mcp`. 5 tools; logs/health via `BACKEND_URL`, deploy history via GitHub API, rollback/restart via `acc` (`ACC_DRY_RUN=true` by default). E2E test passes |
| `docker-compose.yml` | ✅ | caddy, n8n (SQLite), incident-mcp |
| `Caddyfile` | ✅ | `{$DOMAIN} { reverse_proxy n8n:5678 }`. MCP is not public |
| `scripts/setup-server.sh` | ✅ | swap, Docker, DuckDNS, data dirs, `compose up` |
| `scripts/fake-alert.sh` | ✅ | POSTs a fake alert to `https://$DOMAIN/webhook/incident` |
| n8n workflow | ⬜ | owner: AI/Agent engineer |
| Demo "bad commit" scenario | ⬜ | candidate: break `orderTotal` in `backend/src/orders.js` |

---

## Key decisions
- n8n on **SQLite** (RAM budget). No Ollama on the box.
- LLM: **Gemini free tier**, Groq backup. Keep it to 3–5 tool calls per agent per incident.
- **2026-10-16: the backend moves to Alternate Clouds** (built from the GitHub repo, `backend/` root). EC2 keeps Caddy, n8n and the Incident MCP.
- With no shared volume, the backend keeps the last 1000 log lines in memory and serves them on `GET /internal/logs` (bearer `LOGS_TOKEN`). The Incident MCP calls that and `/health` over HTTPS via `BACKEND_URL`.
- `rollback_to_version` / `restart_service` → `acc services rebuild <id> --sha <commit>` / `acc services deploy <id>` from the Incident MCP, using `AF_TOKEN` + `AF_PROJECT_ID`.
- n8n talks to MCPs over **HTTP/SSE** (MCP Client Tool node). Stdio-only servers get wrapped with `supergateway`.
- Approve/Reject goes through the **n8n Slack node + webhook**, not the Slack MCP.

## n8n env (planned)
```
N8N_HOST=<name>.duckdns.org
N8N_PROTOCOL=https
WEBHOOK_URL=https://<name>.duckdns.org/
EXECUTIONS_DATA_PRUNE=true
```

## Open questions / risks
- t3.micro (1 GB) may be too tight for n8n + 3 services. Prefer t3.small if credits allow.
- Gemini free-tier rate limits during a live demo. Pre-record a backup.
- Alternate Clouds: not yet verified that `--kind github` honours `--port` / our `PORT=3000`, or how long a rebuild takes (affects the rollback part of the demo). Test early.
- Logs live in memory, so a redeploy or rollback wipes them. That's fine for the demo, since the evidence is gathered before the rollback.
- No custom domains on Alternate Clouds services yet. Use the `*-app.alternatefutures.ai` URL.

---

## Progress log
- **2026-10-16:** Created README.md, context.md, .env.example, .gitignore and the `backend/` Node.js template app.
- **2026-10-16:** `/health` now does content negotiation. Browsers get the dashboard page (`backend/public/health.html`); curl, n8n and the MCP get JSON (or force it with `?format=json`).

- **2026-10-16:** Stack change: the backend deploys to Alternate Clouds. Added `GET /internal/logs` + an in-memory log buffer, a test (`test/logs.test.js`), deploy steps in the README and new env vars in `.env.example`.

- **2026-10-16:** Backend live on Alternate Clouds (older commit). Built `incident-mcp/`, `docker-compose.yml`, `Caddyfile`, `scripts/setup-server.sh`, `scripts/fake-alert.sh`.

## Next steps
1. Push the repo to GitHub, rebuild the backend on Alternate Clouds, and set `LOGS_TOKEN` on it → `/internal/logs` returns 401 without the token instead of 404.
2. Provision EC2 (t3.small, 80/443 open, 22 my IP) + Elastic IP + DuckDNS subdomain.
3. On EC2: clone the repo, fill `.env`, run `bash scripts/setup-server.sh`.
4. n8n: create the owner account, add credentials (Gemini, Groq, Slack, GitHub MCP, Incident MCP at `http://incident-mcp:3001/mcp`).
5. Build the n8n workflow (Webhook → Triage → Investigator → Root-cause → Slack approval → action → Verifier).
6. Test `acc` from the MCP container, then set `ACC_DRY_RUN=false`.
