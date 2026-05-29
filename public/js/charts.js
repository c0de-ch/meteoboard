/* Charts — Chart.js time-series configuration and management */

const CHART_RANGE_SECONDS = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '7d': 604800,
  '30d': 2592000,
};

const Charts = {
  instances: {},
  meta: {},
  range: '24h',
  rangeSeconds: 86400,
  usesHourly: false, // ranges > 24h are served as hourly aggregates

  init(meta) {
    this.meta = meta;

    // Chart.js dark theme defaults
    Chart.defaults.color = '#8b949e';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    Chart.defaults.font.size = 11;

    // Temperature + Dew Point
    this.instances.temperature = this._createChart('chart-temperature', [
      { key: 'temperature', label: 'Temperature', color: '#e94560' },
      { key: 'dew_point', label: 'Dew Point', color: '#4ecca3', borderDash: [4, 4] },
    ], {
      y: { title: '\u00b0C' },
    });

    // Humidity + Pressure (dual axis)
    this.instances.humidityPressure = this._createChart('chart-humidity-pressure', [
      { key: 'humidity', label: 'Humidity', color: '#3498db', yAxisID: 'y' },
      { key: 'pressure', label: 'Pressure', color: '#f39c12', yAxisID: 'y1' },
    ], {
      y:  { title: '%', position: 'left' },
      y1: { title: 'hPa', position: 'right', grid: false },
    });

    // Wind Speed + Gust
    this.instances.wind = this._createChart('chart-wind', [
      { key: 'wind_speed', label: 'Speed', color: '#2ecc71' },
      { key: 'wind_gust', label: 'Gust', color: '#e74c3c', borderDash: [4, 4] },
    ], {
      y: { title: 'm/s', beginAtZero: true },
    });

    // Precipitation
    this.instances.rain = this._createChart('chart-rain', [
      { key: 'precipitation', label: 'Precipitation', color: '#3498db',
        fill: true, bgColor: 'rgba(52,152,219,0.15)' },
    ], {
      y: { title: 'mm', beginAtZero: true },
    });

    // Light + UV (dual axis)
    this.instances.lightUv = this._createChart('chart-light-uv', [
      { key: 'illuminance', label: 'Light', color: '#f1c40f', yAxisID: 'y' },
      { key: 'uv_index', label: 'UV Index', color: '#9b59b6', yAxisID: 'y1' },
    ], {
      y:  { title: 'lux', position: 'left', beginAtZero: true },
      y1: { title: 'UV', position: 'right', beginAtZero: true, grid: false },
    });
  },

  _createChart(canvasId, datasets, scalesConfig) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    const scales = { x: this._timeAxis() };
    for (const [id, cfg] of Object.entries(scalesConfig)) {
      scales[id] = {
        position: cfg.position || 'left',
        beginAtZero: cfg.beginAtZero || false,
        title: { display: true, text: cfg.title, color: '#8b949e' },
        grid: cfg.grid === false
          ? { drawOnChartArea: false }
          : { color: 'rgba(255,255,255,0.04)' },
        ticks: { maxTicksLimit: 6 },
      };
    }

    return new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: datasets.map(ds => ({
          label: ds.label,
          data: [],
          borderColor: ds.color,
          backgroundColor: ds.bgColor || 'transparent',
          fill: ds.fill || false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 1.5,
          borderDash: ds.borderDash || [],
          yAxisID: ds.yAxisID || 'y',
          _sensorKey: ds.key,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            mode: 'index',
            backgroundColor: 'rgba(22, 27, 34, 0.95)',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#e6edf3',
            bodyColor: '#8b949e',
            padding: 10,
          },
          legend: {
            position: 'top',
            labels: { boxWidth: 12, padding: 15 },
          },
          decimation: {
            enabled: true,
            algorithm: 'lttb',
            samples: 500,
          },
        },
        scales,
      },
    });
  },

  _timeAxis() {
    return {
      type: 'time',
      time: {
        tooltipFormat: 'yyyy-MM-dd HH:mm',
        displayFormats: {
          minute: 'HH:mm',
          hour: 'HH:mm',
          day: 'MMM dd',
        },
      },
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: { maxTicksLimit: 8, maxRotation: 0 },
    };
  },

  async loadAll(range) {
    this.range = range;
    this.rangeSeconds = CHART_RANGE_SECONDS[range] || 86400;
    // The server serves hourly aggregates for ranges longer than 24h.
    this.usesHourly = this.rangeSeconds > 86400;

    const allKeys = new Set();
    for (const chart of Object.values(this.instances)) {
      if (!chart) continue;
      for (const ds of chart.data.datasets) {
        allKeys.add(ds._sensorKey);
      }
    }

    try {
      const res = await fetch(`/api/history?sensors=${[...allKeys].join(',')}&range=${range}`);
      const json = await res.json();

      const now = Date.now();
      const min = now - this.rangeSeconds * 1000;
      for (const chart of Object.values(this.instances)) {
        if (!chart) continue;
        for (const ds of chart.data.datasets) {
          const readings = json.data[ds._sensorKey] || [];
          ds.data = readings.map(r => ({ x: r.timestamp * 1000, y: r.value }));
        }
        // Pin the visible window to the selected range so it doesn't drift.
        chart.options.scales.x.min = min;
        chart.options.scales.x.max = now;
        chart.update('none');
      }
    } catch (err) {
      console.error('[Charts] Failed to load history:', err);
    }
  },

  appendPoint(sensor, reading) {
    // On aggregate (>24h) views the series is hourly averages; appending raw
    // sub-hour points would clash with the smoothed line, so skip them.
    if (this.usesHourly) return;

    const x = reading.timestamp * 1000;
    const cutoff = x - this.rangeSeconds * 1000;

    for (const chart of Object.values(this.instances)) {
      if (!chart) continue;
      let modified = false;
      for (const ds of chart.data.datasets) {
        if (ds._sensorKey === sensor) {
          ds.data.push({ x, y: reading.value });
          modified = true;
        }
      }
      if (!modified) continue;

      // Slide the window: drop points older than the selected range and pin
      // the axis to [cutoff, x] so the view shows exactly the chosen span.
      for (const ds of chart.data.datasets) {
        if (ds.data.length && ds.data[0].x < cutoff) {
          ds.data = ds.data.filter(p => p.x >= cutoff);
        }
      }
      chart.options.scales.x.min = cutoff;
      chart.options.scales.x.max = x;
      chart.update('none'); // once per chart, after all its datasets are updated
    }
  },
};
