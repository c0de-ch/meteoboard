# MeteoBoard

Weather dashboard for the **Shelly WS90** (SBWS-90CM) weather station via **Shelly BLU Gateway Gen3**.

Displays real-time and historical data from all 7 sensors: temperature, humidity, pressure, wind speed/gust/direction, rain, illuminance, UV index, and dew point.

## Features

- **Live dashboard** — real-time sensor updates via WebSocket (~9s refresh)
- **Historical charts** — temperature, humidity, pressure, wind, rain, light/UV with selectable time ranges (1h, 6h, 24h, 7d, 30d)
- **High / low records** — per-range min and max shown on each sensor card
- **Threshold alerts** — in-dashboard banners for frost, high wind gust, rain, and low station battery
- **Stale-data detection** — dims the dashboard and shows "no data for Xm" if the station stops reporting
- **Data export** — download any range as CSV or JSON
- **Responsive design** — works on desktop, tablet, and mobile
- **Wind compass** — SVG wind direction indicator with cardinal labels
- **Auto-discovery** — setup wizard finds your sensors automatically
- **Lightweight** — Node.js + SQLite, no external database needed
- **LXC-ready** — one-command install with systemd service

## Architecture

```
WS90 ──BLE──▶ Shelly BLU Gateway Gen3 ──MQTT──▶ Broker ──MQTT──▶ MeteoBoard
                                                                    ├── Express (REST API)
                                                                    ├── WebSocket (live push)
                                                                    └── SQLite (history)
```

## Requirements

- **LXC container** (or any Debian/Ubuntu machine) with network access
- **Node.js 18+** (installer handles this)
- **MQTT broker** (e.g., Mosquitto) — already running on your network
- **Shelly BLU Gateway Gen3** paired with the WS90

## Quick Start

### On your LXC container:

```bash
# Clone the repository
git clone https://github.com/your-user/meteoboard.git
cd meteoboard

# Run the automated installer (as root)
sudo bash install.sh
```

The installer will:
1. Install Node.js 20 LTS and build tools
2. Create a `meteoboard` system user
3. Install the application to `/opt/meteoboard`
4. Launch the **interactive setup wizard** to configure MQTT and auto-discover sensors
5. Install and start a systemd service

### Manual Installation

```bash
# Install dependencies
npm install

# Run the setup wizard
npm run setup

# Start the dashboard
npm start

# Or in dev mode (auto-restart on file changes)
npm run dev
```

Open `http://<your-ip>:3000` in your browser.

## Shelly Gateway Setup

Before MeteoBoard can receive data, your Shelly BLU Gateway Gen3 must have MQTT enabled with status notifications:

### 1. Enable MQTT on the gateway

Open the gateway's web UI (`http://<gateway-ip>`), go to **Settings > MQTT**, and:
- Enable MQTT
- Set your broker URL (e.g., `192.168.1.100:1883`)
- **Enable "Status notifications over MQTT"** (`status_ntf`) — this is critical!

Or via RPC:
```bash
curl -X POST http://<gateway-ip>/rpc/MQTT.SetConfig \
  -d '{"config":{"enable":true,"server":"192.168.1.100:1883","status_ntf":true}}'
```

### 2. Pair the WS90

Use the Shelly app or the gateway's web UI to add the WS90 as a BTHome device.

### 3. Note the topic prefix

The MQTT topic prefix is shown in the gateway's MQTT settings. It's typically the device ID, e.g., `shellyblugwg3-AABBCCDDEEFF`.

## Sensor Discovery

Sensor component IDs are assigned by the gateway and vary per installation. The setup wizard auto-discovers them, but you can also run discovery manually:

```bash
# Auto-discover (interactive)
npm run discover

# With explicit parameters
node scripts/discover-sensors.js mqtt://192.168.1.100:1883 shellyblugwg3-AABBCCDDEEFF
```

Or use `mosquitto_sub` directly:
```bash
mosquitto_sub -h 192.168.1.100 -t 'shellyblugwg3-AABBCCDDEEFF/status/bthomesensor:+' -v
```

## Configuration

