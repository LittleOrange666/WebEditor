"""密碼雜湊、token、帳號欄位驗證（spec_new §3）"""
import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .errors import err

_ph = PasswordHasher()

TOKEN_TTL = timedelta(days=30)
TOKEN_TOUCH_INTERVAL = timedelta(hours=1)  # 滑動延長時最多每小時寫入一次

USERNAME_RE = re.compile(r'^[A-Za-z0-9_-]{3,32}$')
BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, pw)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# 帳號不存在時也做一次雜湊比對，避免以回應時間判斷帳號是否存在
_DUMMY_HASH = _ph.hash('not-a-real-password')


def dummy_verify(pw: str) -> None:
    verify_password(pw, _DUMMY_HASH)


def new_token() -> str:
    return secrets.token_urlsafe(32)  # 256 位元


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def token_expiry(now: datetime | None = None) -> datetime:
    return (now or datetime.now(timezone.utc)) + TOKEN_TTL


def new_share_id() -> str:
    return ''.join(secrets.choice(BASE62) for _ in range(10))


def validate_username(name: str) -> str:
    if not USERNAME_RE.match(name or ''):
        raise err(422, 'invalid_username', '使用者名稱需為 3–32 個字元，只能使用英數字、_、-')
    return name


def validate_display_name(name: str | None) -> str | None:
    if name is None:
        return None
    name = name.strip()
    if not name:
        return None
    if len(name) > 32:
        raise err(422, 'invalid_display_name', '顯示名稱最多 32 個字元')
    return name


def validate_password(pw: str) -> str:
    if len(pw or '') < 8:
        raise err(422, 'weak_password', '密碼至少需要 8 個字元')
    if len(pw) > 256:
        raise err(422, 'invalid_password', '密碼太長')
    return pw


def aware(dt: datetime | None) -> datetime | None:
    """SQLite 取回的時間沒有時區，一律視為 UTC"""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
