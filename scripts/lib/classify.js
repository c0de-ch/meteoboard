/**
 * Shared sensor-classification heuristics.
 *
 * Used by both the setup wizard and the standalone discovery tool so the two
 * cannot drift apart. The output is a best-effort *suggestion* that the
 * operator reviews and confirms; it is never used unattended by the server.
 */

// Coerce booleans to 1/0 and drop anything non-numeric (incl. null/undefined,
// which Number() would otherwise silently coerce to 0).
function normalize(values) {
  return values
    .map((v) => (v === true ? 1 : v === false ? 0 : v == null ? NaN : Number(v)))
    .filter(Number.isFinite);
}

// Classify a single component from its observed values.
function classifySensor(values) {
  const v = normalize(values);
  if (v.length === 0) return 'unknown';

  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const min = Math.min(...v);
  const max = Math.max(...v);

  if (v.every((x) => x === 0 || x === 1)) return 'rain_status';
  if (avg > 300 && avg < 1200 && min > 250) return 'pressure';
  if (max > 1000 && min >= 0) return 'illuminance';
  if (avg > -45 && avg < 65 && max < 70 && min < 65) return 'temperature_like';
  if (avg >= 0 && avg <= 100 && max <= 100 && max > 15) return 'humidity_like';
  if (max <= 15 && min >= 0) return 'uv_index';
  if (min >= 0 && max <= 360) return 'wind_direction';
  if (min >= 0 && max < 100) return 'wind_like';
  if (min >= 0) return 'precipitation';
  return 'unknown';
}

/**
 * Build a SENSOR_MAP suggestion from raw observations.
 * @param {Object<string|number, number[]>} sensorsById - componentId -> values
 * @returns {{ map: Object, classified: Object }}
 *   map: sensorName -> componentId
 *   classified: componentId -> { type, avg, min, max, count }
 */
function buildSensorMap(sensorsById) {
  const classified = {};
  for (const [id, values] of Object.entries(sensorsById)) {
    const v = normalize(values);
    if (v.length === 0) continue;
    classified[id] = {
      type: classifySensor(values),
      avg: v.reduce((a, b) => a + b, 0) / v.length,
      min: Math.min(...v),
      max: Math.max(...v),
      count: v.length,
    };
  }

  const map = {};
  // Single-instance types map directly.
  for (const [id, info] of Object.entries(classified)) {
    if (['rain_status', 'pressure', 'illuminance', 'uv_index', 'wind_direction', 'precipitation'].includes(info.type)) {
      map[info.type] = id;
    }
  }

  const byType = (t) => Object.entries(classified).filter(([, i]) => i.type === t);

  // Temperature vs dew point: the higher average is the air temperature.
  const temps = byType('temperature_like').sort((a, b) => b[1].avg - a[1].avg);
  if (temps[0]) map.temperature = temps[0][0];
  if (temps[1]) map.dew_point = temps[1][0];

  // Humidity (highest-average humidity-like component).
  const hums = byType('humidity_like').sort((a, b) => b[1].avg - a[1].avg);
  if (hums[0]) map.humidity = hums[0][0];

  // Wind speed vs gust: gust reaches the higher peak.
  const winds = byType('wind_like').sort((a, b) => a[1].max - b[1].max);
  if (winds[0]) map.wind_speed = winds[0][0];
  if (winds[1]) map.wind_gust = winds[1][0];

  return { map, classified };
}

module.exports = { normalize, classifySensor, buildSensorMap };
