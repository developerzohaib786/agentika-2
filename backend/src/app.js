const path = require('path');
const express = require('express');
const log = require('./logger');
const { listOrders, getOrder } = require('./orders');

const startedAt = Date.now();
const stats = { requests: 0, errors: 0 };

function createApp() {
  const app = express();
  app.use(express.json());

  // A browser opening /health (not a JSON health check).
  const wantsDashboard = (req) =>
    req.query.format !== 'json' && req.accepts(['json', 'html']) === 'html';
  // The dashboard's Refresh button tags its check so a click counts like a page refresh.
  const isManualCheck = (req) => req.get('X-Health-Check') === 'manual';

  // Request logging + counters (feeds get_health_status in the Incident MCP).
  // Automatic JSON polls of the monitoring endpoints (dashboard auto-refresh,
  // agents, curl) are skipped so they don't inflate the stats or flood the logs.
  // Opening the dashboard page or clicking Refresh still counts.
  const MONITORING_PATHS = new Set(['/health', '/version']);
  app.use((req, res, next) => {
    if (MONITORING_PATHS.has(req.path) && !wantsDashboard(req) && !isManualCheck(req)) return next();
    const t0 = Date.now();
    stats.requests++;
    res.on('finish', () => {
      if (res.statusCode >= 500) stats.errors++;
      log.info('request', { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t0 });
    });
    next();
  });

  // Browsers get the dashboard page; curl, n8n and the Incident MCP get JSON.
  // Force JSON with ?format=json.
  app.get('/health', (req, res) => {
    if (wantsDashboard(req)) {
      return res.sendFile(path.join(__dirname, '..', 'public', 'health.html'));
    }
    const errorRate = stats.requests ? stats.errors / stats.requests : 0;
    res.json({
      status: errorRate > 0.2 ? 'degraded' : 'ok',
      version: process.env.APP_VERSION || 'dev',
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      requests: stats.requests,
      errors: stats.errors,
      errorRate: Number(errorRate.toFixed(3)),
    });
  });

  app.get('/version', (req, res) => {
    res.json({ version: process.env.APP_VERSION || 'dev', commit: process.env.GIT_SHA || 'unknown' });
  });

  // Recent logs for the Incident MCP (get_recent_logs), which runs on another
  // cloud. Requires `Authorization: Bearer $LOGS_TOKEN`; disabled if unset.
  app.get('/internal/logs', (req, res) => {
    const token = process.env.LOGS_TOKEN;
    if (!token || req.get('Authorization') !== `Bearer ${token}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    res.json(log.recent({ limit, level: req.query.level }));
  });

  app.get('/api/orders', (req, res) => {
    res.json(listOrders());    
    // res.json(listOrders().map((o) => ({ ...o, customerName: o.customer.name.toUpperCase() })));
  });

  app.get('/api/orders/:id', (req, res) => {
    const order = getOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'not_found' });
    res.json(order);
  });

  // Central error handler: logs the stack so the investigator agent can find it.
  app.use((err, req, res, _next) => {
    log.error('unhandled_error', { path: req.path, error: err.message, stack: err.stack });
    res.status(500).json({ error: 'internal_error', message: err.message });
  });

  return app;
}

module.exports = { createApp };
