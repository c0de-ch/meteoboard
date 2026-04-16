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

const Widgets = {
  meta: {},
  _elements: {},

  init(meta) {
    this.meta = meta;
    const grid = document.getElementById('current-readings');
    grid.innerHTML = '';

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

      const icon = WIDGET_ICONS[sensor] || '';

      card.innerHTML = `
        <div class="icon">${icon}</div>
        <div class="label">${m.label}</div>
        <div class="value loading" id="value-${sensor}">--</div>
        <div class="unit">${m.unit}</div>
      `;
      grid.appendChild(card);
      this._elements[sensor] = document.getElementById(`value-${sensor}`);
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
