/* Widgets — Current-value sensor cards */

const WIDGET_ICONS = {
  temperature:    '\u{1F321}\uFE0F',
  humidity:       '\u{1F4A7}',
  pressure:       '\u{1F4CA}',
  illuminance:    '\u2600\uFE0F',
  dew_point:      '\u{1F4A7}',
  wind_speed:     '\u{1F4A8}',
  wind_gust:      '\u{1F32A}\uFE0F',
  uv_index:       '\u2618\uFE0F',
  precipitation:  '\u{1F327}\uFE0F',
  rain_status:    '\u2614',
};

// Sensors that get a meaningful high/low (gauge-type). Counters (precipitation),
// circular (wind_direction) and boolean (rain_status) are excluded.
function showsStats(sensor, meta) {
  return !meta.agg && sensor !== 'rain_status';
}

const Widgets = {
  meta: {},
  _elements: {},
  _statElements: {},

  init(meta) {
    this.meta = meta;
    this._elements = {};
    this._statElements = {};
    const grid = document.getElementById('current-readings');
    grid.textContent = '';

    // Sensors shown as cards (wind_direction uses compass instead)
    const widgetSensors = [
      'temperature', 'humidity', 'pressure', 'dew_point',
      'wind_speed', 'wind_gust', 'uv_index', 'illuminance',
      'precipitation', 'rain_status',
    ];

    for (const sensor of widgetSensors) {
      const m = meta[sensor];
      if (!m) continue;

      const card = document.createElement('div');
      card.className = 'widget-card';
      card.dataset.sensor = sensor;
      card.id = `widget-${sensor}`;

      // Build with DOM nodes + textContent (no HTML interpolation of metadata).
      const icon = document.createElement('div');
      icon.className = 'icon';
      icon.textContent = WIDGET_ICONS[sensor] || '';

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = m.label;

      const value = document.createElement('div');
      value.className = 'value loading';
      value.id = `value-${sensor}`;
      value.textContent = '--';

      const unit = document.createElement('div');
      unit.className = 'unit';
      unit.textContent = m.unit;

      card.append(icon, label, value, unit);

      if (showsStats(sensor, m)) {
        const stats = document.createElement('div');
        stats.className = 'stats';
        stats.id = `stats-${sensor}`;
        card.append(stats);
        this._statElements[sensor] = stats;
      }

      grid.appendChild(card);
      this._elements[sensor] = value;
    }
  },

  // statsBySensor: { sensor: { min, max, avg, ... } | null }
  updateStats(statsBySensor) {
    for (const [sensor, el] of Object.entries(this._statElements)) {
      const m = this.meta[sensor];
      const s = statsBySensor[sensor];
      if (!m || !s || s.min == null || s.max == null) {
        el.textContent = '';
        continue;
      }
      const hi = Number(s.max).toFixed(m.precision);
      const lo = Number(s.min).toFixed(m.precision);
      el.textContent = `H ${hi} · L ${lo}`;
    }
  },

  updateAll(values) {
    for (const [sensor, data] of Object.entries(values)) {
      this.updateSingle(sensor, data);
    }
  },

  updateSingle(sensor, data) {
    const m = this.meta[sensor];
    if (!m) return;

    const el = this._elements[sensor];
    if (el) {
      el.classList.remove('loading');

      let displayValue;
      if (sensor === 'rain_status') {
        displayValue = data.value ? 'Raining' : 'Dry';
      } else {
        displayValue = Number(data.value).toFixed(m.precision);
      }
      el.textContent = displayValue;

      // Flash animation
      const card = el.closest('.widget-card');
      if (card) {
        card.classList.remove('updated');
        void card.offsetWidth; // force reflow
        card.classList.add('updated');
      }
    }

    // Update wind displays
    if (sensor === 'wind_speed') {
      const el2 = document.getElementById('wind-speed-display');
      if (el2) el2.textContent = Number(data.value).toFixed(1);
    }
    if (sensor === 'wind_gust') {
      const el2 = document.getElementById('wind-gust-display');
      if (el2) el2.textContent = Number(data.value).toFixed(1);
    }
    if (sensor === 'wind_direction') {
      WindRose.setDirection(Number(data.value));
    }
  },

  updateBattery(percent) {
    const el = document.getElementById('battery-indicator');
    if (!el) return;
    let icon, cls;
    if (percent >= 50) { icon = '\u{1F50B}'; cls = 'battery-ok'; }
    else if (percent >= 20) { icon = '\u{1FAAB}'; cls = 'battery-mid'; }
    else { icon = '\u{1FAAB}'; cls = 'battery-low'; }
    el.textContent = `${icon} ${percent}%`;
    el.className = cls;
  },

  updateRssi(rssi) {
    const el = document.getElementById('rssi-indicator');
    if (!el) return;
    let bars;
    if (rssi > -50) bars = '\u2587\u2587\u2587\u2587';
    else if (rssi > -65) bars = '\u2587\u2587\u2587\u2581';
    else if (rssi > -80) bars = '\u2587\u2587\u2581\u2581';
    else bars = '\u2587\u2581\u2581\u2581';
    el.textContent = `${bars} ${rssi}dBm`;
  },
};
