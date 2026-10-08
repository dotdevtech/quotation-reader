"""Runtime app settings stored in SQLite (editable from the UI)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Optional

from . import db
from .config import get_settings

SETTING_KEYS = (
    "login_password",
    "imap_host",
    "imap_port",
    "imap_user",
    "imap_password",
    "openai_api_key",
    "openai_model",
    "forward_webhook_url",
    "forward_webhook_token",
)


@dataclass
class AppSettings:
    login_password: str = ""
    imap_host: str = "mail.impexnine.com"
    imap_port: int = 993
    imap_user: str = ""
    imap_password: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    forward_webhook_url: str = ""
    forward_webhook_token: str = ""

    @property
    def imap_configured(self) -> bool:
        return bool(self.imap_user and self.imap_password)

    @property
    def openai_configured(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def setup_required(self) -> bool:
        return not bool(self.login_password)


def seed_settings_from_env() -> None:
    """Copy .env values into DB once if keys are missing."""
    env = get_settings()
    defaults = {
        # Default panel login — change anytime in Settings
        "login_password": env.app_password or "admin123",
        "imap_host": env.imap_host,
        "imap_port": str(env.imap_port),
        "imap_user": env.imap_user,
        "imap_password": env.imap_password,
        "openai_api_key": env.openai_api_key,
        "openai_model": env.openai_model,
        "forward_webhook_url": env.forward_webhook_url,
        "forward_webhook_token": getattr(env, "forward_webhook_token", "") or "",
    }
    for key, value in defaults.items():
        if db.get_app_setting(key) is None:
            db.set_app_setting(key, value)


def get_app_settings() -> AppSettings:
    seed_settings_from_env()
    raw = {k: (db.get_app_setting(k) or "") for k in SETTING_KEYS}
    port_raw = raw.get("imap_port") or "993"
    try:
        port = int(port_raw)
    except ValueError:
        port = 993
    return AppSettings(
        login_password=raw.get("login_password") or "",
        imap_host=raw.get("imap_host") or "mail.impexnine.com",
        imap_port=port,
        imap_user=raw.get("imap_user") or "",
        imap_password=raw.get("imap_password") or "",
        openai_api_key=raw.get("openai_api_key") or "",
        openai_model=raw.get("openai_model") or "gpt-4o-mini",
        forward_webhook_url=raw.get("forward_webhook_url") or "",
        forward_webhook_token=raw.get("forward_webhook_token") or "",
    )


def update_app_settings(updates: dict[str, Any]) -> AppSettings:
    current = get_app_settings()
    data = asdict(current)

    for key, value in updates.items():
        if key not in SETTING_KEYS:
            continue
        if value is None:
            continue
        # Keep previous secret if client sends blank placeholder
        if key in ("imap_password", "openai_api_key", "login_password", "forward_webhook_token") and value == "":
            continue
        if key == "imap_port":
            data[key] = int(value)
            db.set_app_setting(key, str(int(value)))
        else:
            data[key] = str(value)
            db.set_app_setting(key, str(value))

    return get_app_settings()


def public_settings(include_secrets: bool = False) -> dict[str, Any]:
    s = get_app_settings()
    out: dict[str, Any] = {
        "imap_host": s.imap_host,
        "imap_port": s.imap_port,
        "imap_user": s.imap_user,
        "openai_model": s.openai_model,
        "forward_webhook_url": s.forward_webhook_url,
        "forward_webhook_token_set": bool(s.forward_webhook_token),
        "imap_configured": s.imap_configured,
        "openai_configured": s.openai_configured,
        "setup_required": s.setup_required,
        "imap_password_set": bool(s.imap_password),
        "openai_api_key_set": bool(s.openai_api_key),
        "login_password_set": bool(s.login_password),
    }
    if include_secrets:
        out["imap_password"] = s.imap_password
        out["openai_api_key"] = s.openai_api_key
        out["forward_webhook_token"] = s.forward_webhook_token
    else:
        # Empty fields for form; user leaves blank to keep existing
        out["imap_password"] = ""
        out["openai_api_key"] = ""
        out["login_password"] = ""
        out["forward_webhook_token"] = ""
    return out
