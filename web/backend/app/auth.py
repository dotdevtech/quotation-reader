"""Simple session auth for the local web UI."""

from __future__ import annotations

import secrets
import time
from typing import Optional

from fastapi import Header, HTTPException, Query

from .settings_store import get_app_settings

# token -> expiry unix time
_SESSIONS: dict[str, float] = {}
SESSION_TTL_SEC = 60 * 60 * 12  # 12 hours


def create_session() -> str:
    token = secrets.token_urlsafe(32)
    _SESSIONS[token] = time.time() + SESSION_TTL_SEC
    _purge()
    return token


def destroy_session(token: Optional[str]) -> None:
    if token:
        _SESSIONS.pop(token, None)


def _purge() -> None:
    now = time.time()
    dead = [t for t, exp in _SESSIONS.items() if exp < now]
    for t in dead:
        _SESSIONS.pop(t, None)


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
    """
    _purge()
    settings = get_app_settings()
    if settings.setup_required:
        raise HTTPException(status_code=403, detail="Setup required — create a login password first")
    candidate = x_session_token or token
    if not candidate or candidate not in _SESSIONS:
        raise HTTPException(status_code=401, detail="Please log in")
    _SESSIONS[candidate] = time.time() + SESSION_TTL_SEC
    return candidate
