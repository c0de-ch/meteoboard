const test = require('node:test');
const assert = require('node:assert');
const AlertManager = require('../src/alerts');

const RULES = [
  { key: 'frost', sensor: 'temperature', op: 'lte', value: 0.5, label: 'Frost risk', severity: 'warning' },
  { key: 'gust', sensor: 'wind_gust', op: 'gte', value: 15, label: 'High gust', severity: 'warning' },
  { key: 'rain', sensor: 'rain_status', op: 'eq', value: 1, label: 'Rain', severity: 'info' },
];

test('only emits edges, not every reading', () => {
  const am = new AlertManager(RULES);
  assert.deepEqual(am.evaluate('temperature', 5, 1), []);            // above threshold, no edge
  const on = am.evaluate('temperature', -1, 2);
  assert.equal(on.length, 1);
  assert.equal(on[0].key, 'frost');
  assert.equal(on[0].active, true);
  assert.deepEqual(am.evaluate('temperature', -2, 3), []);           // still active, no new edge
  const off = am.evaluate('temperature', 4, 4);
  assert.equal(off.length, 1);
  assert.equal(off[0].active, false);
});

test('eq operator and snapshot of active alerts', () => {
  const am = new AlertManager(RULES);
  am.evaluate('wind_gust', 20, 1);
  am.evaluate('rain_status', 1, 2);
  const snap = am.snapshot();
  assert.deepEqual(snap.map((a) => a.key).sort(), ['gust', 'rain']);
  assert.ok(snap.every((a) => a.active === true));
  // clearing rain removes it from the snapshot
  am.evaluate('rain_status', 0, 3);
  assert.deepEqual(am.snapshot().map((a) => a.key), ['gust']);
});

test('unknown sensor and unknown op never fire', () => {
  const am = new AlertManager([{ key: 'x', sensor: 'temperature', op: 'weird', value: 0 }]);
  assert.deepEqual(am.evaluate('humidity', 50, 1), []);
  assert.deepEqual(am.evaluate('temperature', -100, 2), []);
});
