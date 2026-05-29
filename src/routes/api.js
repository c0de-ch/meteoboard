const express = require('express');
const router = express.Router();
const db = require('../database');
const config = require('../config');

const RANGE_SECONDS = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '7d': 604800,
  '30d': 2592000,
};

// Guardrails for explicit from/to queries on a trusted-but-shared LAN.
const MAX_SPAN_SECONDS = 366 * 86400; // never query more than ~1 year at once
const MAX_SENSORS_PER_REQUEST = 20;

// GET /api/current — latest value per sensor
router.get('/current', (_req, res) => {
  const rows = db.getAllLatest();
  const result = {};
  for (const row of rows) {
    result[row.sensor] = { value: row.value, timestamp: row.timestamp };
  }
  res.json(result);
});

// GET /api/history/:sensor?range=24h
router.get('/history/:sensor', (req, res) => {
  const { sensor } = req.params;
  const range = req.query.range || '24h';
  const now = Math.floor(Date.now() / 1000);

  let from, to;
  if (req.query.from !== undefined && req.query.to !== undefined) {
    from = parseInt(req.query.from, 10);
    to = parseInt(req.query.to, 10);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to) {
      return res.status(400).json({ error: 'Invalid from/to: must be integers with from < to' });
    }
    // Clamp absurd spans so a single request can't materialize the whole table.
    if (to - from > MAX_SPAN_SECONDS) from = to - MAX_SPAN_SECONDS;
  } else {
    to = now;
    from = now - (RANGE_SECONDS[range] || 86400);
  }

  const readings = db.getHistory(sensor, from, to);
  res.json({ sensor, from, to, count: readings.length, readings });
});

// GET /api/history?sensors=temperature,humidity&range=24h
router.get('/history', (req, res) => {
  const sensors = (req.query.sensors || '').split(',').filter(Boolean).slice(0, MAX_SENSORS_PER_REQUEST);
  const range = req.query.range || '24h';
  const now = Math.floor(Date.now() / 1000);
  const to = now;
  const from = now - (RANGE_SECONDS[range] || 86400);

  const data = {};
  for (const sensor of sensors) {
    data[sensor] = db.getHistory(sensor, from, to);
  }
  res.json({ from, to, data });
});

// GET /api/meta — sensor metadata
router.get('/meta', (_req, res) => {
  res.json(config.sensorMeta);
});

// GET /api/rain/accumulation?range=24h
router.get('/rain/accumulation', (req, res) => {
  const range = req.query.range || '24h';
  const now = Math.floor(Date.now() / 1000);
  const from = now - (RANGE_SECONDS[range] || 86400);

  const readings = db.getReadings('precipitation', from, now);
  let accumulation = 0;
  if (readings.length >= 2) {
    // Handle counter resets: sum positive deltas
    for (let i = 1; i < readings.length; i++) {
      const delta = readings[i].value - readings[i - 1].value;
      if (delta > 0) accumulation += delta;
    }
  }
  res.json({ range, from, to: now, accumulation_mm: Math.round(accumulation * 10) / 10 });
});

module.exports = router;
