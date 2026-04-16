#!/usr/bin/env node

/**
 * MeteoBoard Sensor Discovery Tool
 *
 * Subscribes to the Shelly BLU Gateway MQTT topics and auto-discovers
 * which component IDs correspond to which sensor types.
 *
 * Usage: node scripts/discover-sensors.js [mqtt://broker:1883] [topic-prefix]
 *
 * Or run: npm run discover
 */

const mqtt = require('mqtt');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultVal) {
  return new Promise((resolve) => {
    const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

// Heuristic sensor classification based on observed values
function classifySensor(values) {
  if (values.length === 0) return 'unknown';
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);

  // Boolean (0 or 1)
  if (values.every(v => v === 0 || v === 1 || v === true || v === false)) return 'rain_status';
  // Pressure (300-1100 hPa)
  if (avg > 300 && avg < 1200 && min > 250) return 'pressure';
  // Illuminance (can be 0 to 200000+)
  if (max > 1000 && min >= 0) return 'illuminance';
  // Temperature-range (-40 to 60)
  if (avg > -45 && avg < 65 && max < 70) {
    // Dew point is typically lower than temperature
    // We'll need to compare pairs later, for now mark as temperature-like
    return 'temperature_or_dewpoint';
  }
  // Humidity (0-100, typically 20-100)
  if (avg >= 0 && avg <= 100 && min >= 0 && max <= 100) {
    // Could also be battery or UV index
    if (max <= 15) return 'uv_index';
    return 'humidity_or_battery';
  }
  // Wind direction (0-360)
  if (min >= 0 && max <= 360 && avg > 0) return 'wind_direction';
  // Wind speed / gust (0-50+ m/s typically)
  if (min >= 0 && max < 100 && avg < 40) return 'wind_speed_or_gust';
  // Precipitation (cumulative, can be any positive number)
  if (min >= 0) return 'precipitation';

  return 'unknown';
}

async function main() {
  console.log('');
  console.log('  =============================================');
  console.log('  MeteoBoard — Sensor Discovery Tool');
  console.log('  =============================================');
  console.log('');
  console.log('  This tool connects to your MQTT broker, listens');
  console.log('  for Shelly BLU Gateway messages, and maps sensor');
  console.log('  component IDs to measurement types.');
  console.log('');

  const brokerUrl = process.argv[2] || await ask('MQTT broker URL', 'mqtt://localhost:1883');
  const topicPrefix = process.argv[3] || await ask('Shelly gateway topic prefix (e.g. shellyblugwg3-AABBCCDDEEFF)');

  if (!topicPrefix) {
    console.error('\nError: Topic prefix is required. Find it in your Shelly gateway MQTT settings.\n');
    process.exit(1);
  }

  console.log(`\nConnecting to ${brokerUrl}...`);

  const client = mqtt.connect(brokerUrl, {
    connectTimeout: 10000,
    reconnectPeriod: 0, // Don't auto-reconnect for discovery
  });

  const discovered = {}; // componentId -> { values: [], classification: '' }
  let deviceInfo = null;
  const LISTEN_SECONDS = 30;

  client.on('connect', () => {
    console.log('Connected!\n');

    const sensorTopic = `${topicPrefix}/status/bthomesensor:+`;
    const deviceTopic = `${topicPrefix}/status/bthomedevice:+`;

    client.subscribe([sensorTopic, deviceTopic], (err) => {
      if (err) {
        console.error('Subscribe error:', err.message);
        process.exit(1);
      }
      console.log(`Listening for sensor data (${LISTEN_SECONDS} seconds)...`);
      console.log('Make sure your WS90 is powered on and within BLE range of the gateway.\n');
    });

    // Progress indicator
    let elapsed = 0;
    const progress = setInterval(() => {
      elapsed++;
      const found = Object.keys(discovered).length;
      process.stdout.write(`\r  ${elapsed}/${LISTEN_SECONDS}s — ${found} sensors discovered`);
    }, 1000);

    setTimeout(() => {
      clearInterval(progress);
      client.end();
      console.log('\n\nDiscovery complete!\n');
      showResults();
    }, LISTEN_SECONDS * 1000);
  });

  client.on('message', (topic, payload) => {
    try {
      const data = JSON.parse(payload.toString());

      const sensorMatch = topic.match(/\/status\/bthomesensor:(\d+)$/);
      if (sensorMatch) {
        const id = parseInt(sensorMatch[1], 10);
        if (!discovered[id]) discovered[id] = { values: [] };
        const val = typeof data.value === 'boolean' ? (data.value ? 1 : 0) : Number(data.value);
        discovered[id].values.push(val);
        return;
      }

      const deviceMatch = topic.match(/\/status\/bthomedevice:(\d+)$/);
      if (deviceMatch) {
        deviceInfo = {
          id: parseInt(deviceMatch[1], 10),
          battery: data.battery,
          rssi: data.rssi,
        };
      }
    } catch (e) { /* ignore parse errors */ }
  });

  client.on('error', (err) => {
    console.error(`\nMQTT connection error: ${err.message}`);
    console.error('Check that your broker URL is correct and the broker is running.\n');
    process.exit(1);
  });

  function showResults() {
    if (Object.keys(discovered).length === 0 && !deviceInfo) {
      console.log('No sensors discovered!\n');
      console.log('Possible causes:');
      console.log('  1. Wrong topic prefix — check your Shelly gateway MQTT settings');
      console.log('  2. status_ntf is not enabled on the gateway');
      console.log('  3. WS90 is not paired with the gateway');
      console.log('  4. WS90 is out of BLE range\n');
      process.exit(1);
    }

    // Classify each sensor
    const classified = {};
    for (const [id, info] of Object.entries(discovered)) {
      classified[id] = {
        ...info,
        classification: classifySensor(info.values),
        avgValue: info.values.reduce((a, b) => a + b, 0) / info.values.length,
        sampleCount: info.values.length,
      };
    }

    console.log('┌─────────────┬────────────────────────────┬──────────────┬─────────┐');
    console.log('│ Component   │ Likely Sensor              │ Avg Value    │ Samples │');
    console.log('├─────────────┼────────────────────────────┼──────────────┼─────────┤');

    for (const [id, info] of Object.entries(classified).sort((a, b) => a[0] - b[0])) {
      const idStr = String(id).padEnd(11);
      const classStr = info.classification.padEnd(26);
      const avgStr = info.avgValue.toFixed(2).padStart(12);
      const sampStr = String(info.sampleCount).padStart(7);
      console.log(`│ ${idStr} │ ${classStr} │ ${avgStr} │ ${sampStr} │`);
    }

    console.log('└─────────────┴────────────────────────────┴──────────────┴─────────┘');

    if (deviceInfo) {
      console.log(`\nDevice (bthomedevice:${deviceInfo.id}): battery=${deviceInfo.battery}%, rssi=${deviceInfo.rssi}dBm`);
    }

    // Generate SENSOR_MAP suggestion
    console.log('\n--- Suggested SENSOR_MAP ---');
    console.log('Review the mapping above and adjust if needed.\n');

    const sensorMap = buildSensorMap(classified);
    const mapStr = Object.entries(sensorMap)
      .map(([name, id]) => `${name}=${id}`)
      .join(',');

    console.log(`SENSOR_MAP=${mapStr}`);
    if (deviceInfo) {
      console.log(`DEVICE_ID=${deviceInfo.id}`);
    }
    console.log('\nCopy these values to your .env file, or re-run `npm run setup` to use the wizard.\n');

    rl.close();
  }
}

function buildSensorMap(classified) {
  const map = {};
  const entries = Object.entries(classified);

  // Simple assignment based on classification
  for (const [id, info] of entries) {
    switch (info.classification) {
      case 'pressure': map.pressure = id; break;
      case 'illuminance': map.illuminance = id; break;
      case 'rain_status': map.rain_status = id; break;
      case 'wind_direction': map.wind_direction = id; break;
      case 'uv_index': map.uv_index = id; break;
      case 'precipitation': map.precipitation = id; break;
    }
  }

  // Temperature vs dew_point: higher average is likely temperature
  const tempLike = entries
    .filter(([, info]) => info.classification === 'temperature_or_dewpoint')
    .sort((a, b) => b[1].avgValue - a[1].avgValue);
  if (tempLike.length >= 2) {
    map.temperature = tempLike[0][0];
    map.dew_point = tempLike[1][0];
  } else if (tempLike.length === 1) {
    map.temperature = tempLike[0][0];
  }

  // Humidity vs battery: higher avg and more variable is likely humidity
  const humLike = entries
    .filter(([, info]) => info.classification === 'humidity_or_battery')
    .sort((a, b) => b[1].avgValue - a[1].avgValue);
  if (humLike.length >= 1) map.humidity = humLike[0][0];

  // Wind speed vs gust: gust has higher peaks
  const windLike = entries
    .filter(([, info]) => info.classification === 'wind_speed_or_gust')
    .sort((a, b) => Math.max(...a[1].values) - Math.max(...b[1].values));
  if (windLike.length >= 2) {
    map.wind_speed = windLike[0][0];
    map.wind_gust = windLike[1][0];
  } else if (windLike.length === 1) {
    map.wind_speed = windLike[0][0];
  }

  return map;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
