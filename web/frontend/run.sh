#!/usr/bin/env bash
# Start Vite React frontend on 127.0.0.1:5173
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"

if [[ ! -d node_modules ]]; then
  npm install
fi

exec npm run dev -- --host 127.0.0.1 --port 5173
