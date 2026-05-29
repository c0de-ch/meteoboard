#!/usr/bin/env node

/**
 * MeteoBoard — Interactive Setup Wizard
 *
 * Guides the user through configuration:
 * 1. MQTT broker connection
 * 2. Shelly gateway topic prefix
 * 3. Auto-discover sensor component IDs
 * 4. Dashboard port
 * 5. Write .env file
 *
 * Usage: node scripts/setup-wizard.js
 */

const mqtt = require('mqtt');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { buildSensorMap } = require('./lib/classify');

const ENV_PATH = path.join(__dirname, '..', '.env');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultVal) {
  return new Promise((resolve) => {
    const dflt = defaultVal !== undefined ? ` [${defaultVal}]` : '';
    rl.question(`  ${question}${dflt}: `, (answer) => {
      resolve(answer.trim() || (defaultVal !== undefined ? String(defaultVal) : ''));
    });
  });
}

function confirm(question, defaultYes) {
  return new Promise((resolve) => {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    rl.question(`  ${question} ${hint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

function banner() {
  console.log('');
  console.log('  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('  \u2551                                              \u2551');
  console.log('  \u2551   \u2601  MeteoBoard Setup Wizard               \u2551');
  console.log('  \u2551                                              \u2551');
  console.log('  \u2551   Weather Dashboard for Shelly WS90         \u2551');
  console.log('  \u2551                                              \u2551');
  console.log('  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D');
  console.log('');
}

function testMqttConnection(brokerUrl) {
  return new Promise((resolve) => {
    console.log(`\n  Testing connection to ${brokerUrl}...`);
    const client = mqtt.connect(brokerUrl, {
      connectTimeout: 8000,
      reconnectPeriod: 0,
    });
    const timeout = setTimeout(() => {
      client.end(true);
      resolve(false);
    }, 10000);
    client.on('connect', () => {
      clearTimeout(timeout);
      client.end();
      resolve(true);
    });
    client.on('error', () => {
      clearTimeout(timeout);
      client.end(true);
      resolve(false);
    });
  });
}

function discoverTopics(brokerUrl) {
  return new Promise((resolve) => {
    console.log('\n  Scanning for Shelly devices on the broker (10 seconds)...');
    const client = mqtt.connect(brokerUrl, {
      connectTimeout: 8000,
      reconnectPeriod: 0,
    });
    const prefixes = new Set();

    client.on('connect', () => {
      // Subscribe to common Shelly topic patterns
      client.subscribe(['+/status/bthomesensor:+', '+/status/bthomedevice:+']);
    });

    client.on('message', (topic) => {
      const match = topic.match(/^([^/]+)\/status\//);
      if (match) prefixes.add(match[1]);
    });

    setTimeout(() => {
      client.end();
      resolve([...prefixes]);
    }, 10000);
  });
}

function discoverSensors(brokerUrl, topicPrefix) {
  return new Promise((resolve) => {
    console.log(`\n  Discovering sensors (30 seconds)...`);
    console.log('  Make sure your WS90 is powered on and in BLE range.\n');

    const client = mqtt.connect(brokerUrl, {
      connectTimeout: 8000,
      reconnectPeriod: 0,
    });
    const sensors = {};
    let deviceInfo = null;

    client.on('connect', () => {
      client.subscribe([
        `${topicPrefix}/status/bthomesensor:+`,
        `${topicPrefix}/status/bthomedevice:+`,
      ]);
    });

    client.on('message', (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        const sensorMatch = topic.match(/\/status\/bthomesensor:(\d+)$/);
        if (sensorMatch) {
          const id = parseInt(sensorMatch[1], 10);
          if (!sensors[id]) sensors[id] = { values: [] };
          const val = typeof data.value === 'boolean' ? (data.value ? 1 : 0) : Number(data.value);
          sensors[id].values.push(val);
        }
        const deviceMatch = topic.match(/\/status\/bthomedevice:(\d+)$/);
        if (deviceMatch) {
          deviceInfo = { id: parseInt(deviceMatch[1], 10), battery: data.battery, rssi: data.rssi };
        }
      } catch { /* ignore */ }
    });

    let elapsed = 0;
    const progress = setInterval(() => {
      elapsed++;
      const count = Object.keys(sensors).length;
      process.stdout.write(`\r  ${elapsed}/30s \u2014 ${count} sensors found`);
    }, 1000);

    setTimeout(() => {
      clearInterval(progress);
      client.end();
      console.log('\n');
      resolve({ sensors, deviceInfo });
    }, 30000);
  });
}

function classifyAndMap(sensors) {
  // Adapt { id: { values: [] } } -> { id: values[] } for the shared classifier.
  const byId = {};
  for (const [id, info] of Object.entries(sensors)) byId[id] = info.values;
  return buildSensorMap(byId);
}

function writeEnvFile(config) {
  const content = `# MeteoBoard Configuration
# Generated by setup wizard on ${new Date().toISOString()}

# MQTT Broker
MQTT_BROKER_URL=${config.brokerUrl}

# Shelly BLU Gateway topic prefix
MQTT_TOPIC_PREFIX=${config.topicPrefix}

# Sensor component ID mapping
SENSOR_MAP=${config.sensorMap}

# BTHomeDevice ID (battery/RSSI)
DEVICE_ID=${config.deviceId}

# Dashboard
PORT=${config.port}
HOST=0.0.0.0

# Database
DB_PATH=./data/meteoboard.db

# Data retention
DATA_RETENTION_DAYS=30
AGGREGATE_RETENTION_DAYS=365
`;

  fs.writeFileSync(ENV_PATH, content);
}

async function main() {
  banner();

  // Check for existing .env
  if (fs.existsSync(ENV_PATH)) {
    const overwrite = await confirm('Existing .env found. Overwrite?', false);
    if (!overwrite) {
      console.log('\n  Setup cancelled. Edit .env manually or delete it to re-run wizard.\n');
      rl.close();
      return;
    }
  }

  // Step 1: MQTT broker
  console.log('  Step 1/4: MQTT Broker Connection');
  console.log('  --------------------------------');
  let brokerUrl;
  while (true) {
    brokerUrl = await ask('MQTT broker URL', 'mqtt://localhost:1883');
    const ok = await testMqttConnection(brokerUrl);
    if (ok) {
      console.log('  \u2713 Connected successfully!\n');
      break;
    }
    console.log('  \u2717 Could not connect. Check the URL and that the broker is running.');
    const retry = await confirm('Try again?', true);
    if (!retry) {
      console.log('  Using the URL anyway. You can fix it in .env later.\n');
      break;
    }
  }

  // Step 2: Topic prefix
  console.log('  Step 2/4: Shelly Gateway Topic Prefix');
  console.log('  -------------------------------------');

  let topicPrefix;
  const autoDiscover = await confirm('Auto-discover Shelly devices on the broker?', true);
  if (autoDiscover) {
    const prefixes = await discoverTopics(brokerUrl);
    if (prefixes.length > 0) {
      console.log(`\n  Found ${prefixes.length} device(s):`);
      prefixes.forEach((p, i) => console.log(`    ${i + 1}. ${p}`));
      if (prefixes.length === 1) {
        topicPrefix = prefixes[0];
        console.log(`\n  Using: ${topicPrefix}`);
      } else {
        const choice = await ask('Enter number or type prefix manually', '1');
        const num = parseInt(choice, 10);
        topicPrefix = (num >= 1 && num <= prefixes.length) ? prefixes[num - 1] : choice;
      }
    } else {
      console.log('  No devices found. You may need to enable MQTT on the gateway.');
      topicPrefix = await ask('Enter topic prefix manually');
    }
  } else {
    topicPrefix = await ask('Topic prefix (e.g. shellyblugwg3-AABBCCDDEEFF)');
  }
  console.log('');

  // Step 3: Sensor discovery
  console.log('  Step 3/4: Sensor Discovery');
  console.log('  --------------------------');

  let sensorMapStr = '';
  let deviceId = '202';

  const doDiscover = await confirm('Auto-discover sensor IDs? (takes 30 seconds)', true);
  if (doDiscover) {
    const { sensors, deviceInfo } = await discoverSensors(brokerUrl, topicPrefix);

    if (Object.keys(sensors).length === 0) {
      console.log('  No sensors discovered. Check that:');
      console.log('    - status_ntf is enabled in the gateway MQTT settings');
      console.log('    - The WS90 is paired and in BLE range');
      console.log('\n  You can run `npm run discover` later to retry.\n');
      sensorMapStr = await ask('Enter SENSOR_MAP manually (or press Enter to skip)', '');
    } else {
      const { map, classified } = classifyAndMap(sensors);

      console.log('  Discovered sensor mapping:');
      console.log('  ┌────────────────────┬────────────────┬──────────────┐');
      console.log('  │ Sensor             │ Component ID   │ Avg Value    │');
      console.log('  ├────────────────────┼────────────────┼──────────────┤');

      for (const [name, id] of Object.entries(map)) {
        const info = classified[id];
        const nameStr = name.padEnd(18);
        const idStr = String(id).padEnd(14);
        const avgStr = info ? info.avg.toFixed(2).padStart(12) : '         N/A';
        console.log(`  │ ${nameStr} │ ${idStr} │ ${avgStr} │`);
      }
      console.log('  └────────────────────┴────────────────┴──────────────┘');

      const accept = await confirm('\n  Accept this mapping?', true);
      if (accept) {
        sensorMapStr = Object.entries(map).map(([k, v]) => `${k}=${v}`).join(',');
      } else {
        sensorMapStr = await ask('Enter SENSOR_MAP manually');
      }

      if (deviceInfo) {
        deviceId = String(deviceInfo.id);
        console.log(`\n  Device: bthomedevice:${deviceInfo.id} (battery: ${deviceInfo.battery}%, rssi: ${deviceInfo.rssi}dBm)`);
      }
    }
  } else {
    sensorMapStr = await ask('Enter SENSOR_MAP (format: name1=id1,name2=id2,...)');
    deviceId = await ask('BTHomeDevice ID for battery', '202');
  }

  // Step 4: Port
  console.log('\n  Step 4/4: Dashboard Settings');
  console.log('  ----------------------------');
  const port = await ask('Dashboard port', '3000');

  // Write .env
  writeEnvFile({
    brokerUrl,
    topicPrefix,
    sensorMap: sensorMapStr,
    deviceId,
    port,
  });

  console.log(`\n  \u2713 Configuration written to .env`);
  console.log('');
  console.log('  =============================================');
  console.log('  Setup complete!');
  console.log('  =============================================');
  console.log('');
  console.log('  Start the dashboard:');
  console.log('    npm start');
  console.log('');
  console.log(`  Then open: http://localhost:${port}`);
  console.log('');
  console.log('  To re-discover sensors:  npm run discover');
  console.log('  To re-run this wizard:   npm run setup');
  console.log('');

  rl.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
