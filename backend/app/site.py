"""站台設定（spec_new §4.5、§6.4）：存在資料庫，修改後立即生效"""
from sqlalchemy.orm import Session

from .config import config
from .models import SiteSetting

KB = 1024
MB = 1024 * 1024

DEFAULTS = {
    'allow_registration': None,  # None → 使用環境變數 ALLOW_REGISTRATION
    'file_bytes': 256 * KB,
    'project_bytes': 2 * MB,
    'quota_bytes': 50 * MB,
    'max_projects': 200,
    'request_bytes': 4 * MB,
}

LIMIT_KEYS = ('file_bytes', 'project_bytes', 'quota_bytes', 'max_projects', 'request_bytes')

# 讀取頻繁（每個請求的大小檢查），快取在記憶體；寫入時更新
_cache: dict | None = None


def load(db: Session) -> dict:
    global _cache
    if _cache is None:
        values = dict(DEFAULTS)
        for row in db.query(SiteSetting).all():
            if row.key in DEFAULTS:
                values[row.key] = row.value.get('v')
        _cache = values
    out = dict(_cache)
    if out['allow_registration'] is None:
        out['allow_registration'] = config.allow_registration
    return out


def save(db: Session, patch: dict) -> dict:
    global _cache
    for k, v in patch.items():
        if k not in DEFAULTS:
            continue
        row = db.get(SiteSetting, k)
        if row is None:
            db.add(SiteSetting(key=k, value={'v': v}))
        else:
            row.value = {'v': v}
    db.commit()
    _cache = None
    return load(db)


def reset_cache() -> None:
    global _cache
    _cache = None


def cached_request_limit() -> int:
    return (_cache or DEFAULTS)['request_bytes']
