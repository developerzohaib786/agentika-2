// HTTP client for the backend on Alternate Clouds. The MCP runs on EC2, so
// everything goes over HTTPS: /health, /version and /internal/logs.
const BACKEND_URL = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
const LOGS_TOKEN = process.env.LOGS_TOKEN || '';
const TIMEOUT_MS = Number(process.env.BACKEND_TIMEOUT_MS) || 10000;

async function getJson(path, headers = {}) {
  if (!BACKEND_URL) throw new Error('BACKEND_URL is not set');
  const t0 = Date.now();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 500);
  }
  return { status: res.status, ms, body };
}

async function health() {
  try {
    const r = await getJson('/health?format=json');
    if (r.status !== 200 || typeof r.body !== 'object') {
      // e.g. 503 "no active deployment" from the Alternate Clouds proxy.
      return { reachable: true, status: 'down', httpStatus: r.status, latencyMs: r.ms, detail: r.body };
    }
    return { reachable: true, httpStatus: r.status, latencyMs: r.ms, ...r.body };
  } catch (err) {
    // Unreachable is itself a P1 signal for the triage agent, so report it, don't throw.
    return { reachable: false, status: 'down', error: err.message };
  }
}

async function version() {
  const r = await getJson('/version');
  return r.body;
}

async function logs({ limit, level }) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (level) qs.set('level', level);
  const r = await getJson(`/internal/logs?${qs}`, { Authorization: `Bearer ${LOGS_TOKEN}` });
  if (r.status !== 200) {
    throw new Error(`backend /internal/logs returned ${r.status} (check LOGS_TOKEN on both sides and that the backend is on the latest commit)`);
  }
  return r.body;
}

module.exports = { health, version, logs, BACKEND_URL };
