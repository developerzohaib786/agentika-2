// The five Incident MCP tools. Tool descriptions are what the n8n agents read,
// so keep them short and explicit about when to call each one.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const backend = require('./backend');
const github = require('./github');
const acc = require('./acc');

const SHA = /^[0-9a-f]{7,40}$/i;

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] });
const safe = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (err) {
    return fail(err);
  }
};

function buildServer() {
  const server = new McpServer({ name: 'agentika-incident-mcp', version: '1.0.0' });

  server.registerTool(
    'get_health_status',
    {
      description:
        'Current health of the backend: status (ok/degraded/down), version, uptime, request and error counts, error rate, latency. Call first in triage and again to verify a fix.',
      inputSchema: {},
    },
    safe(() => backend.health())
  );

  server.registerTool(
    'get_recent_logs',
    {
      description:
        'Recent structured JSON log lines from the backend, newest last. Use level="error" to get stack traces for the investigation.',
      inputSchema: {
        limit: z.number().int().min(1).max(500).default(50).describe('How many lines to return'),
        level: z.enum(['info', 'warn', 'error']).optional().describe('Only return this level'),
      },
    },
    safe(({ limit, level }) => backend.logs({ limit, level }))
  );

  server.registerTool(
    'get_deploy_history',
    {
      description:
        'Recent commits to the backend repo (each one is a deploy on Alternate Clouds), newest first, plus the version currently running. Use to find the suspect commit and the last good commit to roll back to.',
      inputSchema: {
        limit: z.number().int().min(1).max(30).default(10),
      },
    },
    safe(async ({ limit }) => {
      const [running, commits] = await Promise.all([
        backend.version().catch((err) => ({ error: err.message })),
        github.backendCommits(limit),
      ]);
      return { repo: github.GITHUB_REPO, running, commits };
    })
  );

  server.registerTool(
    'rollback_to_version',
    {
      description:
        'Redeploy the backend from an earlier commit (the last known good one). Only call after a human approved it in Slack. Returns as soon as the deploy is started (it finishes in the background in ~2 min), so poll get_health_status until its version is this sha.',
      inputSchema: {
        sha: z.string().regex(SHA).describe('Commit SHA (7-40 hex chars) from get_deploy_history'),
        reason: z.string().max(500).describe('Why, for the audit trail'),
      },
    },
    safe(async ({ sha, reason }) => {
      console.log(JSON.stringify({ ts: new Date().toISOString(), msg: 'rollback_requested', sha, reason }));
      await github.assertRollbackTarget(sha);
      return { action: 'rollback', sha, ...(await acc.rebuildAt(sha)) };
    })
  );

  server.registerTool(
    'restart_service',
    {
      description:
        'Redeploy the backend on its current build (a restart). Use when the app is down but no bad commit is involved. Only after human approval. Returns as soon as the redeploy is started (~2 min in the background); poll get_health_status.',
      inputSchema: {
        reason: z.string().max(500),
      },
    },
    safe(async ({ reason }) => {
      console.log(JSON.stringify({ ts: new Date().toISOString(), msg: 'restart_requested', reason }));
      return { action: 'restart', ...(await acc.redeploy()) };
    })
  );

  return server;
}

module.exports = { buildServer };
