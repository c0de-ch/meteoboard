require('dotenv').config();

// Refuse to run as root
if (process.getuid && process.getuid() === 0) {
  console.error('[MeteoBoard] ERROR: Do not run as root!');
  console.error('[MeteoBoard] The service should run as the "meteoboard" user.');
  console.error('[MeteoBoard] If using systemd, the unit file already sets User=meteoboard.');
  console.error('[MeteoBoard] For manual start: sudo -u meteoboard node src/server.js');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const path = require('path');
const config = require('./config');
const db = require('./database');
const MqttClient = require('./mqtt-client');
const WsBroadcaster = require('./websocket');
const AlertManager = require('./alerts');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api', apiRoutes);

// WebSocket
const wsBroadcaster = new WsBroadcaster(server);

// MQTT
const mqttClient = new MqttClient();

// Threshold alerting
const alertManager = new AlertManager(config.alerts);

// Liveness/readiness endpoint for monitors and systemd watchdogs. Always 200
// (the process is serving); `healthy` reflects MQTT link + data freshness.
app.get('/health', (_req, res) => {
  const now = Math.floor(Date.now() / 1000);
  let newest = 0;
  for (const r of db.getAllLatest()) newest = Math.max(newest, r.timestamp);
  const lastReadingAge = newest ? now - newest : null;
  const mqttConnected = mqttClient.isConnected();
  res.json({
    healthy: mqttConnected && lastReadingAge != null && lastReadingAge < 600,
    uptime_s: Math.floor(process.uptime()),
    mqtt_connected: mqttConnected,
    last_reading_age_s: lastReadingAge,
  });
});

// Send current state + active alerts to newly connected WS clients
wsBroadcaster.wss.on('connection', (ws) => {
  wsBroadcaster.sendInitialState(ws, mqttClient.getLastValues());
  wsBroadcaster.sendTo(ws, 'alerts', alertManager.snapshot());
});

// Wire MQTT readings to DB + WS. The DB write is isolated so a storage error
// is logged as such (not masqueraded as an MQTT parse error) and still allows
// the live broadcast to reach connected clients.
mqttClient.on('reading', (reading) => {
  try {
    db.insert(reading.sensor, reading.value, reading.timestamp);
  } catch (err) {
    console.error('[DB] Insert error:', err.message);
  }
  wsBroadcaster.broadcast('reading', reading);

  // Evaluate alert thresholds and broadcast any state changes (edges).
  for (const change of alertManager.evaluate(reading.sensor, reading.value, reading.timestamp)) {
    console.log(`[Alert] ${change.active ? 'ON ' : 'OFF'} ${change.key} (${change.sensor}=${change.value})`);
    wsBroadcaster.broadcast('alert', change);
  }
});

mqttClient.on('device-status', (status) => {
  wsBroadcaster.broadcast('device-status', status);
});

mqttClient.connect();

// --- Scheduled jobs ---

// Hourly aggregation: run every 10 minutes, self-healing (aggregates any missing hours)
const aggregationInterval = setInterval(() => {
  try {
    db.runAggregation();
  } catch (err) {
    console.error('[DB] Aggregation error:', err.message);
  }
}, 600000);

// Run aggregation once at startup to catch up
setTimeout(() => {
  try {
    db.runAggregation();
    console.log('[DB] Startup aggregation complete');
  } catch (err) {
    console.error('[DB] Startup aggregation error:', err.message);
  }
}, 5000);

// Daily retention cleanup
db.runRetention();
const retentionInterval = setInterval(() => {
  try {
    db.runRetention();
  } catch (err) {
    console.error('[DB] Retention error:', err.message);
  }
}, 86400000);

// Start server
server.listen(config.server.port, config.server.host, () => {
  console.log(`[MeteoBoard] Dashboard running at http://${config.server.host}:${config.server.port}`);
  console.log(`[MeteoBoard] MQTT broker: ${config.mqtt.brokerUrl}`);
  console.log(`[MeteoBoard] Topic prefix: ${config.mqtt.topicPrefix}`);
  console.log(`[MeteoBoard] Sensors mapped: ${Object.keys(config.sensorMap).join(', ') || 'none (run npm run setup)'}`);
});

// Graceful shutdown: stop timers, close MQTT/WS, drain HTTP, then close the DB.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[MeteoBoard] Shutting down...');

  clearInterval(aggregationInterval);
  clearInterval(retentionInterval);
  mqttClient.disconnect();
  wsBroadcaster.close();

  const finish = () => {
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  };

  // Exit once in-flight HTTP connections have drained...
  server.close(finish);
  // ...but don't hang forever if a client keeps the socket open.
  setTimeout(finish, 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
