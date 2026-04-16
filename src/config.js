require('dotenv').config();

function parseSensorMap(envValue) {
  const map = {};
  if (!envValue) return map;
  envValue.split(',').forEach(pair => {
    const [name, id] = pair.trim().split('=');
    if (name && id) map[name.trim()] = parseInt(id.trim(), 10);
  });
  return map;
}

function buildReverseMap(sensorMap) {
  const reverse = {};
  for (const [name, id] of Object.entries(sensorMap)) {
    reverse[id] = name;
  }
  return reverse;
}

const sensorMap = parseSensorMap(process.env.SENSOR_MAP);

module.exports = {
  mqtt: {
    brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'shellyblugwg3-XXXXXXXXXXXX',
  },
  sensorMap,
  reverseMap: buildReverseMap(sensorMap),
  deviceId: parseInt(process.env.DEVICE_ID || '202', 10),
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
  },
  db: {
    path: process.env.DB_PATH || './data/meteoboard.db',
  },
  retention: {
    rawDays: parseInt(process.env.DATA_RETENTION_DAYS || '30', 10),
    aggregateDays: parseInt(process.env.AGGREGATE_RETENTION_DAYS || '365', 10),
  },
  sensorMeta: {
    temperature:    { label: 'Temperature',   unit: '\u00b0C',  precision: 1, icon: 'thermometer' },
    humidity:       { label: 'Humidity',       unit: '%',   precision: 0, icon: 'droplet' },
    pressure:       { label: 'Pressure',       unit: 'hPa', precision: 1, icon: 'gauge' },
    illuminance:    { label: 'Illuminance',    unit: 'lux', precision: 0, icon: 'sun' },
    dew_point:      { label: 'Dew Point',      unit: '\u00b0C',  precision: 1, icon: 'thermometer-snow' },
    wind_speed:     { label: 'Wind Speed',     unit: 'm/s', precision: 1, icon: 'wind' },
    wind_gust:      { label: 'Wind Gust',      unit: 'm/s', precision: 1, icon: 'wind' },
    uv_index:       { label: 'UV Index',       unit: '',    precision: 1, icon: 'sun-dim' },
    wind_direction: { label: 'Wind Dir.',      unit: '\u00b0',   precision: 0, icon: 'compass' },
    precipitation:  { label: 'Rain',           unit: 'mm',  precision: 1, icon: 'cloud-rain' },
    rain_status:    { label: 'Rain Status',    unit: '',    precision: 0, icon: 'cloud-drizzle' },
    battery:        { label: 'Battery',        unit: '%',   precision: 0, icon: 'battery' },
  },
};
