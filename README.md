# Quotation Reader

FastAPI + React web app: sync Bluehost mail into SQLite, search/select emails, extract with OpenAI, forward/export JSON.

## Run

```bash
cd "/home/farhan/Projects/Quotation Reader"
./run.sh
```

First time: edit `web/backend/.env` with `IMAP_USER`, `IMAP_PASSWORD`, `OPENAI_API_KEY`.

- UI: http://127.0.0.1:5173  
- API: http://127.0.0.1:8000/docs  

Windows: double-click `run.bat`

Details: [web/README.md](web/README.md)
