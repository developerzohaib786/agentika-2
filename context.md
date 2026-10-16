# Context: Current State

> Living document. Update it whenever server state, decisions or progress change, so a teammate (or an AI assistant) can pick up instantly.

**Last updated:** 2026-10-16
**Phase:** Day 0 / setup. Server is up (EC2 + n8n + Incident MCP). Next: n8n credentials + workflow.

---

## Goal
Autonomous Incident Responder for the Agentika 2.0 hackathon (workflow automation track). Alert → triage → investigate → root cause → GitHub PR → Slack approval → merge/rollback → verify. See `README.md` for stack and approach.

Judging focus: real problem, multi-agent/MCP depth, reliability, clean live demo.

---

## Server state

| Item | Status | Value / notes |
|---|---|---|
| AWS account + budget alert | ⬜ budget alert? | |
| EC2 instance | ✅ | **Amazon Linux 2023**, 2 vCPU / 7.8 GB, 32 GB disk · SSH `ec2-user@3.83.158.94` with `agentika2.pem` · repo at `~/agentika-2` |
| Elastic IP | ❓ confirm | IP: 3.83.158.94 (if not elastic, it changes on stop/start → rerun DuckDNS update) |
| Security group (80/443 open, 22 my IP only) | ✅ 80/443 reachable | |
| 2 GB swap | ✅ | |
| Docker + Compose installed | ✅ | dnf docker + compose v2.32.4 / buildx v0.19.3 plugins |
| DuckDNS subdomain → server IP | ✅ | agentika.duckdns.org → 3.83.158.94 |
| Caddy HTTPS working | ✅ | Let's Encrypt cert obtained |
| n8n running (SQLite) | ✅ | https://agentika.duckdns.org (owner account: TODO) |
| Alternate Clouds project + `acc` CLI login | ✅ | project `agentika` = cmvay0omf01ho9u1rl24ygd7y · PAT `agentika-ec2` in server + local `.env` |
| Backend service on Alternate Clouds (GitHub, `backend/`) | ✅ live (root `backend/`) | URL: https://alternate-silent-dust-5778-github-app.alternatefutures.ai · `/health` ✅ `/api/orders` ✅ `/internal/logs` ✅ (bearer `LOGS_TOKEN`) · service id: cmvay3rjk01k19u1rqgzm1z1q · leftover `cyber-burst-9105` (cmvay0oz801hr9u1r2b4ss814) is stopped |
| `LOGS_TOKEN` set on backend + Incident MCP | ✅ | same value on Alternate Clouds, server `.env`, local `.env` |
| Incident MCP container (EC2) | ✅ | `http://incident-mcp:3001/mcp`, bearer `MCP_TOKEN` (in server `.env`). Verified live: health ✅ logs ✅ deploy history ✅ · `acc` authenticated in container ✅ · `ACC_DRY_RUN=true` (real rebuild not tested yet) |
| GitHub MCP | ✅ | hosted `https://api.githubcopilot.com/mcp/`, PAT verified (has admin on repo, narrower later) |
| n8n credentials | ✅ | Gemini, Groq, Slack agentika bot, Incident MCP token, GitHub MCP (PAT) |
| Slack app | ✅ | bot `agentika` in workspace Agentika 2.0. Approval via n8n Send-and-Wait (no Request URL needed). Channel #all-agentika-20 (C0C9NB3RBS5) |
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
| CI/CD (`.github/workflows/ci-cd.yml`) | 🟨 simplified, not pushed | one job: acc rebuild backend → SSH deploy EC2 (git reset + compose up; n8n import only if `n8n/` changed) → `scripts/ci/health-check.sh` → on failure report incident to n8n. Needs secrets SERVER_HOST/USER/SSH_KEY + SG port 22 open to GitHub |
| n8n workflow | ✅ published, tested | `n8n/incident-responder.json` → n8n id `TQpLjt5JpmZrcu6e`, 30 nodes. Webhook `POST /webhook/incident`. 3 agents on **Gemini 3.8 Flash** (Groq `openai/gpt-oss-120b` fallback) → evidence guard → Slack approval (#all-agentika-20) → MCP rollback → health-poll verifier. Runs: #2 full path (dry run), #3 no-evidence path ✅ |
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

- **2026-10-16:** Single repo at the project root (`developerzohaib786/agentika-2`, backend in `backend/`). Alternate Clouds rebuilt from `backend/`, `/internal/logs` → 401 ✅.
- **2026-10-16:** EC2 (Amazon Linux 2023) set up via `scripts/setup-server.sh` (now supports dnf). Caddy TLS ✅, n8n ✅ at https://agentika.duckdns.org, Incident MCP ✅ (health + deploy history live).

- **2026-10-16:** Workflow live. Fixes after test run #2: (1) agents invented a cause with no error logs and opened PR #1, so added the `evidence_found` guard (no evidence → Slack to human, no PR); (2) the MCP now refuses rollbacks older than `ROLLBACK_FLOOR_SHA` (160cd4d, the first commit with the `backend/` layout); (3) dry-run/failed rollbacks are reported honestly. `gemini-2.5-flash` is not available to new keys, and Groq dropped llama-3.3.

- **2026-10-16:** CI/CD added. Smoke script tested in a container: healthy → 6/6 ok; broken `orderTotal` → 4 failures + health degraded. The MCP rollback now also sets `GIT_SHA`. Server step (`enable-cicd.sh`: webhook token + `ACC_DRY_RUN=false`) must be run by the user (blocked by the permission classifier).

- **2026-10-16:** Root cause of the CI deploy timeouts: the Alternate Clouds service still builds from the repo root (the image was from `97f150a`). Every build after the `backend/` move had no app at the root. Fix: root `Dockerfile` that builds `backend/` (verified on the server). The SSH deploy failed because the `SERVER_USER`/`SERVER_HOST` secrets were empty; the step is now continue-on-error, and only health-check failures report incidents.

## Next steps
1. Test one real `acc services rebuild` (ACC_DRY_RUN=false), then keep it off until the demo.
2. Commit + push local changes (setup-server.sh, MCP health fix). On the server: `git checkout . && git pull`.
3. Create the n8n owner account.
4. n8n: create the owner account, add credentials (Gemini, Groq, Slack, GitHub MCP, Incident MCP at `http://incident-mcp:3001/mcp`).
5. Build the n8n workflow (Webhook → Triage → Investigator → Root-cause → Slack approval → action → Verifier).
6. Test `acc` from the MCP container, then set `ACC_DRY_RUN=false`.
