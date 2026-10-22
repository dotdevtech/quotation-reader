"""FastAPI entrypoint — Quotation Reader web API."""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db
from .attachments import clear_all_attachment_files
from .auth import create_session, destroy_session, require_auth, session_valid, validate_login
from .config import get_settings
from .forward import export_extraction, forward_emails, forward_extraction
from .imap_sync import (
    ensure_auto_sync_loop,
    ensure_message_body,
    get_auto_sync_config,
    get_sync_status,
    set_auto_sync_config,
    start_sync,
)
from .openai_extract import start_extraction_job
from .settings_store import get_app_settings, public_settings, seed_settings_from_env, update_app_settings

# Built React app: web/frontend/dist (relative to web/backend)
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

_DEFAULT_CORS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "https://crm.impexnine.com",
    "http://crm.impexnine.com",
]


def _cors_origins() -> list[str]:
    extra = (get_settings().cors_origins or "").strip()
    origins = list(_DEFAULT_CORS)
    if extra:
        for part in extra.split(","):
            o = part.strip()
            if o and o not in origins:
                origins.append(o)
    return origins


app = FastAPI(title="Quotation Reader API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    db.init_db()
    seed_settings_from_env()
    ensure_auto_sync_loop()


# ── Auth (public) ───────────────────────────────────────────────────────────


@app.get("/api/auth/status")
def auth_status(
    x_session_token: Optional[str] = Header(default=None, alias="X-Session-Token"),
) -> dict[str, Any]:
    s = get_app_settings()
    logged_in = session_valid(x_session_token, touch=True)
    return {
        "setup_required": s.setup_required,
        "ok": True,
        "logged_in": logged_in,
    }


class SetupRequest(BaseModel):
    password: str = Field(min_length=4)


@app.post("/api/auth/setup")
def auth_setup(body: SetupRequest) -> dict[str, Any]:
    s = get_app_settings()
    if not s.setup_required:
        raise HTTPException(status_code=400, detail="Login password already set")
    update_app_settings({"login_password": body.password.strip()})
    token = create_session()
    return {"ok": True, "token": token}


class LoginRequest(BaseModel):
    password: str


@app.post("/api/auth/login")
def auth_login(body: LoginRequest) -> dict[str, Any]:
    s = get_app_settings()
    if s.setup_required:
        raise HTTPException(status_code=403, detail="Setup required first")
    if not validate_login(body.password):
        raise HTTPException(status_code=401, detail="Wrong password")
    return {"ok": True, "token": create_session()}


@app.post("/api/auth/logout")
def auth_logout(token: str = Depends(require_auth)) -> dict[str, Any]:
    destroy_session(token)
    return {"ok": True}


@app.get("/api/health")
def health(_: str = Depends(require_auth)) -> dict[str, Any]:
    settings = get_app_settings()
    return {
        "ok": True,
        "imap_configured": settings.imap_configured,
        "openai_configured": settings.openai_configured,
        "webhook_configured": bool(settings.forward_webhook_url),
        "auth_required": True,
    }


# ── Settings ────────────────────────────────────────────────────────────────


@app.get("/api/settings", dependencies=[Depends(require_auth)])
def get_settings_api() -> dict[str, Any]:
    return public_settings(include_secrets=False)


class SettingsUpdate(BaseModel):
    login_password: Optional[str] = None
    imap_host: Optional[str] = None
    imap_port: Optional[int] = None
    imap_user: Optional[str] = None
    imap_password: Optional[str] = None
    openai_api_key: Optional[str] = None
    openai_model: Optional[str] = None
    forward_webhook_url: Optional[str] = None
    forward_webhook_token: Optional[str] = None


@app.put("/api/settings", dependencies=[Depends(require_auth)])
def put_settings(body: SettingsUpdate) -> dict[str, Any]:
    data = body.model_dump(exclude_unset=True)
    update_app_settings(data)
    return {"ok": True, "settings": public_settings(include_secrets=False)}


# ── Sync / emails / AI ──────────────────────────────────────────────────────


class SyncRequest(BaseModel):
    mode: str = "range"  # all | range | new
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class AutoSyncUpdate(BaseModel):
    enabled: bool = False
    interval_minutes: int = Field(default=10, ge=10, le=24 * 60)


@app.post("/api/sync", dependencies=[Depends(require_auth)])
def sync_mailbox(body: SyncRequest) -> dict[str, Any]:
    start = _parse_date(body.date_from) if body.date_from else None
    end = _parse_date(body.date_to) if body.date_to else None
    mode = (body.mode or "range").lower().strip()
    if mode not in ("all", "range", "new"):
        raise HTTPException(status_code=400, detail="mode must be all, range, or new")
    return start_sync(start, end, mode=mode)


@app.get("/api/sync/status", dependencies=[Depends(require_auth)])
def sync_status() -> dict[str, Any]:
    status = get_sync_status()
    status["last_sync_at"] = db.get_sync_state("last_sync_at")
    status["last_sync_count"] = db.get_sync_state("last_sync_count")
    status["cached_total"] = db.list_emails(limit=1)[1]
    status["auto_sync"] = get_auto_sync_config()
    return status


@app.get("/api/sync/auto", dependencies=[Depends(require_auth)])
def get_auto_sync() -> dict[str, Any]:
    return get_auto_sync_config()


@app.put("/api/sync/auto", dependencies=[Depends(require_auth)])
def put_auto_sync(body: AutoSyncUpdate) -> dict[str, Any]:
    return set_auto_sync_config(body.enabled, body.interval_minutes)


class ClearInboxRequest(BaseModel):
    """Require explicit confirmation so the inbox cannot be wiped by accident."""

    confirm: str = Field(min_length=1)


@app.post("/api/inbox/clear", dependencies=[Depends(require_auth)])
def clear_inbox(body: ClearInboxRequest) -> dict[str, Any]:
    """Wipe local inbox cache (emails, scans, jobs, attachment files).

    Does NOT delete anything from the real IMAP mailbox — only this app's local copy.
    """
    if body.confirm.strip().upper() != "DELETE":
        raise HTTPException(
            status_code=400,
            detail='Type DELETE to confirm clearing the local inbox.',
        )
    if get_sync_status().get("running"):
        raise HTTPException(
            status_code=409,
            detail="Sync is running. Wait until it finishes, then try again.",
        )
    counts = db.clear_local_inbox()
    folders = clear_all_attachment_files()
    return {
        "ok": True,
        "message": "Local inbox cleared. Use Sync Data to pull emails again.",
        **counts,
        "attachment_folders_deleted": folders,
    }


@app.get("/api/emails", dependencies=[Depends(require_auth)])
def emails(
    q: str = "",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    extraction_status: Optional[str] = None,
    forward_status: Optional[str] = None,
    folder: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    items, total = db.list_emails(
        q=q,
        date_from=date_from,
        date_to=date_to,
        extraction_status=extraction_status,
        forward_status=forward_status,
        folder=folder,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@app.get("/api/emails/{uid}", dependencies=[Depends(require_auth)])
def email_detail(uid: str) -> dict[str, Any]:
    try:
        detail = ensure_message_body(uid)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not detail:
        raise HTTPException(status_code=404, detail="Email not found")
    return detail


class QuoteCheckRequest(BaseModel):
    checked: bool = True


@app.post("/api/emails/{uid}/quote-check", dependencies=[Depends(require_auth)])
def set_quote_check(uid: str, body: QuoteCheckRequest = QuoteCheckRequest()) -> dict[str, Any]:
    """Mark a scanned quote as reviewed (required before Add to system / Send sheet)."""
    email = db.get_email(uid)
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    if (email.get("extraction_status") or "none") != "completed":
        raise HTTPException(
            status_code=400,
            detail="Scan the quote first before marking it checked.",
        )
    db.set_email_quote_checked(uid, bool(body.checked))
    return {"ok": True, "uid": uid, "quote_checked": bool(body.checked)}


@app.get("/api/emails/{uid}/attachments/{index}")
def download_attachment(
    uid: str,
    index: int,
    inline: bool = Query(False),
    _: str = Depends(require_auth),
) -> FileResponse:
    """Open (inline) or download an attachment. PDFs open in-browser when inline=1."""
    from .attachments import guess_media_type, resolve_attachment_path
    from .imap_sync import ensure_message_body

    try:
        detail = ensure_message_body(uid)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    meta = (detail or {}).get("attachments") or []
    path = resolve_attachment_path(uid, index, meta)
    if path is None:
        try:
            detail = ensure_message_body(uid, force_attachments=True)
            meta = (detail or {}).get("attachments") or []
            path = resolve_attachment_path(uid, index, meta)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    if path is None:
        raise HTTPException(status_code=404, detail="Attachment not found")

    item = meta[index]
    filename = item.get("filename") or path.name
    media = guess_media_type(filename, item.get("content_type") or "")
    disposition = "inline" if inline else "attachment"
    headers = {
        "Content-Disposition": f'{disposition}; filename="{filename}"',
        "X-Content-Type-Options": "nosniff",
    }
    return FileResponse(
        path,
        media_type=media,
        headers=headers,
    )


@app.get("/api/emails/{uid}/attachments/{index}/text", dependencies=[Depends(require_auth)])
def attachment_text_preview(uid: str, index: int) -> dict[str, Any]:
    """Plain-text preview for Excel/Word (and PDF text) inside the comparison panel."""
    from .attachments import resolve_attachment_path
    from .doc_text import extract_file_text
    from .imap_sync import ensure_message_body

    detail = ensure_message_body(uid)
    meta = (detail or {}).get("attachments") or []
    path = resolve_attachment_path(uid, index, meta)
    if path is None:
        detail = ensure_message_body(uid, force_attachments=True)
        meta = (detail or {}).get("attachments") or []
        path = resolve_attachment_path(uid, index, meta)
    if path is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    text = extract_file_text(path, max_chars=60000)
    return {
        "filename": meta[index].get("filename") if index < len(meta) else path.name,
        "text": text or "(No extractable text in this file)",
    }


class ExtractRequest(BaseModel):
    email_uids: list[str] = Field(min_length=1)
    force: bool = False


@app.post("/api/extract", dependencies=[Depends(require_auth)])
def extract(body: ExtractRequest) -> dict[str, Any]:
    try:
        job_id = start_extraction_job(body.email_uids, force=body.force)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"job_id": job_id}


@app.get("/api/emails/{uid}/extraction", dependencies=[Depends(require_auth)])
def email_extraction(uid: str) -> dict[str, Any]:
    ext = db.get_latest_extraction_for_email(uid)
    if not ext:
        # fall back to latest_extraction_id even if not completed
        email = db.get_email(uid)
        eid = (email or {}).get("latest_extraction_id")
        if eid:
            ext = db.get_extraction(int(eid))
    if not ext:
        return {"email_uid": uid, "status": "none", "offers": []}
    result = ext.get("result") or {}
    offers = result.get("offers") if isinstance(result, dict) else None
    if offers is None and isinstance(result, list):
        offers = result
    return {
        "id": ext["id"],
        "email_uid": uid,
        "status": ext["status"],
        "error": ext.get("error"),
        "offers": offers or [],
        "result": result,
    }


@app.get("/api/meta/fields", dependencies=[Depends(require_auth)])
def master_fields() -> dict[str, Any]:
    from .field_options import (
        CERTIFICATION_OPTIONS,
        CONDITION_OPTIONS,
        CURRENCY_OPTIONS,
        PRICE_TYPE_OPTIONS,
    )
    from .prompt import MASTER_FIELDS

    return {
        "fields": MASTER_FIELDS,
        "condition_options": CONDITION_OPTIONS,
        "price_type_options": PRICE_TYPE_OPTIONS,
        "currency_options": CURRENCY_OPTIONS,
        "certification_options": CERTIFICATION_OPTIONS,
    }


@app.get("/api/jobs", dependencies=[Depends(require_auth)])
def jobs() -> dict[str, Any]:
    return {"items": db.list_jobs()}


@app.get("/api/jobs/{job_id}", dependencies=[Depends(require_auth)])
def job_detail(job_id: int) -> dict[str, Any]:
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


class ExtractionUpdate(BaseModel):
    result: dict[str, Any]


@app.put("/api/extractions/{extraction_id}", dependencies=[Depends(require_auth)])
def update_extraction(extraction_id: int, body: ExtractionUpdate) -> dict[str, Any]:
    from .field_options import normalize_offers

    ext = db.get_extraction(extraction_id)
    if not ext:
        raise HTTPException(status_code=404, detail="Not found")
    result = dict(body.result or {})
    if isinstance(result.get("offers"), list):
        result["offers"] = normalize_offers(result["offers"])
        result["offer_count"] = len(result["offers"])
    db.save_extraction_result_edit(extraction_id, result)
    return db.get_extraction(extraction_id) or {}


@app.post("/api/extractions/{extraction_id}/export", dependencies=[Depends(require_auth)])
def export_one(extraction_id: int) -> dict[str, Any]:
    try:
        path = export_extraction(extraction_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "path": str(path), "filename": path.name}


@app.get("/api/extractions/{extraction_id}/download", dependencies=[Depends(require_auth)])
def download_export(extraction_id: int) -> FileResponse:
    try:
        path = export_extraction(extraction_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(path, filename=path.name, media_type="application/json")


class ForwardRequest(BaseModel):
    webhook_url: Optional[str] = None


class ForwardBulkRequest(BaseModel):
    email_uids: list[str] = Field(min_length=1)
    webhook_url: Optional[str] = None


@app.post("/api/extractions/{extraction_id}/forward", dependencies=[Depends(require_auth)])
def forward_one(extraction_id: int, body: ForwardRequest = ForwardRequest()) -> dict[str, Any]:
    try:
        return forward_extraction(extraction_id, body.webhook_url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/forward", dependencies=[Depends(require_auth)])
def forward_bulk(body: ForwardBulkRequest) -> dict[str, Any]:
    """Send selected emails' completed extractions to the Google Sheets webhook."""
    try:
        return forward_emails(body.email_uids, body.webhook_url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _parse_date(value: str) -> date:
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date: {value}") from exc


# ── Production UI (built React → web/frontend/dist) ─────────────────────────
# Registered last so /api/* and /docs keep working. Dev still uses Vite on :5173.

if FRONTEND_DIST.is_dir():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/")
    def spa_index() -> FileResponse:
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> FileResponse:
        if full_path.startswith("api/") or full_path in ("api", "docs", "openapi.json", "redoc"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (FRONTEND_DIST / full_path).resolve()
        try:
            candidate.relative_to(FRONTEND_DIST.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Not found") from exc
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
