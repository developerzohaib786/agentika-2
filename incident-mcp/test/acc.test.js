// The rollback tool must return before `acc services deploy` finishes (~2 min),
// otherwise n8n's MCP client times out with -32001 even though the deploy succeeds.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createAcc } = require('../src/acc');

const SHA = 'f29da8c420d4cc775dcfc52f28e1fc3246d2357a';
const ENV = {
  AF_BACKEND_SERVICE_ID: 'svc1',
  BACKEND_IMAGE: 'ghcr.io/x/agentika-backend',
  ACC_DRY_RUN: 'false',
};

// A fake `acc` process: the test decides when (and how) each one exits.
function fakeSpawn() {
  const calls = [];
  const spawn = (bin, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit('close', null);
    child.finish = (code = 0, stderr = '') => {
      if (stderr) child.stderr.emit('data', stderr);
      child.emit('close', code);
    };
    calls.push({ bin, args, child });
    return child;
  };
  return { spawn, calls };
}
const tick = () => new Promise((r) => setImmediate(r));

test('rollback returns as soon as the deploy is started, not when it finishes', async () => {
  const { spawn, calls } = fakeSpawn();
  const acc = createAcc({ env: ENV, spawn });

  const pending = acc.rebuildAt(SHA);
  await tick();
  assert.deepStrictEqual(calls[0].args, ['services', 'env', 'set', 'svc1', 'GIT_SHA', SHA]);
  calls[0].child.finish(0); // env set is quick

  const result = await pending; // resolves while the deploy process is still running
  assert.strictEqual(result.started, true);
  assert.strictEqual(result.dryRun, false);
  assert.deepStrictEqual(calls[1].args, ['services', 'deploy', 'svc1', '--image', `ghcr.io/x/agentika-backend:${SHA}`, '-y']);
  assert.strictEqual(calls.length, 2);

  calls[1].child.finish(0);
  await tick();
});

test('a second rollback while one is deploying does not start another deploy', async () => {
  const { spawn, calls } = fakeSpawn();
  const acc = createAcc({ env: ENV, spawn });

  const first = acc.rebuildAt(SHA);
  await tick();
  calls[0].child.finish(0);
  await first;

  const second = await acc.rebuildAt(SHA);
  assert.strictEqual(second.started, false);
  assert.strictEqual(second.alreadyRunning, true);
  assert.strictEqual(calls.length, 2, 'no extra env-set or deploy process');

  // once the first deploy exits, the next rollback is allowed again
  calls[1].child.finish(0);
  await tick();
  const third = acc.rebuildAt(SHA);
  await tick();
  assert.strictEqual(calls.length, 3);
  calls[2].child.finish(0);
  await third;
  calls[3].child.finish(0);
  await tick();
});

test('a failing `env set` rejects and never starts the deploy', async () => {
  const { spawn, calls } = fakeSpawn();
  const acc = createAcc({ env: ENV, spawn });

  const pending = acc.rebuildAt(SHA);
  await tick();
  calls[0].child.finish(1, 'not logged in');
  await assert.rejects(pending, /not logged in/);
  assert.strictEqual(calls.length, 1);
});

test('dry run never spawns anything', async () => {
  const { spawn, calls } = fakeSpawn();
  const acc = createAcc({ env: { ...ENV, ACC_DRY_RUN: 'true' }, spawn });
  const r = await acc.rebuildAt(SHA);
  assert.strictEqual(r.dryRun, true);
  assert.match(r.command, /env set svc1 GIT_SHA .* && .*deploy svc1 --image ghcr\.io\/x\/agentika-backend:/);
  assert.strictEqual(calls.length, 0);
});
