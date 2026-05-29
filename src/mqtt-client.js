const mqtt = require('mqtt');
const EventEmitter = require('events');
const config = require('./config');

// Accept a device-supplied timestamp only if it is finite and within a sane
// window (last 7 days .. 1 day ahead). A bogus 0 / far-future value would
// otherwise skew time-range queries, hourly aggregation, and retention.
function sanitizeTimestamp(ts) {
  const now = Math.floor(Date.now() / 1000);
  const n = Math.floor(Number(ts));
  if (Number.isFinite(n) && n > now - 7 * 86400 && n < now + 86400) return n;
  return now;
}

class MqttClient extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.lastValues = {};
  }

  connect() {
    const opts = {
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    };
    if (config.mqtt.username) {
      opts.username = config.mqtt.username;
      opts.password = config.mqtt.password;
    }

    this.client = mqtt.connect(config.mqtt.brokerUrl, opts);

    this.client.on('connect', () => {
      console.log(`[MQTT] Connected to ${config.mqtt.brokerUrl}`);
      const sensorTopic = `${config.mqtt.topicPrefix}/status/bthomesensor:+`;
      const deviceTopic = `${config.mqtt.topicPrefix}/status/bthomedevice:${config.deviceId}`;
      this.client.subscribe([sensorTopic, deviceTopic], (err) => {
        if (err) console.error('[MQTT] Subscribe error:', err);
        else console.log(`[MQTT] Subscribed to sensor and device topics`);
      });
    });

    this.client.on('message', (topic, payload) => {
      try {
        this._handleMessage(topic, payload);
      } catch (err) {
        console.error('[MQTT] Parse error:', err.message, topic);
      }
    });

    this.client.on('error', (err) => console.error('[MQTT] Error:', err.message));
    this.client.on('reconnect', () => console.log('[MQTT] Reconnecting...'));
    this.client.on('close', () => console.log('[MQTT] Disconnected'));
  }

  _handleMessage(topic, payload) {
    const data = JSON.parse(payload.toString());

    // BTHomeSensor status
    const sensorMatch = topic.match(/\/status\/bthomesensor:(\d+)$/);
    if (sensorMatch) {
      const componentId = parseInt(sensorMatch[1], 10);
      const sensorName = config.reverseMap[componentId];
      if (!sensorName) return;

      const value = typeof data.value === 'boolean'
        ? (data.value ? 1 : 0)
        : Number(data.value);
      // Drop missing / non-numeric values rather than caching/inserting NaN
      // (which binds as SQL NULL and violates the NOT NULL constraint).
      if (!Number.isFinite(value)) return;

      const reading = {
        sensor: sensorName,
        value,
        timestamp: sanitizeTimestamp(data.last_updated_ts),
      };

      this.lastValues[sensorName] = reading;
      this.emit('reading', reading);
      return;
    }

    // BTHomeDevice status (battery + RSSI)
    const deviceMatch = topic.match(/\/status\/bthomedevice:(\d+)$/);
    if (deviceMatch) {
      const ts = sanitizeTimestamp(data.last_updated_ts);

      // Emit device-status first so a bad battery reading cannot suppress the
      // RSSI/battery broadcast (listeners run synchronously; a throw in the
      // 'reading' path would otherwise skip this).
      this.emit('device-status', {
        battery: data.battery,
        rssi: data.rssi,
        packetId: data.packet_id,
        timestamp: ts,
      });

      const battery = Number(data.battery);
      if (Number.isFinite(battery)) {
        const batteryReading = { sensor: 'battery', value: battery, timestamp: ts };
        this.lastValues.battery = batteryReading;
        this.emit('reading', batteryReading);
      }
    }
  }

  getLastValues() {
    return { ...this.lastValues };
  }

  isConnected() {
    return !!(this.client && this.client.connected);
  }

  disconnect() {
    if (this.client) this.client.end();
  }
}

module.exports = MqttClient;
