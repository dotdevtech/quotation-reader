#!/usr/bin/env bash
# Start Quotation Reader — backend + frontend together
# Usage: ./run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/web/backend"
FRONTEND="$ROOT/web/frontend"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"

cleanup() {
  echo ""
  echo "Stopping…"
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${UI_PID:-}" ]] && kill "$UI_PID" 2>/dev/null || true
  # Also clear anything still bound to our ports
  fuser -k 8000/tcp 2>/dev/null || true
  fuser -k 5173/tcp 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Free ports if a previous run left them busy
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true
sleep 0.5

# --- Backend ---
cd "$BACKEND"
if [[ ! -d .venv ]]; then
  echo "Creating Python venv…"
  python3 -m venv .venv
  .venv/bin/pip install -U pip
  .venv/bin/pip install -r requirements.txt
fi
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

# Ensure default login password admin123 exists
.venv/bin/python - <<'PY'
from app.db import init_db
from app.settings_store import seed_settings_from_env, get_app_settings, update_app_settings
from app.auth import validate_login
init_db()
seed_settings_from_env()
if not validate_login("admin123") and not get_app_settings().login_password:
    update_app_settings({"login_password": "admin123"})
elif not get_app_settings().login_password:
    update_app_settings({"login_password": "admin123"})
print("Login password ready (default: admin123 — change in Settings)")
PY

mkdir -p data exports

echo "Starting API  →  http://127.0.0.1:8000"
.venv/bin/python run.py &
API_PID=$!

echo -n "Waiting for API"
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8000/api/auth/status >/dev/null 2>&1; then
    echo " — ready"
    break
  fi
  # If process died, abort early
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo ""
    echo "API process exited. Check errors above."
    exit 1
  fi
  echo -n "."
  sleep 0.25
done
if ! curl -sf http://127.0.0.1:8000/api/auth/status >/dev/null 2>&1; then
  echo ""
  echo "API failed to become ready on port 8000."
  exit 1
fi

# --- Frontend ---
cd "$FRONTEND"
if [[ ! -d node_modules ]]; then
  echo "Installing frontend packages…"
  npm install
fi

echo "Starting UI   →  http://127.0.0.1:5173"
npm run dev -- --host 127.0.0.1 --port 5173 &
UI_PID=$!

echo ""
echo "Ready. Open:  http://127.0.0.1:5173/login"
echo "Password:     admin123  (change later in Settings)"
echo "Press Ctrl+C to stop both."
echo ""

wait
