const mqtt = require('mqtt');
const EventEmitter = require('events');
const config = require('./config');

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

      const reading = {
        sensor: sensorName,
        value: typeof data.value === 'boolean' ? (data.value ? 1 : 0) : Number(data.value),
        timestamp: data.last_updated_ts
          ? Math.floor(data.last_updated_ts)
          : Math.floor(Date.now() / 1000),
      };

      this.lastValues[sensorName] = reading;
      this.emit('reading', reading);
      return;
    }

    // BTHomeDevice status (battery + RSSI)
    const deviceMatch = topic.match(/\/status\/bthomedevice:(\d+)$/);
    if (deviceMatch) {
      const ts = data.last_updated_ts
        ? Math.floor(data.last_updated_ts)
        : Math.floor(Date.now() / 1000);

      if (data.battery !== undefined) {
        const batteryReading = {
          sensor: 'battery',
          value: data.battery,
          timestamp: ts,
        };
        this.lastValues.battery = batteryReading;
        this.emit('reading', batteryReading);
      }

      this.emit('device-status', {
        battery: data.battery,
        rssi: data.rssi,
        packetId: data.packet_id,
        timestamp: ts,
      });
    }
  }

  getLastValues() {
    return { ...this.lastValues };
  }

  disconnect() {
    if (this.client) this.client.end();
  }
}

module.exports = MqttClient;
