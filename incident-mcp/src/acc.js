// Operates the backend service on Alternate Clouds through the `acc` CLI.
// Auth comes from AF_TOKEN + AF_PROJECT_ID in the environment.
// ACC_DRY_RUN=true (the default) only reports the command it would run, so
// nothing is redeployed until you have tested the CLI on the server.
//
// `acc services deploy` blocks for ~2 min (lease + rollout), longer than the MCP
// client in n8n waits (-32001 "Request timed out"). So the deploy is started in the
// background and the tool returns at once; the caller polls /version + /health.
const { spawn: realSpawn } = require('child_process');

const ENV_SET_TIMEOUT_MS = 60 * 1000;
const DEPLOY_MAX_MS = 15 * 60 * 1000; // safety net so a hung CLI cannot block later deploys

const log = (msg, meta = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...meta }));

function createAcc({ env = process.env, spawn = realSpawn } = {}) {
  const SERVICE_ID = env.AF_BACKEND_SERVICE_ID || '';
  const DRY_RUN = env.ACC_DRY_RUN !== 'false';
  const ACC_BIN = env.ACC_BIN || 'acc';
  const BACKEND_IMAGE = env.BACKEND_IMAGE || '';
  let inFlight = null; // { command, startedAt } while a background deploy runs

  // Start `acc <args>`; resolves { code, stdout, stderr } when it exits (or is killed after maxMs).
  function launch(args, maxMs) {
    const child = spawn(ACC_BIN, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    const done = new Promise((resolve) => {
      const timer = setTimeout(() => {
        stderr += `\nkilled after ${maxMs}ms`;
        child.kill();
      }, maxMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: stderr + err.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
    return done;
  }

  const cmd = (args) => [ACC_BIN, ...args].join(' ');

  async function runQuick(args) {
    const r = await launch(args, ENV_SET_TIMEOUT_MS);
    if (r.code !== 0) throw new Error(`${cmd(args)} failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    return r.stdout.trim();
  }

  // Fire-and-forget: log the outcome, free the lock, return immediately.
  function startDeploy(args, meta) {
    const command = cmd(args);
    if (inFlight) return { started: false, alreadyRunning: true, command: inFlight.command, startedAt: inFlight.startedAt };
    inFlight = { command, startedAt: new Date().toISOString() };
    log('deploy_started', { command, ...meta });
    launch(args, DEPLOY_MAX_MS).then((r) => {
      inFlight = null;
      log(r.code === 0 ? 'deploy_finished' : 'deploy_failed', {
        command,
        code: r.code,
        output: (r.stderr || r.stdout).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim().slice(-400),
      });
    });
    return { started: true, command, startedAt: inFlight.startedAt };
  }

  // CI pushes one image per commit (BACKEND_IMAGE:<full sha>), so a rollback just
  // redeploys an older image. GIT_SHA first so /version reports the commit that is
  // really running (CI does the same on deploy).
  async function rebuildAt(sha) {
    if (!SERVICE_ID) throw new Error('AF_BACKEND_SERVICE_ID is not set');
    if (!BACKEND_IMAGE) throw new Error('BACKEND_IMAGE is not set');
    const envArgs = ['services', 'env', 'set', SERVICE_ID, 'GIT_SHA', sha];
    const deployArgs = ['services', 'deploy', SERVICE_ID, '--image', `${BACKEND_IMAGE}:${sha}`, '-y'];
    if (DRY_RUN) return { dryRun: true, command: `${cmd(envArgs)} && ${cmd(deployArgs)}` };
    if (inFlight) return { dryRun: false, started: false, alreadyRunning: true, command: inFlight.command, startedAt: inFlight.startedAt };
    await runQuick(envArgs);
    return { dryRun: false, ...startDeploy(deployArgs, { sha }), note: 'Deploy runs in the background (~2 min). Poll /version for this sha and /health.' };
  }

  // Redeploy the current build: our restart.
  async function redeploy() {
    if (!SERVICE_ID) throw new Error('AF_BACKEND_SERVICE_ID is not set');
    const args = ['services', 'deploy', SERVICE_ID, '-y'];
    if (DRY_RUN) return { dryRun: true, command: cmd(args) };
    return { dryRun: false, ...startDeploy(args, {}), note: 'Redeploy runs in the background (~2 min). Poll /health.' };
  }

  return { rebuildAt, redeploy, DRY_RUN };
}

module.exports = { ...createAcc(), createAcc };
