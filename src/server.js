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

// Send current state to newly connected WS clients
wsBroadcaster.wss.on('connection', (ws) => {
  wsBroadcaster.sendInitialState(ws, mqttClient.getLastValues());
});

// Wire MQTT readings to DB + WS
mqttClient.on('reading', (reading) => {
  db.insert(reading.sensor, reading.value, reading.timestamp);
  wsBroadcaster.broadcast('reading', reading);
});

mqttClient.on('device-status', (status) => {
  wsBroadcaster.broadcast('device-status', status);
});

mqttClient.connect();

// --- Scheduled jobs ---

// Hourly aggregation: run every 10 minutes, self-healing (aggregates any missing hours)
setInterval(() => {
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
setInterval(() => {
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

// Graceful shutdown
function shutdown() {
  console.log('\n[MeteoBoard] Shutting down...');
  mqttClient.disconnect();
  wsBroadcaster.close();
  server.close();
  db.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
