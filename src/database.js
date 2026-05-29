const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const dbPath = path.resolve(config.db.path);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

// Performance pragmas
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');
db.pragma('temp_store = MEMORY');

// Trig helpers (degrees) for circular/vector averaging of compass bearings.
db.function('circ_sin', { deterministic: true }, (deg) => Math.sin((deg * Math.PI) / 180));
db.function('circ_cos', { deterministic: true }, (deg) => Math.cos((deg * Math.PI) / 180));

const HOUR = 3600;
const RAW_THRESHOLD = 86400; // ranges up to this use raw resolution; longer use hourly
const BACKFILL_HOURS = 3;    // re-aggregate this many trailing hours each run (late data)

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor TEXT NOT NULL,
    value REAL NOT NULL,
    timestamp INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_readings_sensor_ts
    ON readings (sensor, timestamp DESC);

  CREATE INDEX IF NOT EXISTS idx_readings_ts
    ON readings (timestamp);

  CREATE TABLE IF NOT EXISTS readings_hourly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor TEXT NOT NULL,
    hour INTEGER NOT NULL,
    avg_value REAL,
    min_value REAL,
    max_value REAL,
    sample_count INTEGER,
    UNIQUE(sensor, hour)
  );

  CREATE INDEX IF NOT EXISTS idx_hourly_sensor_hour
    ON readings_hourly (sensor, hour DESC);

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Prepared statements
const stmtInsert = db.prepare(
  'INSERT INTO readings (sensor, value, timestamp) VALUES (?, ?, ?)'
);

const stmtInsertBatch = db.transaction((rows) => {
  for (const r of rows) stmtInsert.run(r.sensor, r.value, Math.floor(r.timestamp));
});

const stmtQueryRaw = db.prepare(`
  SELECT sensor, value, timestamp
  FROM readings
  WHERE sensor = ? AND timestamp >= ? AND timestamp <= ?
  ORDER BY timestamp ASC
`);

const stmtQueryHourly = db.prepare(`
  SELECT sensor, avg_value AS value, min_value, max_value, hour AS timestamp
  FROM readings_hourly
  WHERE sensor = ? AND hour >= ? AND hour <= ?
  ORDER BY hour ASC
`);

const stmtLatest = db.prepare(`
  SELECT sensor, value, timestamp
  FROM readings
  WHERE sensor = ?
  ORDER BY timestamp DESC
  LIMIT 1
`);

const stmtAllLatest = db.prepare(`
  SELECT r.sensor, r.value, r.timestamp
  FROM readings r
  INNER JOIN (
    SELECT sensor, MAX(timestamp) AS max_ts
    FROM readings
    GROUP BY sensor
  ) latest ON r.sensor = latest.sensor AND r.timestamp = latest.max_ts
`);

// Aggregate every sensor within a single [from, to) window, grouped by sensor.
const stmtHourGroup = db.prepare(`
  SELECT sensor,
         AVG(value) AS avg, MIN(value) AS min, MAX(value) AS max, COUNT(*) AS cnt,
         AVG(circ_sin(value)) AS avgsin, AVG(circ_cos(value)) AS avgcos
  FROM readings
  WHERE timestamp >= ? AND timestamp < ?
  GROUP BY sensor
`);

// Bucket raw readings of a single sensor into hour buckets (for on-read
// aggregation of the not-yet-materialized tail of long-range queries).
const stmtBucketSensor = db.prepare(`
  SELECT (timestamp / ${HOUR}) * ${HOUR} AS hour,
         AVG(value) AS avg, MIN(value) AS min, MAX(value) AS max, COUNT(*) AS cnt,
         AVG(circ_sin(value)) AS avgsin, AVG(circ_cos(value)) AS avgcos
  FROM readings
  WHERE sensor = ? AND timestamp >= ? AND timestamp <= ?
  GROUP BY hour
  ORDER BY hour ASC
`);

