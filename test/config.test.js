const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'config.js');

// Load src/config.js fresh with a given SENSOR_MAP env value.
function loadConfig(sensorMapEnv) {
  const prev = process.env.SENSOR_MAP;
  if (sensorMapEnv === undefined) delete process.env.SENSOR_MAP;
  else process.env.SENSOR_MAP = sensorMapEnv;
  delete require.cache[require.resolve(CONFIG_PATH)];
  const cfg = require(CONFIG_PATH);
  if (prev === undefined) delete process.env.SENSOR_MAP;
  else process.env.SENSOR_MAP = prev;
  delete require.cache[require.resolve(CONFIG_PATH)];
  return cfg;
}

test('parses SENSOR_MAP into name->id and reverse id->name', () => {
  const cfg = loadConfig('temperature=213,humidity=214, pressure = 216 ');
  assert.equal(cfg.sensorMap.temperature, 213);
  assert.equal(cfg.sensorMap.humidity, 214);
  assert.equal(cfg.sensorMap.pressure, 216); // tolerates surrounding spaces
  assert.equal(cfg.reverseMap[213], 'temperature');
  assert.equal(cfg.reverseMap[216], 'pressure');
});

test('empty / missing SENSOR_MAP yields empty maps', () => {
  assert.deepEqual(loadConfig('').sensorMap, {});
  assert.deepEqual(loadConfig(undefined).sensorMap, {});
});

test('aggregation strategies are declared for special sensors', () => {
  const cfg = loadConfig('');
  assert.equal(cfg.sensorMeta.precipitation.agg, 'counter');
  assert.equal(cfg.sensorMeta.wind_direction.agg, 'circular');
  assert.equal(cfg.sensorMeta.temperature.agg, undefined); // gauge (default)
});
