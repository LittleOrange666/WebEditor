"""回應格式與共用小工具"""
import threading
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime

from sqlalchemy.orm import Session

from .models import User
from .security import aware
from .site import load as load_site
from .storage import quota_of, usage


def iso(dt: datetime | None) -> str | None:
    dt = aware(dt)
    return dt.isoformat().replace('+00:00', 'Z') if dt else None


def user_public(user: User) -> dict:
    return {
        'id': user.id,
        'username': user.username,
        'displayName': user.display_name,
        'isAdmin': user.is_admin,
        'isInitialAdmin': user.is_initial_admin,
        'origin': user.origin,
        'canDeleteSelf': user.origin == 'self' and not user.is_initial_admin,
    }


def user_with_usage(db: Session, user: User) -> dict:
    limits = load_site(db)
    return {**user_public(user), 'usedBytes': usage(db, user.id), 'quotaBytes': quota_of(user, limits)}


# 每個帳號的寫入序列化（同一個帳號的變更序號必須依序遞增）
# 單一行程內以 threading.Lock 保證；PostgreSQL 另外以 SELECT ... FOR UPDATE 鎖住使用者列
_user_locks: dict[int, threading.Lock] = defaultdict(threading.Lock)
_guard = threading.Lock()


@contextmanager
def user_write_lock(user_id: int):
    with _guard:
        lock = _user_locks[user_id]
    with lock:
        yield


def lock_user_row(db: Session, user_id: int) -> User:
    return db.query(User).filter(User.id == user_id).populate_existing().with_for_update().one()
