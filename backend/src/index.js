const { createApp } = require('./app');
const log = require('./logger');

const PORT = Number(process.env.PORT) || 3000;

process.on('uncaughtException', (err) => {
  log.error('uncaught_exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

createApp().listen(PORT, () => {
  log.info('server_started', { port: PORT, logFile: log.LOG_FILE });
});
