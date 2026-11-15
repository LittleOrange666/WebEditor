"""分享（spec_new §5）：建立時的快照，任何人有連結即可讀取"""
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..errors import err
from ..models import Share, ShareEntry, User
from ..security import aware, new_share_id
from ..serialize import iso, user_write_lock
from ..site import load as load_site
from ..storage import byte_len, is_syncable, now, quota_of, usage, valid_path

router = APIRouter()


class ShareFile(BaseModel):
    path: str
    kind: Literal['file', 'dir'] = 'file'
    content: str | None = None


class ShareIn(BaseModel):
    kind: Literal['file', 'project']
    title: str = Field(max_length=200)
    description: str = Field(default='', max_length=1000)
    expiresInDays: Literal[1, 7, 30] | None = None
    files: list[ShareFile] = Field(max_length=5000)


def share_summary(s: Share, author: User | None = None) -> dict:
    out = {'id': s.id, 'kind': s.kind, 'title': s.title, 'description': s.description, 'size': s.size,
           'viewCount': s.view_count, 'createdAt': iso(s.created_at), 'expiresAt': iso(s.expires_at)}
    if author is not None:
        out['author'] = {'id': author.id, 'username': author.username, 'displayName': author.display_name}
    return out


def is_live(s: Share) -> bool:
    return s.expires_at is None or aware(s.expires_at) > now()


@router.post('/shares')
def create_share(body: ShareIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    limits = load_site(db)
    files = body.files
    seen = set()
    total = 0
    for f in files:
        if not valid_path(f.path):
            raise err(422, 'invalid_path', f'不合法的路徑：{f.path}')
        if f.path.lower() in seen:
            raise err(422, 'duplicate_path', f'路徑重複：{f.path}')
        seen.add(f.path.lower())
        if f.kind == 'file':
            if not is_syncable(f.path):
                raise err(422, 'not_syncable', f'{f.path} 不是可分享的程式檔')
            size = byte_len(f.content)
            if size > limits['file_bytes']:
                raise err(413, 'too_large', f'{f.path} 超過單檔上限 {limits["file_bytes"] // 1024} KB')
            total += size
    real = [f for f in files if f.kind == 'file']
    if not real or all(not (f.content or '').strip() for f in real):
        raise err(422, 'empty', '沒有可分享的內容')
    if body.kind == 'file' and (len(real) != 1 or len(files) != 1):
        raise err(422, 'invalid', '分享單一檔案時只能包含一個檔案')
    if total > limits['project_bytes']:
        raise err(413, 'project_too_large', f'內容超過上限 {limits["project_bytes"] // 1024 // 1024} MB')
    title = body.title.strip() or (real[0].path.rsplit('/', 1)[-1] if body.kind == 'file' else '未命名專案')

    with user_write_lock(user.id):
        if usage(db, user.id) + total > quota_of(user, limits):
            raise err(413, 'quota_exceeded', '雲端空間已滿')
        expires = now() + timedelta(days=body.expiresInDays) if body.expiresInDays else None
        for _ in range(5):
            share = Share(id=new_share_id(), user_id=user.id, kind=body.kind, title=title,
                          description=body.description.strip(), size=total, expires_at=expires, created_at=now())
            db.add(share)
            try:
                db.flush()
                break
            except IntegrityError:
                db.rollback()
        else:
            raise err(500, 'error', '無法建立分享，請稍後再試')
        for f in files:
            db.add(ShareEntry(share_id=share.id, path=f.path, kind=f.kind,
                              content=(f.content or '') if f.kind == 'file' else None))
        db.commit()
    return share_summary(share)


@router.get('/shares')
def my_shares(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Share).filter(Share.user_id == user.id, or_(Share.expires_at.is_(None), Share.expires_at > now())) \
        .order_by(Share.created_at.desc()).all()
    return {'shares': [share_summary(s) for s in rows]}


@router.delete('/shares/{share_id}')
def revoke(share_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(Share, share_id)
    if s is None or s.user_id != user.id:
        raise err(404, 'not_found', '此分享連結不存在或已失效')
    db.delete(s)
    db.commit()
    return {'ok': True}


def share_detail(db: Session, s: Share, author: User) -> dict:
    entries = db.query(ShareEntry).filter(ShareEntry.share_id == s.id).order_by(ShareEntry.path).all()
    return {**share_summary(s, author),
            'files': [{'path': e.path, 'kind': e.kind, **({'content': e.content or ''} if e.kind == 'file' else {})}
                      for e in entries]}


@router.get('/s/{share_id}')
def read_share(share_id: str, db: Session = Depends(get_db)):
    s = db.get(Share, share_id)
    author = db.get(User, s.user_id) if s is not None else None
    if s is None or not is_live(s) or author is None or author.is_disabled:
        raise err(404, 'not_found', '此分享連結不存在或已失效')
    s.view_count += 1
    db.commit()
    return share_detail(db, s, author)
