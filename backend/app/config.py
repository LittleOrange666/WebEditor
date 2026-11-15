"""環境變數設定（spec_new §7.1）"""
import os
from dataclasses import dataclass, field


def _bool(v: str | None, default: bool = False) -> bool:
    if v is None or v == '':
        return default
    return v.strip().lower() in ('1', 'true', 'yes', 'on')


@dataclass
class Config:
    database_url: str = field(default_factory=lambda: os.environ.get('DATABASE_URL', 'sqlite:///./webeditor.db'))
    allowed_origins: list[str] = field(default_factory=lambda: [
        o.strip().rstrip('/') for o in os.environ.get('ALLOWED_ORIGINS', 'http://localhost:5173').split(',') if o.strip()
    ])
    allow_registration: bool = field(default_factory=lambda: _bool(os.environ.get('ALLOW_REGISTRATION')))
    admin_username: str = field(default_factory=lambda: os.environ.get('ADMIN_USERNAME', ''))
    admin_password: str = field(default_factory=lambda: os.environ.get('ADMIN_PASSWORD', ''))
    trust_proxy: bool = field(default_factory=lambda: _bool(os.environ.get('TRUST_PROXY')))
    run_migrations: bool = field(default_factory=lambda: _bool(os.environ.get('RUN_MIGRATIONS'), True))
    cleanup_interval_s: int = field(default_factory=lambda: int(os.environ.get('CLEANUP_INTERVAL_S', '3600')))


config = Config()
