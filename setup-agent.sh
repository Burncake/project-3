#!/usr/bin/env bash
# =============================================================================
# setup-agent.sh  –  Install and start the Remote PC Control agent
# Usage:
#   ./setup-agent.sh                             # uses ws://localhost:3000
#   ./setup-agent.sh --server ws://192.168.1.10:3000
#   ./setup-agent.sh --install-only
# =============================================================================
set -euo pipefail

SERVER_URL="${SERVER_URL:-ws://localhost:3000}"
INSTALL_ONLY=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/agent"
VENV_DIR="$SCRIPT_DIR/.venv"

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)       SERVER_URL="$2"; shift 2 ;;
    --install-only) INSTALL_ONLY=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "======================================================"
echo "  Remote PC Control – Agent Setup"
echo "======================================================"
echo "[setup] Target server : $SERVER_URL"
echo "[setup] Agent dir     : $AGENT_DIR"

# ── Check Python ──────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "[setup] python3 not found. Installing…"
  sudo apt-get update -qq
  sudo apt-get install -y python3 python3-venv python3-pip
else
  echo "[setup] Python found: $(python3 --version)"
fi

# ── System packages needed by some libs (pynput, mss, OpenCV) ────────────────
echo "[setup] Checking system display / input dependencies…"
PKGS_NEEDED=()
for pkg in python3-venv python3-dev build-essential libgl1 libglib2.0-0 wmctrl; do
  dpkg -s "$pkg" &>/dev/null || PKGS_NEEDED+=("$pkg")
done
if [[ ${#PKGS_NEEDED[@]} -gt 0 ]]; then
  echo "[setup] Installing system packages: ${PKGS_NEEDED[*]}"
  sudo apt-get update -qq
  sudo apt-get install -y "${PKGS_NEEDED[@]}"
fi

# ── Create virtual environment ────────────────────────────────────────────────
if [[ ! -d "$VENV_DIR" ]]; then
  echo "[setup] Creating Python virtual environment at $VENV_DIR …"
  python3 -m venv "$VENV_DIR"
fi

PYTHON="$VENV_DIR/bin/python"
PIP="$VENV_DIR/bin/pip"

# ── Install Python dependencies ───────────────────────────────────────────────
echo "[setup] Installing Python packages…"
"$PIP" install --upgrade pip -q
"$PIP" install -r "$AGENT_DIR/requirements.txt"

echo "[setup] Agent dependencies installed."

if $INSTALL_ONLY; then
  echo "[setup] --install-only set. Done."
  exit 0
fi

# ── Start the agent ───────────────────────────────────────────────────────────
echo ""
echo "[setup] Starting agent — connecting to $SERVER_URL …"
echo "[setup] Press Ctrl+C to stop."
echo ""
cd "$AGENT_DIR"
SERVER_URL="$SERVER_URL" "$PYTHON" agent.py
