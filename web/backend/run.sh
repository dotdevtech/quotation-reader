#!/usr/bin/env bash
# Start FastAPI backend on 127.0.0.1:8000
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -U pip
  .venv/bin/pip install -r requirements.txt
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env — edit IMAP_USER, IMAP_PASSWORD, OPENAI_API_KEY"
fi

mkdir -p data exports
exec .venv/bin/python run.py
