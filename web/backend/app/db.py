"""SQLite persistence for synced emails, jobs, and extractions."""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator, Optional

from .config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS emails (
    uid TEXT PRIMARY KEY,
    subject TEXT NOT NULL DEFAULT '',
    from_addr TEXT NOT NULL DEFAULT '',
    to_addr TEXT NOT NULL DEFAULT '',
    date_str TEXT NOT NULL DEFAULT '',
    date_iso TEXT,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    body_text TEXT,
    body_html TEXT,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date_iso DESC);
CREATE INDEX IF NOT EXISTS idx_emails_subject ON emails(subject);
CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_addr);

CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'pending',
    email_uids TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error TEXT
);

CREATE TABLE IF NOT EXISTS extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    email_uid TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    error TEXT,
    forwarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_extractions_job ON extractions(job_id);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    expires_at REAL NOT NULL
);
"""


def _now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def init_db() -> None:
    settings = get_settings()
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.commit()


def _migrate(conn: sqlite3.Connection) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(emails)").fetchall()}
    if "extraction_status" not in cols:
        conn.execute(
            "ALTER TABLE emails ADD COLUMN extraction_status TEXT NOT NULL DEFAULT 'none'"
        )
    if "latest_extraction_id" not in cols:
        conn.execute("ALTER TABLE emails ADD COLUMN latest_extraction_id INTEGER")
    if "forward_status" not in cols:
        conn.execute(
            "ALTER TABLE emails ADD COLUMN forward_status TEXT NOT NULL DEFAULT 'none'"
        )
    if "quote_checked" not in cols:
        conn.execute(
            "ALTER TABLE emails ADD COLUMN quote_checked INTEGER NOT NULL DEFAULT 0"
        )
    if "flagged" not in cols:
        conn.execute(
            "ALTER TABLE emails ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0"
        )
    else:
        # Ensure legacy/null values never look "flagged" by accident
        conn.execute(
            "UPDATE emails SET flagged = 0 WHERE flagged IS NULL OR flagged NOT IN (0, 1)"
        )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            expires_at REAL NOT NULL
        )
        """
    )


def get_app_setting(key: str) -> Optional[str]:
    with connect() as conn:
        row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        if row is None:
            return None
        return row["value"]


