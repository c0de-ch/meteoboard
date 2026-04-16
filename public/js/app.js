/* App — Main application logic, WebSocket, state management */

const state = {
  currentValues: {},
  meta: {},
  connected: false,
  selectedRange: '24h',
};

let ws = null;
let reconnectTimeout = null;

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

    // Initialize UI
    Widgets.init(state.meta);
    Widgets.updateAll(state.currentValues);
    Charts.init(state.meta);
    await Charts.loadAll(state.selectedRange);

    // Connect WebSocket
    connectWebSocket();

    // Time range selector
    document.querySelectorAll('.time-range-selector button').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelector('.time-range-selector .active').classList.remove('active');
        btn.classList.add('active');
        state.selectedRange = btn.dataset.range;
        await Charts.loadAll(state.selectedRange);
      });
    });

  } catch (err) {
    console.error('[App] Init error:', err);
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
      }
      Widgets.updateAll(state.currentValues);
      break;

    case 'reading':
      state.currentValues[msg.data.sensor] = msg.data;
      Widgets.updateSingle(msg.data.sensor, msg.data);
      Charts.appendPoint(msg.data.sensor, msg.data);
      updateTimestamp(msg.data.timestamp);
      break;

    case 'device-status':
      if (msg.data.battery !== undefined) Widgets.updateBattery(msg.data.battery);
      if (msg.data.rssi !== undefined) Widgets.updateRssi(msg.data.rssi);
      break;
  }
}

function updateTimestamp(ts) {
  const el = document.getElementById('last-update');
  if (el) {
    const date = new Date(ts * 1000);
    el.textContent = date.toLocaleTimeString();
  }
}

document.addEventListener('DOMContentLoaded', init);