const stmtUpsertHourly = db.prepare(`
  INSERT OR REPLACE INTO readings_hourly
    (sensor, hour, avg_value, min_value, max_value, sample_count)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtRawStats = db.prepare(`
  SELECT MIN(value) AS min, MAX(value) AS max, AVG(value) AS avg, COUNT(*) AS cnt
  FROM readings WHERE sensor = ? AND timestamp >= ? AND timestamp <= ?
`);
const stmtRawArgMin = db.prepare(`
  SELECT timestamp FROM readings WHERE sensor = ? AND timestamp >= ? AND timestamp <= ?
  ORDER BY value ASC, timestamp ASC LIMIT 1
`);
const stmtRawArgMax = db.prepare(`
  SELECT timestamp FROM readings WHERE sensor = ? AND timestamp >= ? AND timestamp <= ?
  ORDER BY value DESC, timestamp ASC LIMIT 1
`);
const stmtHourlyStats = db.prepare(`
  SELECT MIN(min_value) AS min, MAX(max_value) AS max,
         SUM(avg_value * sample_count) / NULLIF(SUM(sample_count), 0) AS avg,
         SUM(sample_count) AS cnt
  FROM readings_hourly WHERE sensor = ? AND hour >= ? AND hour <= ?
`);
const stmtHourlyArgMin = db.prepare(`
  SELECT hour FROM readings_hourly WHERE sensor = ? AND hour >= ? AND hour <= ?
  ORDER BY min_value ASC LIMIT 1
`);
const stmtHourlyArgMax = db.prepare(`
  SELECT hour FROM readings_hourly WHERE sensor = ? AND hour >= ? AND hour <= ?
  ORDER BY max_value DESC LIMIT 1
`);

const stmtPurgeRaw = db.prepare('DELETE FROM readings WHERE timestamp < ?');
const stmtPurgeAggregates = db.prepare('DELETE FROM readings_hourly WHERE hour < ?');
const stmtMinTs = db.prepare('SELECT MIN(timestamp) AS min_ts FROM readings');
const stmtGetMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
const stmtSetMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');

function strategyFor(sensor) {
  const m = config.sensorMeta[sensor];
  return (m && m.agg) || 'gauge';
}

// Reduce a grouped SQL row into the {avg_value, min_value, max_value} stored
// for an hour, according to the sensor's aggregation strategy.
function reduceAggregate(sensor, row) {
  const strat = strategyFor(sensor);

  if (strat === 'counter') {
    // Per-hour delta of a monotonic counter (e.g. cumulative rainfall).
    // Within a single hour a counter reset is treated as ~0 rather than negative.
    const delta = (row.max != null && row.min != null) ? Math.max(0, row.max - row.min) : 0;
    return { avg_value: delta, min_value: row.min, max_value: row.max };
  }

  if (strat === 'circular') {
    // Vector (circular) mean of compass bearings, normalized to [0, 360).
    let deg = (Math.atan2(row.avgsin, row.avgcos) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return { avg_value: deg, min_value: deg, max_value: deg };
  }

  return { avg_value: row.avg, min_value: row.min, max_value: row.max };
}

// Materialize aggregates for one complete hour (idempotent via INSERT OR REPLACE).
const aggregateHour = db.transaction((hour) => {
  const rows = stmtHourGroup.all(hour, hour + HOUR);
  for (const row of rows) {
    const r = reduceAggregate(row.sensor, row);
    stmtUpsertHourly.run(row.sensor, hour, r.avg_value, r.min_value, r.max_value, row.cnt);
  }
});

module.exports = {
  insert(sensor, value, timestamp) {
    stmtInsert.run(sensor, value, Math.floor(timestamp));
  },

  insertBatch(rows) {
    stmtInsertBatch(rows);
  },

  getReadings(sensor, from, to) {
    return stmtQueryRaw.all(sensor, from, to);
  },

  getHourlyReadings(sensor, from, to) {
    return stmtQueryHourly.all(sensor, from, to);
  },

  // Unified history: raw for short windows; for long windows, hourly aggregates
  // stitched with on-the-fly aggregation of the recent, not-yet-materialized
  // tail so the series always reaches "now".
  getHistory(sensor, from, to) {
    if (to - from <= RAW_THRESHOLD) {
      return stmtQueryRaw.all(sensor, from, to);
    }

    const hourly = stmtQueryHourly.all(sensor, from, to);
    const lastHour = hourly.length
      ? hourly[hourly.length - 1].timestamp
      : Math.floor(from / HOUR) * HOUR - HOUR;

    // Aggregate raw readings newer than the last materialized hour, on read.
    const tailFrom = lastHour + HOUR;
    const tail = [];
    if (tailFrom <= to) {
      for (const row of stmtBucketSensor.all(sensor, tailFrom, to)) {
        const r = reduceAggregate(sensor, row);
        tail.push({
          sensor,
          value: r.avg_value,
          min_value: r.min_value,
          max_value: r.max_value,
          timestamp: row.hour,
        });
      }
    }
    return tail.length ? hourly.concat(tail) : hourly;
  },

  // Min/avg/max (with the time of the extremes) over a window. Uses exact raw
  // data when the window is within raw retention, else hourly aggregates.
  getStats(sensor, from, to) {
    const useRaw = (to - from) <= config.retention.rawDays * 86400;
    if (useRaw) {
      const s = stmtRawStats.get(sensor, from, to);
      if (!s || !s.cnt) return null;
      const minRow = stmtRawArgMin.get(sensor, from, to);
      const maxRow = stmtRawArgMax.get(sensor, from, to);
      return {
        min: s.min, max: s.max, avg: s.avg, count: s.cnt,
        min_ts: minRow && minRow.timestamp, max_ts: maxRow && maxRow.timestamp,
        resolution: 'raw',
      };
    }
    const s = stmtHourlyStats.get(sensor, from, to);
    if (!s || !s.cnt) return null;
    const minRow = stmtHourlyArgMin.get(sensor, from, to);
    const maxRow = stmtHourlyArgMax.get(sensor, from, to);
    return {
      min: s.min, max: s.max, avg: s.avg, count: s.cnt,
      min_ts: minRow && minRow.hour, max_ts: maxRow && maxRow.hour,
      resolution: 'hourly',
    };
  },

  getLatest(sensor) {
    return stmtLatest.get(sensor);
  },

  getAllLatest() {
    return stmtAllLatest.all();
  },

  getMeta(key) {
    const row = stmtGetMeta.get(key);
    return row ? row.value : null;
  },

  setMeta(key, value) {
    stmtSetMeta.run(key, String(value));
  },

  runAggregation() {
    const now = Math.floor(Date.now() / 1000);
    const currentHourStart = Math.floor(now / HOUR) * HOUR;

    const earliest = stmtMinTs.get();
    if (!earliest || earliest.min_ts == null) return;
    const earliestHour = Math.floor(earliest.min_ts / HOUR) * HOUR;

    const lastAggRaw = this.getMeta('last_aggregated_hour');
    const lastAgg = lastAggRaw != null ? parseInt(lastAggRaw, 10) : null;

    let startHour;
    if (lastAgg == null) {
      // First run (or fresh upgrade): rebuild every hour still backed by raw data.
      startHour = earliestHour;
    } else {
      // Resume after the high-water mark, overlapping a few hours so late /
      // buffered readings get folded back into already-aggregated hours.
      startHour = Math.min(lastAgg + HOUR, currentHourStart - BACKFILL_HOURS * HOUR);
    }
    startHour = Math.max(startHour, earliestHour);

    for (let hour = startHour; hour < currentHourStart; hour += HOUR) {
      aggregateHour(hour);
    }

    // Last fully-aggregated hour is the one before the current (partial) hour.
    const lastComplete = currentHourStart - HOUR;
    if (lastComplete >= earliestHour) this.setMeta('last_aggregated_hour', lastComplete);
  },

  runRetention() {
    const now = Math.floor(Date.now() / 1000);
    const rawCutoff = now - config.retention.rawDays * 86400;
    const aggCutoff = now - config.retention.aggregateDays * 86400;
    const rawDeleted = stmtPurgeRaw.run(rawCutoff);
    const aggDeleted = stmtPurgeAggregates.run(aggCutoff);
    if (rawDeleted.changes > 0 || aggDeleted.changes > 0) {
      console.log(`[DB] Retention: purged ${rawDeleted.changes} raw rows, ${aggDeleted.changes} aggregate rows`);
      // Return freed pages to the OS and keep the WAL bounded.
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.exec('VACUUM');
      } catch (err) {
        console.error('[DB] Compaction error:', err.message);
      }
    }
  },

  close() {
    db.close();
  },
};