def set_app_setting(key: str, value: str) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO app_settings(key, value) VALUES(?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """,
            (key, value),
        )
        conn.commit()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    settings = get_settings()
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(settings.db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def upsert_email_summary(
    uid: str,
    subject: str,
    from_addr: str,
    date_str: str,
    date_iso: Optional[str],
    has_attachments: bool,
) -> None:
    with connect() as conn:
        existing = conn.execute("SELECT uid FROM emails WHERE uid = ?", (uid,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE emails
                SET subject=?, from_addr=?, date_str=?, date_iso=?, has_attachments=?, synced_at=?
                WHERE uid=?
                """,
                (
                    subject,
                    from_addr,
                    date_str,
                    date_iso,
                    1 if has_attachments else 0,
                    _now(),
                    uid,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO emails (
                    uid, subject, from_addr, to_addr, date_str, date_iso,
                    has_attachments, body_text, body_html, attachments_json, synced_at
                ) VALUES (?, ?, ?, '', ?, ?, ?, NULL, NULL, '[]', ?)
                """,
                (
                    uid,
                    subject,
                    from_addr,
                    date_str,
                    date_iso,
                    1 if has_attachments else 0,
                    _now(),
                ),
            )
        conn.commit()


def save_email_detail(
    uid: str,
    to_addr: str,
    body_text: str,
    body_html: str,
    attachments: list[dict[str, Any]],
) -> None:
    # Store attachment metadata only (not full binary) for DB size; filenames + sizes + content_type
    meta = [
        {
            "filename": a.get("filename"),
            "content_type": a.get("content_type"),
            "size": a.get("size"),
            "part_index": a.get("part_index"),
        }
        for a in attachments
    ]
    with connect() as conn:
        conn.execute(
            """
            UPDATE emails
            SET to_addr=?, body_text=?, body_html=?, attachments_json=?, synced_at=?
            WHERE uid=?
            """,
            (to_addr, body_text, body_html, json.dumps(meta), _now(), uid),
        )
        conn.commit()


def get_email(uid: str) -> Optional[dict[str, Any]]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM emails WHERE uid = ?", (uid,)).fetchone()
        if not row:
            return None
        return _email_row(row)


def list_emails(
    q: str = "",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    extraction_status: Optional[str] = None,
    forward_status: Optional[str] = None,
    folder: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    clauses: list[str] = []
    params: list[Any] = []
    if q.strip():
        clauses.append("(subject LIKE ? OR from_addr LIKE ? OR to_addr LIKE ?)")
        like = f"%{q.strip()}%"
        params.extend([like, like, like])
    # Compare by calendar day (YYYY-MM-DD) so time/timezone suffixes cannot
    # push an email outside the selected range incorrectly.
    if date_from:
        day_from = str(date_from).strip()[:10]
        if day_from:
            clauses.append("(date_iso IS NOT NULL AND substr(date_iso, 1, 10) >= ?)")
            params.append(day_from)
    if date_to:
        day_to = str(date_to).strip()[:10]
        if day_to:
            clauses.append("(date_iso IS NOT NULL AND substr(date_iso, 1, 10) <= ?)")
            params.append(day_to)
    folder_key = (folder or "").strip().lower()
    if folder_key in ("email", "scanned", "flagged", "checked", "sent"):
        # email = Quote Received (not scanned)
        # scanned = scanned, not flagged, not checked, not sent
        # flagged = marked for thorough manual review
        # checked = reviewed/checked, waiting to add to system
        # sent = Added to system
        if folder_key == "email":
            clauses.append("COALESCE(extraction_status, 'none') != 'completed'")
            clauses.append("COALESCE(forward_status, 'none') != 'sent'")
        elif folder_key == "scanned":
            clauses.append("COALESCE(extraction_status, 'none') = 'completed'")
            clauses.append("COALESCE(quote_checked, 0) = 0")
            clauses.append("COALESCE(flagged, 0) = 0")
            clauses.append("COALESCE(forward_status, 'none') != 'sent'")
        elif folder_key == "flagged":
            clauses.append("COALESCE(flagged, 0) = 1")
            clauses.append("COALESCE(forward_status, 'none') != 'sent'")
        elif folder_key == "checked":
            clauses.append("COALESCE(extraction_status, 'none') = 'completed'")
            clauses.append("COALESCE(quote_checked, 0) = 1")
            clauses.append("COALESCE(forward_status, 'none') != 'sent'")
        else:
            clauses.append("COALESCE(forward_status, 'none') = 'sent'")
    else:
        if extraction_status and extraction_status.strip() and extraction_status.strip() != "all":
            status = extraction_status.strip().lower()
            clauses.append("COALESCE(extraction_status, 'none') = ?")
            params.append(status)
        if forward_status and forward_status.strip() and forward_status.strip() != "all":
            fs = forward_status.strip().lower()
            clauses.append("COALESCE(forward_status, 'none') = ?")
            params.append(fs)

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    with connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS c FROM emails {where}", params).fetchone()["c"]
        rows = conn.execute(
            f"""
            SELECT uid, subject, from_addr, to_addr, date_str, date_iso,
                   has_attachments, synced_at,
                   COALESCE(extraction_status, 'none') AS extraction_status,
                   COALESCE(forward_status, 'none') AS forward_status,
                   COALESCE(quote_checked, 0) AS quote_checked,
                   COALESCE(flagged, 0) AS flagged,
                   latest_extraction_id,
                   CASE WHEN body_text IS NOT NULL OR body_html IS NOT NULL THEN 1 ELSE 0 END AS body_loaded,
                   (
                     SELECT e.error FROM extractions e
                     WHERE e.email_uid = emails.uid
                     ORDER BY e.id DESC LIMIT 1
                   ) AS extraction_error,
                   (
                     SELECT e.forwarded FROM extractions e
                     WHERE e.email_uid = emails.uid AND e.status = 'completed'
                     ORDER BY e.id DESC LIMIT 1
                   ) AS extraction_forwarded
            FROM emails
            {where}
            ORDER BY (date_iso IS NULL), date_iso DESC, uid DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
        items = []
        for r in rows:
            d = dict(r)
            d["quote_checked"] = bool(d.get("quote_checked"))
            d["flagged"] = bool(d.get("flagged"))
            items.append(d)
        return items, int(total)


def set_email_forward_status(uid: str, status: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE emails SET forward_status = ? WHERE uid = ?",
            (status, uid),
        )
        conn.commit()


def is_email_quote_checked(uid: str) -> bool:
    with connect() as conn:
        row = conn.execute(
            "SELECT COALESCE(quote_checked, 0) AS c FROM emails WHERE uid = ?",
            (uid,),
        ).fetchone()
        return bool(row and row["c"])


def set_email_quote_checked(uid: str, checked: bool) -> None:
    with connect() as conn:
        if checked:
            # Checked quotes leave the Flag tab
            conn.execute(
                "UPDATE emails SET quote_checked = 1, flagged = 0 WHERE uid = ?",
                (uid,),
            )
        else:
            conn.execute(
                "UPDATE emails SET quote_checked = 0 WHERE uid = ?",
                (uid,),
            )
        conn.commit()


def set_email_flagged(uid: str, flagged: bool) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE emails SET flagged = ? WHERE uid = ?",
            (1 if flagged else 0, uid),
        )
        conn.commit()


def delete_email_local(uid: str) -> bool:
    """Remove one email + its extractions from local DB. Returns True if deleted."""
    with connect() as conn:
        exists = conn.execute("SELECT uid FROM emails WHERE uid = ?", (uid,)).fetchone()
        if not exists:
            return False
        conn.execute("DELETE FROM extractions WHERE email_uid = ?", (uid,))
        conn.execute("DELETE FROM emails WHERE uid = ?", (uid,))
        conn.commit()
        return True


def get_email_extraction_status(uid: str) -> str:
    with connect() as conn:
        row = conn.execute(
            "SELECT COALESCE(extraction_status, 'none') AS s FROM emails WHERE uid = ?",
            (uid,),
        ).fetchone()
        return row["s"] if row else "none"


def set_email_extraction_status(
    uid: str, status: str, extraction_id: Optional[int] = None
) -> None:
    # Re-scan / queue resets review — must Check Quote again before Add to system.
    reset_checked = status in ("pending", "running", "none", "error")
    with connect() as conn:
        if extraction_id is not None:
            if reset_checked:
                conn.execute(
                    """
                    UPDATE emails
                    SET extraction_status = ?, latest_extraction_id = ?,
                        quote_checked = 0, flagged = 0
                    WHERE uid = ?
                    """,
                    (status, extraction_id, uid),
                )
            else:
                conn.execute(
                    """
                    UPDATE emails
                    SET extraction_status = ?, latest_extraction_id = ?
                    WHERE uid = ?
                    """,
                    (status, extraction_id, uid),
                )
        else:
            if reset_checked:
                conn.execute(
                    """
                    UPDATE emails
                    SET extraction_status = ?, quote_checked = 0, flagged = 0
                    WHERE uid = ?
                    """,
                    (status, uid),
                )
            else:
                conn.execute(
                    "UPDATE emails SET extraction_status = ? WHERE uid = ?",
                    (status, uid),
                )
        conn.commit()


def get_latest_extraction_for_email(uid: str) -> Optional[dict[str, Any]]:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM extractions
            WHERE email_uid = ? AND status = 'completed'
            ORDER BY id DESC LIMIT 1
            """,
            (uid,),
        ).fetchone()
        return _extraction_row(row) if row else None


def clear_local_inbox() -> dict[str, int]:
    """Delete all cached emails, extractions, and jobs from this machine.

    Does not touch IMAP on the mail server — only local SQLite data.
    Keeps login / IMAP / OpenAI settings and auto-sync preferences.
    """
    with connect() as conn:
        emails_n = conn.execute("SELECT COUNT(*) AS c FROM emails").fetchone()["c"]
        extractions_n = conn.execute("SELECT COUNT(*) AS c FROM extractions").fetchone()["c"]
        jobs_n = conn.execute("SELECT COUNT(*) AS c FROM jobs").fetchone()["c"]
        conn.execute("DELETE FROM extractions")
        conn.execute("DELETE FROM jobs")
        conn.execute("DELETE FROM emails")
        # Reset sync markers so a fresh Sync can refill the inbox
        for key in (
            "last_sync_at",
            "last_sync_count",
            "last_sync_start",
            "last_sync_end",
            "last_sync_uids",
        ):
            conn.execute("DELETE FROM sync_state WHERE key = ?", (key,))
        conn.commit()
    return {
        "emails_deleted": int(emails_n),
        "extractions_deleted": int(extractions_n),
        "jobs_deleted": int(jobs_n),
    }


def set_sync_state(key: str, value: str) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO sync_state(key, value) VALUES(?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """,
            (key, value),
        )
        conn.commit()


