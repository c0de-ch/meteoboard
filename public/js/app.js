/* App — Main application logic, WebSocket, state management */

const state = {
  currentValues: {},
  meta: {},
  connected: false,
  selectedRange: '24h',
  alerts: {},          // key -> active alert
  lastReadingTs: null, // device timestamp (s) of the newest reading seen
};

// Consider data stale if the newest reading is older than this (station reports
// roughly every ~9s; this allows for clock skew and a few missed packets).
const STALE_SECONDS = 180;

let ws = null;
let reconnectTimeout = null;
let staleTimerStarted = false;

async function init() {
  try {
    // Fetch sensor metadata
    const metaRes = await fetch('/api/meta');
    state.meta = await metaRes.json();

    // Fetch current values
    const currentRes = await fetch('/api/current');
    const currentData = await currentRes.json();
    for (const [sensor, data] of Object.entries(currentData)) {
      state.currentValues[sensor] = data;
    }

    // Seed the staleness clock from the newest current value, if any.
    for (const d of Object.values(state.currentValues)) {
      if (d && d.timestamp) state.lastReadingTs = Math.max(state.lastReadingTs || 0, d.timestamp);
    }

    // Initialize UI
    Widgets.init(state.meta);
    Widgets.updateAll(state.currentValues);
    Charts.init(state.meta);
    await Charts.loadAll(state.selectedRange);
    await loadStats(state.selectedRange);

    // Connect WebSocket
    connectWebSocket();

    // Time range selector
    document.querySelectorAll('.time-range-selector button').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.range === state.selectedRange) return; // already showing it
        document.querySelector('.time-range-selector .active').classList.remove('active');
        btn.classList.add('active');
        state.selectedRange = btn.dataset.range;
        await Charts.loadAll(state.selectedRange);
        await loadStats(state.selectedRange);
      });
    });

    // Export current range as CSV
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        window.location = `/api/export?range=${state.selectedRange}&format=csv`;
      });
    }

    // Staleness watchdog (start once, even if init re-runs after a retry)
    if (!staleTimerStarted) {
      staleTimerStarted = true;
      setInterval(checkStale, 15000);
    }
    checkStale();

  } catch (err) {
    console.error('[App] Init error:', err);
    showLoadError();
  }
}

async function loadStats(range) {
  try {
    const res = await fetch(`/api/stats?range=${range}`);
    const json = await res.json();
    Widgets.updateStats(json.stats || {});
  } catch (err) {
    console.error('[Stats] Failed to load:', err);
  }
}

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    state.connected = true;
    const dot = document.getElementById('connection-status');
    dot.classList.add('connected');
    dot.title = 'Connected';
    clearTimeout(reconnectTimeout);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (err) {
      console.error('[WS] Parse error:', err);
    }
  };

  ws.onclose = () => {
    state.connected = false;
    const dot = document.getElementById('connection-status');
    dot.classList.remove('connected');
    dot.title = 'Disconnected — reconnecting...';
    reconnectTimeout = setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'init':
      for (const [sensor, data] of Object.entries(msg.data)) {
        state.currentValues[sensor] = data;
        if (data && data.timestamp) {
          state.lastReadingTs = Math.max(state.lastReadingTs || 0, data.timestamp);
        }
      }
      Widgets.updateAll(state.currentValues);
      checkStale();
      break;

    case 'reading':
      state.currentValues[msg.data.sensor] = msg.data;
      Widgets.updateSingle(msg.data.sensor, msg.data);
      Charts.appendPoint(msg.data.sensor, msg.data);
      state.lastReadingTs = msg.data.timestamp;
      checkStale();
      break;

    case 'device-status':
      if (msg.data.battery !== undefined) Widgets.updateBattery(msg.data.battery);
      if (msg.data.rssi !== undefined) Widgets.updateRssi(msg.data.rssi);
      break;

    case 'alerts': // full snapshot of active alerts (on connect)
      state.alerts = {};
      for (const a of msg.data || []) state.alerts[a.key] = a;
      renderAlerts();
      break;

    case 'alert': // single edge (activated / cleared)
      if (msg.data.active) state.alerts[msg.data.key] = msg.data;
      else delete state.alerts[msg.data.key];
      renderAlerts();
      break;
  }
}

function renderAlerts() {
  const banner = document.getElementById('alert-banner');
  if (!banner) return;
  const active = Object.values(state.alerts);

  banner.textContent = '';
  if (active.length === 0) {
    banner.hidden = true;
    return;
  }

  // Highest severity present drives the banner color.
  const severity = active.some(a => a.severity === 'warning') ? 'warning' : 'info';
  banner.className = `alert-banner ${severity}`;
  for (const a of active) {
    const chip = document.createElement('span');
    chip.className = 'alert-chip';
    chip.textContent = a.label; // server-controlled, static labels
    banner.appendChild(chip);
  }
  banner.hidden = false;
}

function checkStale() {
  const nowSec = Math.floor(Date.now() / 1000);
  const stale = state.lastReadingTs != null && nowSec - state.lastReadingTs > STALE_SECONDS;
  document.body.classList.toggle('data-stale', stale);
  renderLastUpdate(stale, nowSec);
}

function renderLastUpdate(stale, nowSec) {
  const el = document.getElementById('last-update');
  if (!el) return;
  if (state.lastReadingTs == null) {
    el.textContent = '';
    return;
  }
  if (stale) {
    el.textContent = `⚠ no data for ${formatAgo(nowSec - state.lastReadingTs)}`;
  } else {
    el.textContent = new Date(state.lastReadingTs * 1000).toLocaleTimeString();
  }
}

function formatAgo(seconds) {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function showLoadError() {
  const banner = document.getElementById('alert-banner');
  if (!banner) return;
  banner.className = 'alert-banner warning';
  banner.textContent = '';
  const chip = document.createElement('span');
  chip.className = 'alert-chip';
  chip.textContent = 'Unable to load data — is the server running? Retrying…';
  banner.appendChild(chip);
  banner.hidden = false;
  setTimeout(init, 5000);
}

document.addEventListener('DOMContentLoaded', init);
