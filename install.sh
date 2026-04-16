#!/bin/bash
set -euo pipefail

# ============================================================================
# MeteoBoard — Automated Installer
# ============================================================================
# This script installs MeteoBoard on a Debian/Ubuntu LXC container.
# Run as root: sudo bash install.sh
#
# What it does:
#   1. Installs Node.js 20 LTS and build tools (if not present)
#   2. Creates a 'meteoboard' system user
#   3. Installs the application to /opt/meteoboard
#   4. Runs the interactive setup wizard
#   5. Creates and enables a systemd service
# ============================================================================

APP_DIR="/opt/meteoboard"
APP_USER="meteoboard"
SERVICE_NAME="meteoboard"
NODE_MAJOR=20

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[MeteoBoard]${NC} $*"; }
warn()  { echo -e "${YELLOW}[MeteoBoard]${NC} $*"; }
error() { echo -e "${RED}[MeteoBoard]${NC} $*"; exit 1; }

banner() {
  echo ""
  echo -e "${BLUE}"
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║                                              ║"
  echo "  ║   ☁  MeteoBoard Installer                   ║"
  echo "  ║                                              ║"
  echo "  ║   Weather Dashboard for Shelly WS90          ║"
  echo "  ║                                              ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo -e "${NC}"
}

check_root() {
  if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root. Try: sudo bash install.sh"
  fi
}

detect_os() {
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS_ID="${ID}"
    OS_VERSION="${VERSION_ID}"
    log "Detected OS: ${PRETTY_NAME}"
  else
    error "Cannot detect OS. This installer supports Debian and Ubuntu."
  fi

  case "${OS_ID}" in
    debian|ubuntu|linuxmint|proxmox) ;;
    *) warn "Untested OS: ${OS_ID}. Proceeding anyway..." ;;
  esac
}

install_nodejs() {
  if command -v node &>/dev/null; then
    local current_version
    current_version=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "${current_version}" -ge 18 ]]; then
      log "Node.js $(node -v) already installed — OK"
      return
    else
      warn "Node.js $(node -v) is too old. Installing Node.js ${NODE_MAJOR}..."
    fi
  else
    log "Installing Node.js ${NODE_MAJOR} LTS..."
  fi

  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null

  mkdir -p /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/nodesource.gpg ]]; then
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | \
      gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  fi

  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > \
    /etc/apt/sources.list.d/nodesource.list

  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null

  log "Node.js $(node -v) installed"
}

install_build_tools() {
  if dpkg -l build-essential &>/dev/null 2>&1; then
    log "Build tools already installed — OK"
    return
  fi

  log "Installing build tools (needed for better-sqlite3)..."
  apt-get install -y -qq build-essential python3 >/dev/null
  log "Build tools installed"
}

create_user() {
  if id "${APP_USER}" &>/dev/null; then
    log "User '${APP_USER}' already exists — OK"
  else
    log "Creating system user '${APP_USER}' (no login shell)..."
    useradd -r -d "${APP_DIR}" -s /usr/sbin/nologin "${APP_USER}"
    log "User created"
  fi
}

