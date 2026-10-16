// End to end: a real backend + the MCP over Streamable HTTP + an MCP client,
// the same path n8n's MCP Client Tool node takes.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { createApp: createBackend } = require(path.join(__dirname, '..', '..', 'backend', 'src', 'app'));

test('incident MCP tools against a live backend', async (t) => {
  process.env.LOGS_TOKEN = 'test-token';
  const backend = createBackend().listen(0);
  process.env.BACKEND_URL = `http://127.0.0.1:${backend.address().port}`;
  process.env.AF_BACKEND_SERVICE_ID = 'svc-test';
  process.env.BACKEND_IMAGE = 'ghcr.io/x/agentika-backend';
  delete process.env.ACC_DRY_RUN; // default: dry run

  const { createApp } = require('../src/index');
  const mcp = createApp().listen(0);
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcp.address().port}/mcp`)));

  t.after(async () => {
    await client.close();
    mcp.close();
    backend.close();
  });

  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError, data: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
  };

  const { tools } = await client.listTools();
  assert.deepStrictEqual(tools.map((x) => x.name).sort(), [
    'get_deploy_history', 'get_health_status', 'get_recent_logs', 'restart_service', 'rollback_to_version',
  ]);

  await fetch(`${process.env.BACKEND_URL}/api/orders`);

  const health = await call('get_health_status');
  assert.strictEqual(health.data.reachable, true);
  assert.strictEqual(health.data.status, 'ok');

  const logs = await call('get_recent_logs', { limit: 10 });
  assert.ok(Array.isArray(logs.data));
  assert.ok(logs.data.some((l) => l.path === '/api/orders'));

  const rollback = await call('rollback_to_version', { sha: 'abc1234', reason: 'test' });
  assert.strictEqual(rollback.data.dryRun, true);
  assert.match(rollback.data.command, /services env set svc-test GIT_SHA abc1234 && .*services deploy svc-test --image ghcr\.io\/x\/agentika-backend:abc1234 -y/);

  const badSha = await client.callTool({ name: 'rollback_to_version', arguments: { sha: 'x; rm -rf /', reason: 't' } });
  assert.ok(badSha.isError);
});

test('get_health_status reports a non-200 backend as down', async () => {
  const http = require('http');
  const proxy = http.createServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Service Unavailable', message: 'This service exists but has no active deployment.' }));
  }).listen(0);
  process.env.BACKEND_URL = `http://127.0.0.1:${proxy.address().port}`;
  delete require.cache[require.resolve('../src/backend')];
  const backend = require('../src/backend');
  const h = await backend.health();
  proxy.close();
  assert.strictEqual(h.status, 'down');
  assert.strictEqual(h.httpStatus, 503);
});