def get_sync_state(key: str, default: str = "") -> str:
    with connect() as conn:
        row = conn.execute("SELECT value FROM sync_state WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default


def create_job(email_uids: list[str]) -> int:
    now = _now()
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO jobs(status, email_uids, created_at, updated_at) VALUES(?, ?, ?, ?)",
            ("pending", json.dumps(email_uids), now, now),
        )
        job_id = int(cur.lastrowid)
        for uid in email_uids:
            conn.execute(
                """
                INSERT INTO extractions(job_id, email_uid, status, created_at, updated_at)
                VALUES(?, ?, 'pending', ?, ?)
                """,
                (job_id, uid, now, now),
            )
        conn.commit()
        return job_id


def update_job(job_id: int, status: str, error: Optional[str] = None) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE jobs SET status=?, error=?, updated_at=? WHERE id=?",
            (status, error, _now(), job_id),
        )
        conn.commit()


def count_active_scans() -> dict[str, int]:
    """How many emails/jobs are queued or currently scanning."""
    with connect() as conn:
        pending_emails = conn.execute(
            """
            SELECT COUNT(*) AS c FROM emails
            WHERE COALESCE(extraction_status, 'none') IN ('pending', 'running')
            """
        ).fetchone()["c"]
        active_jobs = conn.execute(
            """
            SELECT COUNT(*) AS c FROM jobs
            WHERE status IN ('pending', 'running')
            """
        ).fetchone()["c"]
        return {
            "pending_or_running_emails": int(pending_emails),
            "active_jobs": int(active_jobs),
        }


