// /internal/logs is how the Incident MCP (on EC2) reads the backend's logs
// now that the backend runs on Alternate Clouds.
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');
const log = require('../src/logger');

async function withServer(fn) {
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('/internal/logs rejects requests without the token', async () => {
  process.env.LOGS_TOKEN = 'secret';
  await withServer(async (base) => {
    const res = await fetch(`${base}/internal/logs`);
    assert.strictEqual(res.status, 401);
  });
});

test('/internal/logs returns recent entries filtered by level', async () => {
  process.env.LOGS_TOKEN = 'secret';
  log.error('boom', { path: '/api/orders' });
  await withServer(async (base) => {
    const res = await fetch(`${base}/internal/logs?level=error&limit=5`, {
      headers: { Authorization: 'Bearer secret' },
    });
    assert.strictEqual(res.status, 200);
    const rows = await res.json();
    assert.ok(rows.length >= 1 && rows.length <= 5);
    assert.ok(rows.every((r) => r.level === 'error'));
    assert.strictEqual(rows.at(-1).msg, 'boom');
  });
});
