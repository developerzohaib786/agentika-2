// Structured JSON logger. Writes to stdout and to LOG_FILE so the Incident MCP
// can read recent logs without needing access to the Docker socket.
const fs = require('fs');
const path = require('path');

const LOG_FILE = process.env.LOG_FILE || path.join(__dirname, '..', 'logs', 'app.log');
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function write(level, msg, meta = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: 'backend',
    version: process.env.APP_VERSION || 'dev',
    msg,
    ...meta,
  });
  console.log(line);
  stream.write(line + '\n');
}

module.exports = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  LOG_FILE,
};