def cancel_pending_scans() -> dict[str, int]:
    """Stop queue: cancel pending extractions/jobs and clear Queued tags.

    The email currently marked running is left alone until that one OpenAI call
    finishes; the worker then exits and does not start the next mail.
    """
    now = _now()
    with connect() as conn:
        # Pending extraction rows → cancelled
        cur_ext = conn.execute(
            """
            UPDATE extractions
            SET status = 'cancelled', error = 'Stopped by user', updated_at = ?
            WHERE status = 'pending'
            """,
            (now,),
        )
        cancelled_extractions = cur_ext.rowcount

        # Queued emails back to Quote Received (not scanned)
        cur_mail = conn.execute(
            """
            UPDATE emails
            SET extraction_status = 'none'
            WHERE COALESCE(extraction_status, 'none') = 'pending'
            """
        )
        reset_emails = cur_mail.rowcount

        # Jobs waiting or in progress → cancelled
        cur_jobs = conn.execute(
            """
            UPDATE jobs
            SET status = 'cancelled', error = 'Stopped by user', updated_at = ?
            WHERE status IN ('pending', 'running')
            """,
            (now,),
        )
        cancelled_jobs = cur_jobs.rowcount
        conn.commit()

    return {
        "cancelled_extractions": int(cancelled_extractions or 0),
        "reset_emails": int(reset_emails or 0),
        "cancelled_jobs": int(cancelled_jobs or 0),
    }


