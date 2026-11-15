"""雲端同步（spec_new §4.3、§4.4、§4.5）

上傳：POST /sync，批次送出變更，每筆附上本地所依據的 baseRev，逐筆回報結果：
  ok        已套用（附新的 rev；檔案可能因撞名被改名，附實際 path）
  merged    資料夾與既有的同名資料夾合併（附既有資料夾的紀錄，前端改用它）
  conflict  伺服器上的版本比 baseRev 新且內容不同（附雲端目前的紀錄）
  rejected  無法套用（附 reason：too_large、quota_exceeded … 與中文訊息）
下載：GET /sync?since=<cursor>
"""
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import Entry, Project, User, UserSettings
from ..serialize import iso, lock_user_row, user_write_lock
from ..site import load as load_site
from ..storage import byte_len, is_syncable, next_rev, now, project_count, project_size, quota_of, usage, valid_path

router = APIRouter()


class Change(BaseModel):
    type: Literal['project', 'entry', 'settings']
    id: str = Field(default='', max_length=64)
    op: Literal['put', 'delete'] = 'put'
    baseRev: int = 0
    data: dict[str, Any] = Field(default_factory=dict)


class SyncIn(BaseModel):
    changes: list[Change] = Field(max_length=1000)


def project_out(p: Project) -> dict:
    return {'id': p.id, 'name': p.name, 'rev': p.rev, 'deleted': p.deleted,
            'createdAt': iso(p.created_at), 'updatedAt': iso(p.updated_at)}


def entry_out(e: Entry) -> dict:
    out = {'id': e.id, 'projectId': e.project_id, 'path': e.path, 'kind': e.kind, 'rev': e.rev,
           'deleted': e.deleted, 'updatedAt': iso(e.updated_at)}
    if e.kind == 'file' and not e.deleted:
        out['content'] = e.content or ''
    return out


class Rejected(Exception):
    def __init__(self, reason: str, message: str):
        self.reason = reason
        self.message = message


def _unique_path(db: Session, project_id: str, path: str, self_id: str) -> str:
    """同一專案中撞名時加上 (1)、(2)…（不分大小寫）"""
    def taken(p: str) -> bool:
        return db.query(Entry.id).filter(Entry.project_id == project_id, Entry.path_key == p.lower(),
                                         Entry.deleted.is_(False), Entry.id != self_id).first() is not None
    if not taken(path):
        return path
    d, _, name = path.rpartition('/')
    dot = name.rfind('.')
    stem, ext = (name[:dot], name[dot:]) if dot > 0 else (name, '')
    i = 1
    while True:
        cand = f'{stem} ({i}){ext}'
        full = f'{d}/{cand}' if d else cand
        if not taken(full):
            return full
        i += 1


class Ctx:
    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user
        self.limits = load_site(db)
        self.quota = quota_of(user, self.limits)
        self.used = usage(db, user.id)


def put_project(ctx: Ctx, c: Change) -> dict:
    db, user = ctx.db, ctx.user
    name = str(c.data.get('name') or '').strip()[:200] or '未命名專案'
    p = db.get(Project, c.id)
    if p is not None and p.user_id != user.id:
        raise Rejected('forbidden', '沒有權限')
    if p is None or p.deleted:
        if p is not None and p.rev > c.baseRev:
            return {'status': 'conflict', 'current': project_out(p)}
        if project_count(db, user.id) >= ctx.limits['max_projects']:
            raise Rejected('too_many_projects', f'雲端專案數已達上限 {ctx.limits["max_projects"]} 個')
        if p is None:
            p = Project(id=c.id, user_id=user.id, created_at=now())
            db.add(p)
        p.deleted = False
    p.name = name
    p.rev = next_rev(user)
    p.updated_at = now()
    return {'status': 'ok', 'rev': p.rev}


def delete_project(ctx: Ctx, c: Change) -> dict:
    db, user = ctx.db, ctx.user
    p = db.get(Project, c.id)
    if p is None or p.user_id != user.id or p.deleted:
        return {'status': 'ok', 'rev': p.rev if p is not None and p.user_id == user.id else 0}
    tombstone_project(db, user, p)
    return {'status': 'ok', 'rev': p.rev}


def tombstone_project(db: Session, user: User, p: Project) -> None:
    """刪除專案：專案與其中所有檔案都留下墓碑，讓其他裝置同步刪除"""
    ts = now()
    for e in db.query(Entry).filter(Entry.project_id == p.id, Entry.deleted.is_(False)).order_by(Entry.path).all():
        e.deleted, e.content, e.size, e.rev, e.updated_at = True, None, 0, next_rev(user), ts
    p.deleted = True
    p.rev = next_rev(user)
    p.updated_at = ts


