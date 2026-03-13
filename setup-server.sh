#!/usr/bin/env bash
# =============================================================================
# setup-server.sh  –  Install and start the Remote PC Control server
# Usage:
#   ./setup-server.sh            # install deps + start server on port 3000
#   ./setup-server.sh --port 8080
#   ./setup-server.sh --install-only
# =============================================================================
set -euo pipefail

PORT=3000
INSTALL_ONLY=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)         PORT="$2";   shift 2 ;;
    --install-only) INSTALL_ONLY=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "======================================================"
echo "  Remote PC Control – Server Setup"
echo "======================================================"

# ── Check / install Node.js ───────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[setup] Node.js not found. Installing via package manager…"

  if command -v apt-get &>/dev/null; then
    echo "[setup] Detected Debian/Ubuntu (apt). Installing Node.js & npm…"
    sudo apt-get update -qq
    sudo apt-get install -y nodejs npm
  elif command -v dnf &>/dev/null; then
    echo "[setup] Detected Fedora (dnf). Installing Node.js & npm…"
    sudo dnf install -y nodejs npm
  elif command -v yum &>/dev/null; then
    echo "[setup] Detected CentOS/RHEL (yum). Installing Node.js & npm…"
    sudo yum install -y nodejs npm
  else
    echo "[setup] Unsupported package manager. Please install Node.js and npm manually."
    exit 1
  fi
else
  echo "[setup] Node.js found: $(node --version)"
fi

# ── Install npm dependencies ──────────────────────────────────────────────────
echo "[setup] Installing npm packages in $SERVER_DIR …"
cd "$SERVER_DIR"
npm install

echo "[setup] Server dependencies installed."

if $INSTALL_ONLY; then
  echo "[setup] --install-only set. Done."
  exit 0
fi

# ── Start the server ──────────────────────────────────────────────────────────
echo ""
echo "[setup] Starting server on port $PORT …"
echo "[setup] Web UI will be available at http://localhost:$PORT"
echo "[setup] Press Ctrl+C to stop."
echo ""
PORT="$PORT" node server.js
