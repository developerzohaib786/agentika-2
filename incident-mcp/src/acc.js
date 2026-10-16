// Operates the backend service on Alternate Clouds through the `acc` CLI.
// Auth comes from AF_TOKEN + AF_PROJECT_ID in the environment.
// ACC_DRY_RUN=true (the default) only reports the command it would run, so
// nothing is redeployed until you have tested the CLI on the server.
const { execFile } = require('child_process');

const SERVICE_ID = process.env.AF_BACKEND_SERVICE_ID || '';
const DRY_RUN = process.env.ACC_DRY_RUN !== 'false';
const ACC_BIN = process.env.ACC_BIN || 'acc';

function run(args) {
  if (!SERVICE_ID) return Promise.reject(new Error('AF_BACKEND_SERVICE_ID is not set'));
  const command = [ACC_BIN, ...args].join(' ');
  if (DRY_RUN) return Promise.resolve({ dryRun: true, command });
  return new Promise((resolve, reject) => {
    execFile(ACC_BIN, args, { timeout: 120000, env: process.env }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${command} failed: ${stderr || err.message}`.trim()));
      resolve({ dryRun: false, command, output: stdout.trim() });
    });
  });
}

// Rebuild the backend from a specific commit: our rollback. GIT_SHA first so
// /version reports the commit that is really running (CI does the same on deploy).
async function rebuildAt(sha) {
  const env = await run(['services', 'env', 'set', SERVICE_ID, 'GIT_SHA', sha]);
  const rebuild = await run(['services', 'rebuild', SERVICE_ID, '--sha', sha]);
  return DRY_RUN ? { dryRun: true, command: `${env.command} && ${rebuild.command}` } : rebuild;
}
// Redeploy the current build: our restart.
const redeploy = () => run(['services', 'deploy', SERVICE_ID, '-y']);

module.exports = { rebuildAt, redeploy, DRY_RUN };
