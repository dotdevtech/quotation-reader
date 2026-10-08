"""Application settings from environment / .env (server bind + DB path only)."""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_ROOT / ".env"


class EnvSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    host: str = "127.0.0.1"
    port: int = 8000
    database_path: str = "data/quotation_reader.db"
    # Comma-separated extra browser origins (e.g. https://crm.impexnine.com)
    cors_origins: str = ""


    # Seed defaults for first-time SQLite settings (optional)
    imap_host: str = "mail.impexnine.com"
    imap_port: int = 993
    imap_user: str = ""
    imap_password: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    forward_webhook_url: str = ""
    forward_webhook_token: str = ""
    app_password: str = ""

    @property
    def db_path(self) -> Path:
        p = Path(self.database_path)
        if not p.is_absolute():
            p = BACKEND_ROOT / p
        return p


def get_settings() -> EnvSettings:
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE, override=True)
    return EnvSettings()
