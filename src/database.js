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
`);

// Prepared statements
const stmtInsert = db.prepare(
  'INSERT INTO readings (sensor, value, timestamp) VALUES (?, ?, ?)'
);

const stmtInsertBatch = db.transaction((rows) => {
  for (const r of rows) stmtInsert.run(r.sensor, r.value, r.timestamp);
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

const stmtAggregate = db.prepare(`
  INSERT OR REPLACE INTO readings_hourly (sensor, hour, avg_value, min_value, max_value, sample_count)
  SELECT sensor, ? AS hour,
         AVG(value), MIN(value), MAX(value), COUNT(*)
  FROM readings
  WHERE timestamp >= ? AND timestamp < ?
  GROUP BY sensor
`);

const stmtPurgeRaw = db.prepare(
  'DELETE FROM readings WHERE timestamp < ?'
);

const stmtPurgeAggregates = db.prepare(
  'DELETE FROM readings_hourly WHERE hour < ?'
);

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

  getLatest(sensor) {
    return stmtLatest.get(sensor);
  },

  getAllLatest() {
    return stmtAllLatest.all();
  },

  runAggregation() {
    // Aggregate all complete hours that have raw data but no aggregate yet
    const now = Math.floor(Date.now() / 1000);
    const currentHourStart = Math.floor(now / 3600) * 3600;

    // Find the earliest raw reading
    const earliest = db.prepare(
      'SELECT MIN(timestamp) AS min_ts FROM readings'
    ).get();
    if (!earliest || !earliest.min_ts) return;

    const startHour = Math.floor(earliest.min_ts / 3600) * 3600;

    for (let hour = startHour; hour < currentHourStart; hour += 3600) {
      // Only aggregate if no entry exists yet
      const existing = db.prepare(
        'SELECT 1 FROM readings_hourly WHERE hour = ? LIMIT 1'
      ).get(hour);
      if (!existing) {
        stmtAggregate.run(hour, hour, hour + 3600);
      }
    }
  },

  runRetention() {
    const now = Math.floor(Date.now() / 1000);
    const rawCutoff = now - config.retention.rawDays * 86400;
    const aggCutoff = now - config.retention.aggregateDays * 86400;
    const rawDeleted = stmtPurgeRaw.run(rawCutoff);
    const aggDeleted = stmtPurgeAggregates.run(aggCutoff);
    if (rawDeleted.changes > 0 || aggDeleted.changes > 0) {
      console.log(`[DB] Retention: purged ${rawDeleted.changes} raw rows, ${aggDeleted.changes} aggregate rows`);
    }
  },

  close() {
    db.close();
  },
};
