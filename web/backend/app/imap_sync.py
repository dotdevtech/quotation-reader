"""Background IMAP sync into SQLite cache."""

from __future__ import annotations

import threading
import time
from datetime import date, datetime, timedelta
from typing import Any, Optional

from . import db
from .settings_store import get_app_settings
from .imap_client import ImapClient

_lock = threading.Lock()
_state: dict[str, Any] = {
    "running": False,
    "phase": "idle",
    "message": "",
    "done": 0,
    "total": 0,
    "error": None,
    "last_finished_at": None,
}

_MIN_AUTO_MINUTES = 10
_auto_thread_started = False
_auto_lock = threading.Lock()


def get_sync_status() -> dict[str, Any]:
    return dict(_state)


def _resolve_range(
    mode: str,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> tuple[date, date]:
    today = date.today()
    end = date_to or today
    mode = (mode or "range").lower().strip()

    if mode == "all":
        # Full history (month-chunked IMAP search handles long ranges)
        return date(today.year - 10, 1, 1), today

    if mode == "new":
        last_end = db.get_sync_state("last_sync_end")
        if last_end:
            try:
                start = date.fromisoformat(last_end[:10]) - timedelta(days=1)
            except ValueError:
                start = today - timedelta(days=7)
        else:
            start = today - timedelta(days=7)
        if start > today:
            start = today - timedelta(days=1)
        return start, today

    # range
    start = date_from or (today - timedelta(days=90))
    return start, end


def start_sync(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    mode: str = "range",
) -> dict[str, Any]:
    with _lock:
        if _state["running"]:
            return {"ok": False, "error": "Sync already running", "status": get_sync_status()}
        _state.update(
            {
                "running": True,
                "phase": "starting",
                "message": "Starting sync…",
                "done": 0,
                "total": 0,
                "error": None,
            }
        )

    start, end = _resolve_range(mode, date_from, date_to)
    thread = threading.Thread(target=_run_sync, args=(start, end, mode), daemon=True)
    thread.start()
    return {"ok": True, "status": get_sync_status()}


def get_auto_sync_config() -> dict[str, Any]:
    enabled = db.get_sync_state("auto_sync_enabled") == "1"
    try:
        minutes = int(db.get_sync_state("auto_sync_minutes") or str(_MIN_AUTO_MINUTES))
    except ValueError:
        minutes = _MIN_AUTO_MINUTES
    minutes = max(_MIN_AUTO_MINUTES, minutes)
    last_run = db.get_sync_state("auto_sync_last_run") or None
    next_run_at = None
    if enabled and last_run:
        try:
            last_dt = datetime.fromisoformat(last_run.replace("Z", "+00:00"))
            next_dt = last_dt + timedelta(minutes=minutes)
            next_run_at = next_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            next_run_at = None
    elif enabled:
        next_run_at = "soon"
    return {
        "enabled": enabled,
        "interval_minutes": minutes,
        "min_interval_minutes": _MIN_AUTO_MINUTES,
        "last_run_at": last_run,
        "next_run_at": next_run_at,
    }


def set_auto_sync_config(enabled: bool, interval_minutes: int) -> dict[str, Any]:
    minutes = max(_MIN_AUTO_MINUTES, int(interval_minutes or _MIN_AUTO_MINUTES))
    db.set_sync_state("auto_sync_enabled", "1" if enabled else "0")
    db.set_sync_state("auto_sync_minutes", str(minutes))
    ensure_auto_sync_loop()
    return get_auto_sync_config()


def ensure_auto_sync_loop() -> None:
    global _auto_thread_started
    with _auto_lock:
        if _auto_thread_started:
            return
        _auto_thread_started = True
        t = threading.Thread(target=_auto_sync_loop, daemon=True, name="auto-sync")
        t.start()


def _auto_sync_loop() -> None:
    # Small delay so DB/settings are ready after startup
    time.sleep(5)
    while True:
        try:
            cfg = get_auto_sync_config()
            if cfg["enabled"] and not _state["running"]:
                due = True
                last = cfg.get("last_run_at")
                if last:
                    try:
                        last_dt = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                        if last_dt.tzinfo:
                            last_dt = last_dt.replace(tzinfo=None)
                        elapsed = (datetime.utcnow() - last_dt).total_seconds()
                        due = elapsed >= cfg["interval_minutes"] * 60
                    except ValueError:
                        due = True
                if due:
                    result = start_sync(mode="new")
                    if result.get("ok"):
                        db.set_sync_state(
                            "auto_sync_last_run",
                            datetime.utcnow().isoformat(timespec="seconds") + "Z",
                        )
        except Exception:
            pass
        time.sleep(30)


def _set(**kwargs: Any) -> None:
    _state.update(kwargs)


def _run_sync(start: date, end: date, mode: str = "range") -> None:
    from .imap_lock import imap_exclusive

    settings = get_app_settings()
    try:
        if not settings.imap_user or not settings.imap_password:
            raise RuntimeError("IMAP username/password not set. Open Settings and save them.")

        with imap_exclusive(timeout=300.0, purpose="sync"):
            client = ImapClient(settings.imap_host, settings.imap_port, timeout=180.0)
            _set(phase="connecting", message="Connecting to mail server…")
            client.connect(settings.imap_user, settings.imap_password)

            def search_progress(msg: str) -> None:
                _set(phase="searching", message=msg)

            label = {"all": "full mailbox", "new": "new emails", "range": f"{start} → {end}"}.get(
                mode, f"{start} → {end}"
            )
            _set(phase="searching", message=f"Searching {label}")
            uids = client.search_uids(start, end, progress=search_progress)
            _set(total=len(uids), done=0, phase="headers", message=f"Found {len(uids)} messages")

            def header_progress(done: int, total: int) -> None:
                _set(done=done, total=total, message=f"Caching headers… {done}/{total}")

            summaries = client.fetch_summaries(uids, progress=header_progress)
            for s in summaries:
                date_iso = s.date_obj.isoformat() if s.date_obj else None
                db.upsert_email_summary(
                    uid=s.uid,
                    subject=s.subject,
                    from_addr=s.from_addr,
                    date_str=s.date_str,
                    date_iso=date_iso,
                    has_attachments=s.has_attachments,
                )

            db.set_sync_state("last_sync_start", start.isoformat())
            db.set_sync_state("last_sync_end", end.isoformat())
            db.set_sync_state("last_sync_at", datetime.utcnow().isoformat(timespec="seconds") + "Z")
            db.set_sync_state("last_sync_count", str(len(summaries)))
            db.set_sync_state(
                "auto_sync_last_run",
                datetime.utcnow().isoformat(timespec="seconds") + "Z",
            )

            client.disconnect()
            _set(
                phase="done",
                message=f"Synced {len(summaries)} emails",
                done=len(summaries),
                total=len(summaries),
                last_finished_at=datetime.utcnow().isoformat(timespec="seconds") + "Z",
            )
    except Exception as exc:
        _set(phase="error", message=str(exc), error=str(exc))
    finally:
        _state["running"] = False


def ensure_message_body(uid: str, force_attachments: bool = False) -> dict[str, Any]:
    """Load full message from IMAP into cache if not already present.

    Also stores attachment files under data/attachments/{uid}/ so the UI can open them.
    """
    from .attachments import attachments_on_disk, filter_document_meta, store_attachments
    from .imap_lock import imap_exclusive

    existing = db.get_email(uid)
    body_cached = existing and (
        existing.get("body_text") is not None or existing.get("body_html") is not None
    )
    atts = filter_document_meta((existing or {}).get("attachments") or [])
    files_ok = attachments_on_disk(uid, atts) if atts else True

    if body_cached and files_ok and not force_attachments:
        if existing:
            existing = dict(existing)
            existing["attachments"] = atts
            existing["has_attachments"] = bool(atts)
        return existing  # type: ignore[return-value]

    if _state.get("running"):
        raise RuntimeError(
            "Mailbox sync is still running. Wait until sync finishes, then open this email again."
        )

    settings = get_app_settings()
    if not settings.imap_user or not settings.imap_password:
        raise RuntimeError("IMAP credentials not configured. Open Settings first.")

    with imap_exclusive(timeout=90.0, purpose="open email"):
        client = ImapClient(settings.imap_host, settings.imap_port, timeout=180.0)
        client.connect(settings.imap_user, settings.imap_password)
        try:
            detail = client.fetch_message(uid)
            attachments = store_attachments(uid, detail.attachments)

            date_iso = None
            if existing and existing.get("date_iso"):
                date_iso = existing["date_iso"]

            db.upsert_email_summary(
                uid=detail.uid,
                subject=detail.subject,
                from_addr=detail.from_addr,
                date_str=detail.date_str,
                date_iso=date_iso,
                has_attachments=bool(detail.attachments),
            )
            db.save_email_detail(
                uid=detail.uid,
                to_addr=detail.to_addr,
                body_text=detail.body_text,
                body_html=detail.body_html,
                attachments=attachments,
            )
            return db.get_email(uid) or {}
        finally:
            client.disconnect()
