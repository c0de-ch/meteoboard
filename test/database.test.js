const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Point the DB at a throwaway file before requiring the module (it opens the
// database at require time). node:test runs each file in its own process.
const DB_PATH = path.join(os.tmpdir(), `mb-dbtest-${process.pid}.db`);
process.env.DB_PATH = DB_PATH;
const db = require('../src/database');

const HOUR = 3600;
const now = Math.floor(Date.now() / 1000);
const curHourStart = Math.floor(now / HOUR) * HOUR;
const pastHour = curHourStart - 2 * HOUR;

test.before(() => {
  [10, 20, 30].forEach((v, i) => db.insert('temperature', v, pastHour + i * 60));
  [100, 102, 105].forEach((v, i) => db.insert('precipitation', v, pastHour + i * 60));
  [350, 10].forEach((v, i) => db.insert('wind_direction', v, pastHour + i * 60));
  // Tail data in the current (partial) hour — not materialized by aggregation.
  [15, 25].forEach((v, i) => db.insert('temperature', v, curHourStart + i * 60));
  db.runAggregation();
});

test.after(() => {
  db.close();
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + ext, { force: true });
});

test('gauge sensor stores avg/min/max', () => {
  const r = db.getHourlyReadings('temperature', pastHour, pastHour)[0];
  assert.equal(r.value, 20);
  assert.equal(r.min_value, 10);
  assert.equal(r.max_value, 30);
});

test('counter sensor stores per-hour delta', () => {
  const r = db.getHourlyReadings('precipitation', pastHour, pastHour)[0];
  assert.equal(r.value, 5); // 105 - 100
});

test('circular sensor stores a vector mean near north (0/360)', () => {
  const r = db.getHourlyReadings('wind_direction', pastHour, pastHour)[0];
  const d = r.value % 360;
  assert.ok(d < 1 || d > 359, `expected ~0/360, got ${r.value}`);
});

test('getHistory stitches the not-yet-aggregated tail for long ranges', () => {
  const hist = db.getHistory('temperature', curHourStart - 30 * HOUR, now);
  const hours = hist.map((r) => r.timestamp);
  assert.ok(hours.includes(pastHour), 'includes materialized hour');
  assert.ok(hours.includes(curHourStart), 'includes on-the-fly tail hour');
  assert.equal(hist.find((r) => r.timestamp === curHourStart).value, 20); // avg(15,25)
});

test('getHistory returns raw rows for short ranges', () => {
  const hist = db.getHistory('temperature', pastHour - 60, pastHour + 600);
  assert.equal(hist.length, 3); // the three raw inserts
  assert.equal(hist[0].value, 10);
});

test('getStats returns extremes with timestamps', () => {
  const s = db.getStats('temperature', pastHour - 60, now);
  assert.equal(s.min, 10);
  assert.equal(s.max, 30);
  assert.equal(s.min_ts, pastHour);
  assert.equal(s.max_ts, pastHour + 120);
});

test('aggregation is idempotent and sets a high-water mark', () => {
  assert.notEqual(db.getMeta('last_aggregated_hour'), null);
  db.runAggregation();
  const r = db.getHourlyReadings('temperature', pastHour, pastHour)[0];
  assert.equal(r.value, 20); // unchanged after re-run
});
