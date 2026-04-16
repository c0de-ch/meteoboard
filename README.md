# MeteoBoard

Weather dashboard for the **Shelly WS90** (SBWS-90CM) weather station via **Shelly BLU Gateway Gen3**.

Displays real-time and historical data from all 7 sensors: temperature, humidity, pressure, wind speed/gust/direction, rain, illuminance, UV index, and dew point.

## Features

- **Live dashboard** — real-time sensor updates via WebSocket (~9s refresh)
- **Historical charts** — temperature, humidity, pressure, wind, rain, light/UV with selectable time ranges (1h, 6h, 24h, 7d, 30d)
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

```bash
cd /opt/meteoboard
sudo systemctl stop meteoboard

# Pull latest code (or copy new files)
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
