// Structured JSON logger. Writes to stdout and to LOG_FILE, and keeps the last
// LOG_BUFFER_SIZE lines in memory. The backend runs on Alternate Clouds while the
// Incident MCP runs on EC2, so the MCP reads recent logs over HTTP
// (GET /internal/logs) instead of from a shared volume.
const fs = require('fs');
const path = require('path');

const LOG_FILE = process.env.LOG_FILE || path.join(__dirname, '..', 'logs', 'app.log');
const LOG_BUFFER_SIZE = Number(process.env.LOG_BUFFER_SIZE) || 1000;
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const buffer = [];

function write(level, msg, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: 'backend',
    version: process.env.APP_VERSION || 'dev',
    msg,
    ...meta,
  };
  const line = JSON.stringify(entry);
  console.log(line);
  stream.write(line + '\n');
  buffer.push(entry);
  if (buffer.length > LOG_BUFFER_SIZE) buffer.shift();
}

// Newest last. `level` filters (e.g. 'error'); `limit` caps the count.
function recent({ limit = 100, level } = {}) {
  const rows = level ? buffer.filter((e) => e.level === level) : buffer;
  return rows.slice(-limit);
}

module.exports = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  recent,
  LOG_FILE,
};
