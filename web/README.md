# Quotation Reader — Web App

FastAPI + React + Tailwind. Emails sync from Bluehost IMAP into **SQLite** once, then the UI is instant. Select emails → OpenAI structured extract → review → forward/export.

## Quick start (Debian / Linux)

1. Copy env and fill credentials:

```bash
cp web/backend/.env.example web/backend/.env
# edit: IMAP_USER, IMAP_PASSWORD, OPENAI_API_KEY
# optional: FORWARD_WEBHOOK_URL
```

2. Run both servers:

```bash
chmod +x web/run.sh web/backend/run.sh web/frontend/run.sh
./web/run.sh
```

Or separately:

```bash
./web/backend/run.sh    # http://127.0.0.1:8000
./web/frontend/run.sh   # http://127.0.0.1:5173
```

Open **http://127.0.0.1:5173**

## Windows

```bat
cd web\backend
run.bat

cd web\frontend
run.bat
```

## Flow

1. Set date range → **Sync from mail** (first sync can take a while; later loads are from SQLite)
2. Search / checkbox select emails
3. **Send selected to OpenAI**
4. Open **Review / AI** → edit JSON → **Download** or **Forward / Export**

## Security

- API binds to `127.0.0.1` only by default
- Secrets stay in `web/backend/.env` (never in the React app)
- Optional `APP_PASSWORD` header lock for later hosting
- Remote webhook is optional; JSON is always exported under `web/backend/exports/`

## API docs

http://127.0.0.1:8000/docs

## Production / CyberPanel

See **[DEPLOY-CYBERPANEL.md](./DEPLOY-CYBERPANEL.md)** for deploying to `crm.impexnine.com` (build UI, systemd, OpenLiteSpeed reverse proxy).

### Local production smoke-test

```bash
cd web/frontend && npm run build
cd ../backend && .venv/bin/python run.py
# Open http://127.0.0.1:8000  (API serves the built UI)
# curl -s http://127.0.0.1:8000/api/auth/status
```