def get_job(job_id: int) -> Optional[dict[str, Any]]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            return None
        job = dict(row)
        job["email_uids"] = json.loads(job["email_uids"])
        extractions = conn.execute(
            "SELECT * FROM extractions WHERE job_id = ? ORDER BY id", (job_id,)
        ).fetchall()
        job["extractions"] = [_extraction_row(e) for e in extractions]
        return job


def list_jobs(limit: int = 50) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM jobs ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        out = []
        for row in rows:
            job = dict(row)
            job["email_uids"] = json.loads(job["email_uids"])
            out.append(job)
        return out


def update_extraction(
    extraction_id: int,
    status: str,
    result: Optional[dict[str, Any]] = None,
    error: Optional[str] = None,
    forwarded: Optional[bool] = None,
) -> None:
    with connect() as conn:
        fields = ["status=?", "updated_at=?"]
        params: list[Any] = [status, _now()]
        if result is not None:
            fields.append("result_json=?")
            params.append(json.dumps(result))
        if error is not None:
            fields.append("error=?")
            params.append(error)
        if forwarded is not None:
            fields.append("forwarded=?")
            params.append(1 if forwarded else 0)
        params.append(extraction_id)
        conn.execute(
            f"UPDATE extractions SET {', '.join(fields)} WHERE id=?",
            params,
        )
        conn.commit()


def get_extraction(extraction_id: int) -> Optional[dict[str, Any]]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM extractions WHERE id = ?", (extraction_id,)).fetchone()
        return _extraction_row(row) if row else None


def save_extraction_result_edit(extraction_id: int, result: dict[str, Any]) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE extractions SET result_json=?, updated_at=? WHERE id=?",
            (json.dumps(result), _now(), extraction_id),
        )
        conn.commit()


def purge_expired_sessions() -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
        conn.commit()


def create_session_row(token: str, expires_at: float) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO sessions(token, expires_at) VALUES(?, ?)
            ON CONFLICT(token) DO UPDATE SET expires_at=excluded.expires_at
            """,
            (token, expires_at),
        )
        conn.commit()


def delete_session_row(token: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()


def get_session_expiry(token: str) -> Optional[float]:
    with connect() as conn:
        row = conn.execute(
            "SELECT expires_at FROM sessions WHERE token = ?",
            (token,),
        ).fetchone()
        if not row:
            return None
        return float(row["expires_at"])


def touch_session_row(token: str, expires_at: float) -> bool:
    """Extend session if it exists and is not expired. Returns True if valid."""
    with connect() as conn:
        row = conn.execute(
            "SELECT expires_at FROM sessions WHERE token = ?",
            (token,),
        ).fetchone()
        if not row:
            return False
        if float(row["expires_at"]) < time.time():
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
            return False
        conn.execute(
            "UPDATE sessions SET expires_at = ? WHERE token = ?",
            (expires_at, token),
        )
        conn.commit()
        return True


def _email_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["has_attachments"] = bool(d.get("has_attachments"))
    d["quote_checked"] = bool(d.get("quote_checked"))
    d["flagged"] = bool(d.get("flagged"))
    d["attachments"] = json.loads(d.get("attachments_json") or "[]")
    d.pop("attachments_json", None)
    return d


def _extraction_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    raw = d.get("result_json")
    d["result"] = json.loads(raw) if raw else None
    d.pop("result_json", None)
    d["forwarded"] = bool(d.get("forwarded"))
    return d