def put_entry(ctx: Ctx, c: Change) -> dict:
    db, user, limits = ctx.db, ctx.user, ctx.limits
    d = c.data
    project_id = str(d.get('projectId') or '')
    path = d.get('path')
    kind = d.get('kind')
    content = d.get('content') if kind == 'file' else None
    if kind not in ('file', 'dir') or not valid_path(path) or (kind == 'file' and not isinstance(content, str)):
        raise Rejected('invalid', '資料格式錯誤')
    p = db.get(Project, project_id)
    if p is None or p.user_id != user.id:
        raise Rejected('project_missing', '專案不存在')
    if p.deleted:
        raise Rejected('project_deleted', '專案已被刪除')
    if kind == 'file' and not is_syncable(path):
        raise Rejected('not_syncable', '此類檔案不會上傳到雲端')
    size = byte_len(content)
    if size > limits['file_bytes']:
        raise Rejected('too_large', f'檔案超過雲端單檔上限 {limits["file_bytes"] // 1024} KB')

    e = db.get(Entry, c.id)
    if e is not None and (e.user_id != user.id or e.project_id != project_id):
        raise Rejected('forbidden', '沒有權限')
    if e is not None and e.rev > c.baseRev:
        if e.deleted:
            return {'status': 'conflict', 'current': entry_out(e)}
        same = e.kind == kind and (e.content or '') == (content or '')
        if not same:
            return {'status': 'conflict', 'current': entry_out(e)}
        # 內容相同：只有路徑不同時以後到者為準

    old_size = e.size if e is not None and not e.deleted else 0
    if project_size(db, project_id, exclude_id=c.id) + size > limits['project_bytes']:
        raise Rejected('project_too_large', f'專案超過雲端上限 {limits["project_bytes"] // 1024 // 1024} MB')
    if ctx.used - old_size + size > ctx.quota:
        raise Rejected('quota_exceeded', '雲端空間已滿')

    # 同名資料夾直接合併；同名檔案自動改名
    other = db.query(Entry).filter(Entry.project_id == project_id, Entry.path_key == path.lower(),
                                   Entry.deleted.is_(False), Entry.id != c.id).first()
    if other is not None and kind == 'dir' and other.kind == 'dir':
        if e is not None and not e.deleted:
            e.deleted, e.rev, e.updated_at = True, next_rev(user), now()
        return {'status': 'merged', 'current': entry_out(other)}
    if other is not None:
        path = _unique_path(db, project_id, path, c.id)

    if e is None:
        e = Entry(id=c.id, project_id=project_id, user_id=user.id)
        db.add(e)
    e.path, e.path_key, e.kind, e.content, e.size = path, path.lower(), kind, content, size
    e.deleted = False
    e.rev = next_rev(user)
    e.updated_at = now()
    ctx.used += size - old_size
    p.updated_at = now()
    return {'status': 'ok', 'rev': e.rev, 'path': path}


def delete_entry(ctx: Ctx, c: Change) -> dict:
    db, user = ctx.db, ctx.user
    e = db.get(Entry, c.id)
    if e is None or e.user_id != user.id:
        return {'status': 'ok', 'rev': 0}
    if e.deleted:
        return {'status': 'ok', 'rev': e.rev}
    if e.kind == 'file' and e.rev > c.baseRev:
        # 本地刪除 vs 雲端修改：保留雲端版本
        return {'status': 'conflict', 'current': entry_out(e)}
    ctx.used -= e.size
    e.deleted, e.content, e.size, e.rev, e.updated_at = True, None, 0, next_rev(user), now()
    return {'status': 'ok', 'rev': e.rev}


def put_settings(ctx: Ctx, c: Change) -> dict:
    db, user = ctx.db, ctx.user
    value = c.data.get('value')
    if not isinstance(value, dict):
        raise Rejected('invalid', '資料格式錯誤')
    row = db.get(UserSettings, user.id)
    if row is None:
        row = UserSettings(user_id=user.id, value=value, rev=0)
        db.add(row)
    row.value = value
    row.rev = next_rev(user)
    return {'status': 'ok', 'rev': row.rev}


HANDLERS = {
    ('project', 'put'): put_project,
    ('project', 'delete'): delete_project,
    ('entry', 'put'): put_entry,
    ('entry', 'delete'): delete_entry,
    ('settings', 'put'): put_settings,
}


@router.post('/sync')
def push(body: SyncIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    results = []
    with user_write_lock(user.id):
        locked = lock_user_row(db, user.id)
        ctx = Ctx(db, locked)
        for c in body.changes:
            handler = HANDLERS.get((c.type, c.op))
            base = {'type': c.type, 'id': c.id}
            if handler is None or (c.type != 'settings' and not c.id):
                results.append({**base, 'status': 'rejected', 'reason': 'invalid', 'message': '不支援的操作'})
                continue
            cursor_before = locked.cursor
            sp = db.begin_nested()
            try:
                r = handler(ctx, c)
                db.flush()
                sp.commit()
            except Rejected as e:
                sp.rollback()
                locked.cursor = cursor_before
                r = {'status': 'rejected', 'reason': e.reason, 'message': e.message}
            except IntegrityError:
                sp.rollback()
                locked.cursor = cursor_before
                r = {'status': 'rejected', 'reason': 'invalid', 'message': '資料衝突，請稍後再試'}
            results.append({**base, **r})
        db.commit()
        cursor = locked.cursor
        used = usage(db, user.id)
    return {'results': results, 'cursor': cursor, 'usedBytes': used, 'quotaBytes': ctx.quota}


@router.get('/sync')
def pull(since: int = Query(0, ge=0), limit: int = Query(500, ge=1, le=2000),
         user: User = Depends(current_user), db: Session = Depends(get_db)):
    # 已被清除的墓碑比 since 新：客戶端可能漏掉刪除，要求完整重新同步
    reset = 0 < since < (user.purged_rev or 0)
    if reset:
        since = 0
    full = since == 0
    pq = db.query(Project).filter(Project.user_id == user.id, Project.rev > since)
    eq = db.query(Entry).filter(Entry.user_id == user.id, Entry.rev > since)
    if full:
        pq = pq.filter(Project.deleted.is_(False))
        eq = eq.filter(Entry.deleted.is_(False))
    projects = pq.order_by(Project.rev).all()
    entries = eq.order_by(Entry.rev).limit(limit + 1).all()
    more = len(entries) > limit
    entries = entries[:limit]
    cursor = entries[-1].rev if more else user.cursor
    settings = db.get(UserSettings, user.id)
    return {
        'cursor': cursor,
        'more': more,
        'full': full,
        'reset': reset,
        'projects': [project_out(p) for p in projects],
        'entries': [entry_out(e) for e in entries],
        'settings': {'value': settings.value, 'rev': settings.rev} if settings and settings.rev > since else None,
    }
