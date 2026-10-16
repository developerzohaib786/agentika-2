// Streamable HTTP MCP endpoint for n8n's MCP Client Tool node:
//   http://incident-mcp:3001/mcp   (Docker network only, not exposed by Caddy)
// Stateless: a fresh server + transport per request.
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { buildServer } = require('./server');
const { BACKEND_URL } = require('./backend');
const { DRY_RUN } = require('./acc');

const PORT = Number(process.env.PORT) || 3001;
const MCP_TOKEN = process.env.MCP_TOKEN || '';

function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (req, res) => res.json({ ok: true, backend: BACKEND_URL || null, accDryRun: DRY_RUN }));

  // Optional bearer auth (set MCP_TOKEN and the same header in the n8n credential).
  app.use('/mcp', (req, res, next) => {
    if (MCP_TOKEN && req.get('Authorization') !== `Bearer ${MCP_TOKEN}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  });

  app.post('/mcp', async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), msg: 'mcp_error', error: err.message }));
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
    }
  });

  // Stateless mode: no SSE stream or session teardown.
  const notAllowed = (req, res) =>
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);

  return app;
}

if (require.main === module) {
  createApp().listen(PORT, () => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), msg: 'incident_mcp_started', port: PORT, backend: BACKEND_URL, accDryRun: DRY_RUN }));
  });
}

module.exports = { createApp };
