# Deploy Quotation Reader on CyberPanel (`crm.impexnine.com`)

This guide is for a VPS with **CyberPanel** + **OpenLiteSpeed**.  
You need **SSH** (PuTTY / Windows Terminal): `ssh root@YOUR_SERVER_IP`.

## Architecture

- FastAPI listens on `127.0.0.1:8000` (not public).
- Built React UI is served by FastAPI from `web/frontend/dist`.
- OpenLiteSpeed reverse-proxies `https://crm.impexnine.com` → `http://127.0.0.1:8000`.

---

## 0) Smoke-test on your PC (optional but recommended)

Before uploading to the VPS, confirm a production build works locally:

```bash
cd /path/to/Quotation\ Reader/web/frontend
npm install
npm run build

cd ../backend
# ensure .venv + .env exist (same as local dev)
.venv/bin/python run.py
```

Then open **http://127.0.0.1:8000** (not :5173). You should see the login page.  
API check: `curl -s http://127.0.0.1:8000/api/auth/status`

Stop with Ctrl+C when done.

---

## 1) SSH in and install tools

```bash
apt update
apt install -y python3 python3-venv python3-pip git curl unzip
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
python3 --version
```

---

## 2) Put the project on the server

```bash
mkdir -p /home/quotation-reader
cd /home/quotation-reader
```

**Option A — Git**

```bash
git clone YOUR_REPO_URL .
```

**Option B — Zip upload**

On your PC, zip the project **without** `node_modules`, `.venv`, and preferably without large local `web/backend/data/` (unless you want to migrate mail/DB). Upload via CyberPanel File Manager or SCP, then:

```bash
cd /home/quotation-reader
unzip quotation-reader.zip
# adjust paths if the zip created a nested folder
```

Expected layout:

```text
/home/quotation-reader/web/backend/
/home/quotation-reader/web/frontend/
/home/quotation-reader/web/deploy/quotation-reader.service
```

---

## 3) Backend env + Python deps

```bash
cd /home/quotation-reader/web/backend
python3 -m venv .venv
.venv/bin/pip install -U pip
.venv/bin/pip install -r requirements.txt
cp .env.example .env
nano .env
```

Set at least:

```env
HOST=127.0.0.1
PORT=8000
DATABASE_PATH=data/quotation_reader.db
# Optional seeds (or configure later in Settings UI):
# IMAP_USER=...
# IMAP_PASSWORD=...
# OPENAI_API_KEY=...
# FORWARD_WEBHOOK_URL=...
# APP_PASSWORD=your-strong-login-password
```

```bash
mkdir -p data exports data/attachments
```

---

## 4) Build frontend

```bash
cd /home/quotation-reader/web/frontend
npm install
npm run build
# creates web/frontend/dist
ls dist
```

---

## 5) Quick test on the server

```bash
cd /home/quotation-reader/web/backend
.venv/bin/python run.py
```

In a **second** SSH session:

```bash
curl -s http://127.0.0.1:8000/api/auth/status
curl -sI http://127.0.0.1:8000/ | head
```

You should get JSON like `{"setup_required":false,...}` and an HTML response for `/`.  
Stop the first session with Ctrl+C.

---

## 6) systemd (keeps the app running)

```bash
cp /home/quotation-reader/web/deploy/quotation-reader.service /etc/systemd/system/quotation-reader.service
# If your project path is different, edit WorkingDirectory / ExecStart:
# nano /etc/systemd/system/quotation-reader.service

systemctl daemon-reload
systemctl enable --now quotation-reader
systemctl status quotation-reader
```

Useful commands:

```bash
journalctl -u quotation-reader -f
systemctl restart quotation-reader
```

---

## 7) OpenLiteSpeed reverse proxy

Your old `public_html/index.html` will no longer be used once the whole site is proxied.

1. Open **OpenLiteSpeed WebAdmin** — usually `https://YOUR_SERVER_IP:7080`  
   (CyberPanel → LiteSpeed → can reset WebAdmin password if needed.)
2. **Virtual Hosts** → select **`crm.impexnine.com`**
3. **External App** → Add → type **Web Server**
   - **Name:** `quotation-api`
   - **Address:** `http://127.0.0.1:8000`
   - Max Connections: `100`
   - Initial Request Timeout: `60`
   - Retry Timeout: `0`
4. **Context** → Add → type **Proxy**
   - **URI:** `/`
   - **Web Server:** `quotation-api`
5. **Graceful Restart** OpenLiteSpeed
6. Open **https://crm.impexnine.com** — Quotation Reader login should appear

Keep CyberPanel SSL (Let’s Encrypt) on the subdomain. The proxy to uvicorn stays HTTP on localhost.

**Firewall:** do **not** open port `8000` to the internet. Only 80/443 (and SSH).

---

## 8) After go-live

1. Log in → **Settings** → IMAP, OpenAI, Google Sheet webhook  
2. Change the login password if you used a default  
3. Sync mail and test extract + Send to Sheet  

### Updating later

```bash
cd /home/quotation-reader
git pull   # or upload new files
cd web/frontend && npm install && npm run build
cd ../backend && .venv/bin/pip install -r requirements.txt
systemctl restart quotation-reader
```

---

## Troubleshooting

| Symptom | Check |
|--------|--------|
| 502 / blank site | `systemctl status quotation-reader` and `curl http://127.0.0.1:8000/api/auth/status` |
| Login page missing / API only JSON | Frontend not built — run `npm run build` in `web/frontend` |
| CORS errors in browser | Confirm you use `https://crm.impexnine.com` (already allowed). Extra domains: set `CORS_ORIGINS` in `.env` |
| Proxy not applied | OLS External App + Proxy Context URI `/`, then Graceful Restart |
| Still seeing old index.html | Proxy Context not active, or wrong vhost |

---

## Security notes

- Bind API to `127.0.0.1` only (`HOST=127.0.0.1`).
- Prefer a strong `APP_PASSWORD` / Settings login password.
- Keep `.env` private; never commit it to git.