install_app() {
  log "Installing application to ${APP_DIR}..."

  mkdir -p "${APP_DIR}"

  # Determine source directory (where this script lives)
  local SCRIPT_DIR
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  # Copy application files
  cp -r "${SCRIPT_DIR}/package.json" "${APP_DIR}/"
  cp -r "${SCRIPT_DIR}/package-lock.json" "${APP_DIR}/" 2>/dev/null || true
  cp -r "${SCRIPT_DIR}/src" "${APP_DIR}/"
  cp -r "${SCRIPT_DIR}/public" "${APP_DIR}/"
  cp -r "${SCRIPT_DIR}/scripts" "${APP_DIR}/"

  # Copy .env.example if no .env exists yet
  if [[ ! -f "${APP_DIR}/.env" ]]; then
    cp "${SCRIPT_DIR}/.env.example" "${APP_DIR}/.env.example"
  fi

  # Restrict .env permissions (may contain MQTT credentials)
  if [[ -f "${APP_DIR}/.env" ]]; then
    chmod 600 "${APP_DIR}/.env"
    chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
  fi
  if [[ -f "${APP_DIR}/.env.example" ]]; then
    chmod 640 "${APP_DIR}/.env.example"
  fi

  # Copy pre-built node_modules from release tarball if available
  if [[ -d "${SCRIPT_DIR}/node_modules" ]]; then
    log "Using bundled node_modules from release package..."
    cp -r "${SCRIPT_DIR}/node_modules" "${APP_DIR}/"
  fi

  # Create data directory
  mkdir -p "${APP_DIR}/data"

  # Set ownership
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

  # Install/verify npm dependencies
  cd "${APP_DIR}"
  if [[ -d "${APP_DIR}/node_modules/better-sqlite3" ]]; then
    log "Dependencies already present — OK"
  else
    log "Installing npm dependencies (this may take a minute)..."
    sudo -u "${APP_USER}" npm install --production --loglevel=warn 2>&1 | tail -3
  fi

  log "Application installed"
}

run_wizard() {
  log "Starting configuration wizard..."
  echo ""

  cd "${APP_DIR}"
  # Run wizard as the app user (sudo -u works even with nologin shell)
  sudo -u "${APP_USER}" node scripts/setup-wizard.js

  if [[ -f "${APP_DIR}/.env" ]]; then
    # Lock down .env permissions — only readable by the app user
    chmod 600 "${APP_DIR}/.env"
    chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
    log "Configuration saved (permissions: 600, owner: ${APP_USER})"
  else
    warn "No .env file created. You can run the wizard again later:"
    warn "  cd ${APP_DIR} && sudo -u ${APP_USER} npm run setup"
  fi
}

install_service() {
  log "Installing systemd service..."

  cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=MeteoBoard Weather Dashboard
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}/data
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
CapabilityBoundingSet=
SystemCallArchitectures=native
MemoryDenyWriteExecute=false

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1
  log "Service installed and enabled"
}

start_service() {
  if [[ -f "${APP_DIR}/.env" ]]; then
    log "Starting MeteoBoard..."
    systemctl start "${SERVICE_NAME}"
    sleep 2

    if systemctl is-active --quiet "${SERVICE_NAME}"; then
      log "MeteoBoard is running!"
    else
      warn "Service may have failed to start. Check: journalctl -u ${SERVICE_NAME} -f"
    fi
  else
    warn "No .env file found. Service not started."
    warn "Run the wizard first: cd ${APP_DIR} && sudo -u ${APP_USER} npm run setup"
  fi
}

print_summary() {
  local IP
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  local PORT
  PORT=$(grep -oP 'PORT=\K\d+' "${APP_DIR}/.env" 2>/dev/null || echo "3000")

  echo ""
  echo -e "${GREEN}  ╔══════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}  ║                                              ║${NC}"
  echo -e "${GREEN}  ║   ✓ Installation Complete!                   ║${NC}"
  echo -e "${GREEN}  ║                                              ║${NC}"
  echo -e "${GREEN}  ╚══════════════════════════════════════════════╝${NC}"
  echo ""
  echo "  Dashboard URL:   http://${IP}:${PORT}"
  echo ""
  echo "  Useful commands:"
  echo "    systemctl status ${SERVICE_NAME}     — check service status"
  echo "    journalctl -u ${SERVICE_NAME} -f     — view live logs"
  echo "    systemctl restart ${SERVICE_NAME}    — restart after config change"
  echo ""
  echo "  Configuration:"
  echo "    Config file:   ${APP_DIR}/.env"
  echo "    Database:      ${APP_DIR}/data/meteoboard.db"
  echo "    Re-run wizard: cd ${APP_DIR} && sudo -u ${APP_USER} npm run setup"
  echo "    Re-discover:   cd ${APP_DIR} && sudo -u ${APP_USER} npm run discover"
  echo ""
}

# === Main ===

banner
check_root
detect_os
install_nodejs
install_build_tools
create_user
install_app
run_wizard
install_service
start_service
print_summary