All settings are in `.env` (copy from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | MQTT broker connection URL |
| `MQTT_TOPIC_PREFIX` | — | Shelly gateway device ID / custom prefix |
| `SENSOR_MAP` | — | Sensor-to-component-ID mapping (see discovery) |
| `DEVICE_ID` | `202` | BTHomeDevice component ID (battery/RSSI) |
| `PORT` | `3000` | Dashboard HTTP port |
| `HOST` | `0.0.0.0` | Listen address |
| `DB_PATH` | `./data/meteoboard.db` | SQLite database path |
| `DATA_RETENTION_DAYS` | `30` | Keep raw data (high-res) for N days |
| `AGGREGATE_RETENTION_DAYS` | `365` | Keep hourly aggregates for N days |

### SENSOR_MAP Format

```
SENSOR_MAP=temperature=213,humidity=214,pressure=216,illuminance=207,dew_point=215,wind_speed=209,wind_gust=210,uv_index=211,wind_direction=212,precipitation=218,rain_status=208
```

Each entry is `sensor_name=component_id`. The component IDs come from your gateway's BTHomeSensor configuration.

### Alert Thresholds

Threshold alerts (frost, high wind gust, rain, low battery) are defined in the `alerts` array in `src/config.js`. Each rule is `{ key, sensor, op, value, label, severity }` where `op` is one of `lte`/`gte`/`lt`/`gt`/`eq`. Edit the array to add, remove, or retune alerts; restart the service to apply.

## API Reference

### Current readings
```bash
GET /api/current
# Returns: { "temperature": { "value": 23.5, "timestamp": 1713200000 }, ... }
```

### Historical data (single sensor)
```bash
GET /api/history/temperature?range=24h
# Returns: { "sensor": "temperature", "from": ..., "to": ..., "readings": [...] }
# Ranges: 1h, 6h, 24h, 7d, 30d
```

### Historical data (multiple sensors)
```bash
GET /api/history?sensors=temperature,humidity&range=24h
# Returns: { "from": ..., "to": ..., "data": { "temperature": [...], "humidity": [...] } }
```

### Rain accumulation
```bash
GET /api/rain/accumulation?range=24h
# Returns: { "accumulation_mm": 2.4 }
```

### Statistics (min / avg / max + time of extremes)
```bash
GET /api/stats?sensors=temperature,humidity&range=24h
# range: 1h, 6h, 24h, 7d, 30d, today, alltime
# Returns: { "stats": { "temperature": { "min": 9.3, "min_ts": ..., "max": 24.1, "max_ts": ..., "avg": 16.8 }, ... } }
```

### Data export (CSV / JSON)
```bash
GET /api/export?sensors=temperature,humidity&range=7d&format=csv
# format: csv (default) or json; omit sensors to export all
# Streams a file download (timestamp,datetime,sensor,value)
```

### Sensor metadata
```bash
GET /api/meta
# Returns: { "temperature": { "label": "Temperature", "unit": "°C", "precision": 1 }, ... }
```

## Data Storage

MeteoBoard uses a two-tier SQLite storage strategy:

- **Raw readings** — stored at full resolution (~9s intervals) for `DATA_RETENTION_DAYS` (default: 30 days)
- **Hourly aggregates** — min/avg/max per hour for `AGGREGATE_RETENTION_DAYS` (default: 365 days)

The API automatically serves raw data for short ranges (<=24h) and aggregated data for longer ranges.

Database location: `./data/meteoboard.db` (configurable via `DB_PATH`)

## Security

MeteoBoard is designed to **never run as root**:

- The installer creates a dedicated `meteoboard` system user with no login shell (`/usr/sbin/nologin`)
- The application **refuses to start** if executed as root
- The systemd service runs as `User=meteoboard` with hardened security directives:
  - `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`
  - `CapabilityBoundingSet=` (no capabilities), `RestrictNamespaces`, `RestrictSUIDSGID`
  - `ReadWritePaths` limited to the `data/` directory only
- The `.env` file (may contain MQTT credentials) is `chmod 600`, owned by the app user

## Service Management

```bash
# Check status
systemctl status meteoboard

# View live logs
journalctl -u meteoboard -f

# Restart after config change
systemctl restart meteoboard

# Stop
systemctl stop meteoboard
```

## Updating

If you installed from a release tarball (the recommended path), download the
new release and re-run the installer. It updates the code in place, rebuilds
native modules if needed, and preserves your existing `.env` and `data/`
(the setup wizard detects the existing `.env` and asks before overwriting —
answer **N** to keep your config):

```bash
wget https://github.com/c0de-ch/meteoboard/releases/latest/download/meteoboard-<version>.tar.gz
tar -xzf meteoboard-<version>.tar.gz
cd meteoboard-<version>
sudo bash install.sh
```

For a **git-based development checkout** (where `/opt/meteoboard` is a git repo):

```bash
cd /opt/meteoboard
sudo systemctl stop meteoboard
sudo -u meteoboard git pull
sudo -u meteoboard npm install --production
sudo systemctl start meteoboard
```

Your `.env` and `data/` directory are preserved across updates.

## Troubleshooting

### No data showing on the dashboard

1. **Check MQTT connection**: Look at the server logs (`journalctl -u meteoboard -f`). You should see `[MQTT] Connected` and `[MQTT] Subscribed`.

2. **Verify `status_ntf` is enabled**: On your Shelly gateway, ensure MQTT status notifications are turned on. This is the most common issue.

3. **Check sensor mapping**: Run `npm run discover` to verify the component IDs match your gateway.

4. **Test MQTT directly**:
   ```bash
   mosquitto_sub -h <broker> -t '<prefix>/status/bthomesensor:+' -v
   ```
   You should see messages every ~9 seconds.

### Dashboard loads but shows "--" for all values

The WS90 sends data in alternating packets. Wait at least 20 seconds for all sensors to report. If still empty, check the MQTT connection in the logs.

### Database locked error

Ensure only one instance of MeteoBoard is running:
```bash
systemctl status meteoboard
ps aux | grep meteoboard
```

### Charts are empty

Charts populate from historical data. If you just started MeteoBoard, wait a few minutes for data to accumulate, then refresh the page.

## License

MIT
