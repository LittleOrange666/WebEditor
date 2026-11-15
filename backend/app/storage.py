"""路徑驗證、可同步的檔案類型、用量計算（spec_new §4.1、§4.5）"""
import re
from datetime import datetime, timezone

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .errors import err
from .models import Entry, Project, Share, User

SYNC_EXTS = ('.cpp', '.cc', '.cxx', '.h', '.hpp', '.py', '.js')
_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def is_syncable(path: str) -> bool:
    return path.lower().endswith(SYNC_EXTS)


def valid_path(path: str) -> bool:
    if not isinstance(path, str) or not path or len(path) > 1024:
        return False
    for seg in path.split('/'):
        if not seg or seg in ('.', '..', '.webeditor') or len(seg) > 200 or _BAD.search(seg):
            return False
    return True


def check_path(path: str) -> str:
    if not valid_path(path):
        raise err(422, 'invalid_path', f'不合法的路徑：{path}')
    return path


def byte_len(s: str | None) -> int:
    return len(s.encode('utf-8')) if s else 0


def now() -> datetime:
    return datetime.now(timezone.utc)


def usage(db: Session, user_id: int) -> int:
    """帳號用量：未刪除的同步檔案 + 未過期的分享快照"""
    files = db.query(func.coalesce(func.sum(Entry.size), 0)).filter(
        Entry.user_id == user_id, Entry.deleted.is_(False)).scalar()
    shares = db.query(func.coalesce(func.sum(Share.size), 0)).filter(
        Share.user_id == user_id, or_(Share.expires_at.is_(None), Share.expires_at > now())).scalar()
    return int(files) + int(shares)


def project_size(db: Session, project_id: str, exclude_id: str | None = None) -> int:
    q = db.query(func.coalesce(func.sum(Entry.size), 0)).filter(
        Entry.project_id == project_id, Entry.deleted.is_(False))
    if exclude_id:
        q = q.filter(Entry.id != exclude_id)
    return int(q.scalar())


def project_count(db: Session, user_id: int) -> int:
    return db.query(func.count(Project.id)).filter(Project.user_id == user_id, Project.deleted.is_(False)).scalar()


def quota_of(user: User, limits: dict) -> int:
    return user.quota_bytes if user.quota_bytes is not None else limits['quota_bytes']


def next_rev(user: User) -> int:
    user.cursor = (user.cursor or 0) + 1
    return user.cursor
