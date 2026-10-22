"""Simple session auth for the local web UI (persisted ~24 hours)."""

from __future__ import annotations

import secrets
import time
from typing import Optional

from fastapi import Header, HTTPException, Query

from . import db
from .settings_store import get_app_settings

SESSION_TTL_SEC = 60 * 60 * 24  # 24 hours


def create_session() -> str:
    token = secrets.token_urlsafe(32)
    expires_at = time.time() + SESSION_TTL_SEC
    db.purge_expired_sessions()
    db.create_session_row(token, expires_at)
    return token


def destroy_session(token: Optional[str]) -> None:
    if token:
        db.delete_session_row(token)


def session_valid(token: Optional[str], *, touch: bool = False) -> bool:
    """Return True if token is a live session. Optionally slide the expiry."""
    if not token:
        return False
    exp = db.get_session_expiry(token)
    if exp is None or exp < time.time():
        if token:
            db.delete_session_row(token)
        return False
    if touch:
        db.touch_session_row(token, time.time() + SESSION_TTL_SEC)
    return True


def validate_login(password: str) -> bool:
    settings = get_app_settings()
    if not settings.login_password:
        return False
    return secrets.compare_digest(password, settings.login_password)


def require_auth(
    x_session_token: Optional[str] = Header(default=None, alias="X-Session-Token"),
    token: Optional[str] = Query(default=None),
) -> str:
    """Require a valid session. Returns the token.

    Accepts header X-Session-Token or query ?token= (for opening attachments in a new tab).
    Active use slides the session forward another 24 hours.
    """
    db.purge_expired_sessions()
    settings = get_app_settings()
    if settings.setup_required:
        raise HTTPException(status_code=403, detail="Setup required — create a login password first")
    candidate = x_session_token or token
    if not candidate or not db.touch_session_row(candidate, time.time() + SESSION_TTL_SEC):
        raise HTTPException(status_code=401, detail="Please log in")
    return candidate
