"""管理 API（spec_new §6）：皆需管理員"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import admin_user
from ..errors import err
from ..models import Entry, Project, Share, Token, User
from ..security import hash_password, validate_display_name, validate_password, validate_username
from ..serialize import iso, lock_user_row, user_public, user_write_lock
from ..site import LIMIT_KEYS, load as load_site, save as save_site
from ..storage import now, quota_of, usage
from .shares import share_detail, share_summary
from .sync import entry_out, project_out, tombstone_project

router = APIRouter(prefix='/admin', dependencies=[Depends(admin_user)])


def user_admin_out(db: Session, u: User, limits: dict) -> dict:
    projects = db.query(func.count(Project.id)).filter(Project.user_id == u.id, Project.deleted.is_(False)).scalar()
    return {**user_public(u), 'isDisabled': u.is_disabled, 'usedBytes': usage(db, u.id),
            'quotaBytes': quota_of(u, limits), 'quotaOverride': u.quota_bytes, 'projectCount': projects,
            'createdAt': iso(u.created_at), 'lastLoginAt': iso(u.last_login_at)}


@router.get('/users')
def list_users(q: str = '', page: int = Query(1, ge=1), per_page: int = Query(50, ge=1, le=200),
               db: Session = Depends(get_db)):
    query = db.query(User)
    if q:
        like = f'%{q.lower()}%'
        query = query.filter(or_(User.username_key.like(like), func.lower(User.display_name).like(like)))
    total = query.count()
    rows = query.order_by(User.created_at).offset((page - 1) * per_page).limit(per_page).all()
    limits = load_site(db)
    return {'total': total, 'users': [user_admin_out(db, u, limits) for u in rows]}


class CreateUser(BaseModel):
    username: str
    password: str
    displayName: str | None = None


@router.post('/users')
def create_user(body: CreateUser, db: Session = Depends(get_db)):
    username = validate_username(body.username)
    validate_password(body.password)
    u = User(username=username, username_key=username.lower(), display_name=validate_display_name(body.displayName),
             password_hash=hash_password(body.password), origin='admin')
    db.add(u)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise err(409, 'username_taken', '此使用者名稱已被使用')
    return user_admin_out(db, u, load_site(db))


class PatchUser(BaseModel):
    displayName: str | None = None
    isDisabled: bool | None = None
    isAdmin: bool | None = None
    quotaBytes: int | None = Field(default=None, ge=0)
    clearQuota: bool = False
    password: str | None = None


def _get_user(db: Session, user_id: int) -> User:
    u = db.get(User, user_id)
    if u is None:
        raise err(404, 'not_found', '找不到使用者')
    return u


def _admin_count(db: Session) -> int:
    return db.query(User).filter(User.is_admin.is_(True)).count()


@router.patch('/users/{user_id}')
def patch_user(user_id: int, body: PatchUser, me: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = _get_user(db, user_id)
    fields = body.model_fields_set
    revoke = False
    if 'displayName' in fields:
        u.display_name = validate_display_name(body.displayName)
    if body.isDisabled is not None and body.isDisabled != u.is_disabled:
        if body.isDisabled and u.is_initial_admin:
            raise err(403, 'protected_account', '初始管理員不可停用')
        if body.isDisabled and u.id == me.id:
            raise err(409, 'self', '不能停用自己')
        u.is_disabled = body.isDisabled
        revoke = revoke or body.isDisabled
    if body.isAdmin is not None and body.isAdmin != u.is_admin:
        if not body.isAdmin:
            if u.is_initial_admin:
                raise err(403, 'protected_account', '初始管理員不可取消管理員身分')
            if u.id == me.id:
                raise err(409, 'self', '不能取消自己的管理員身分')
            if _admin_count(db) <= 1:
                raise err(409, 'last_admin', '不可取消最後一個管理員')
        u.is_admin = body.isAdmin
    if body.clearQuota:
        u.quota_bytes = None
    elif body.quotaBytes is not None:
        u.quota_bytes = body.quotaBytes
    if body.password is not None:
        validate_password(body.password)
        u.password_hash = hash_password(body.password)
        revoke = True
    if revoke:
        db.query(Token).filter(Token.user_id == u.id).delete()
    db.commit()
    return user_admin_out(db, u, load_site(db))


class ConfirmDelete(BaseModel):
    confirm: str


@router.delete('/users/{user_id}')
def delete_user(user_id: int, body: ConfirmDelete, me: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = _get_user(db, user_id)
    if u.is_initial_admin:
        raise err(403, 'protected_account', '初始管理員帳號不可刪除')
    if u.id == me.id:
        raise err(409, 'self', '不能在管理頁刪除自己')
    if body.confirm != u.username:
        raise err(422, 'confirm_mismatch', '請輸入正確的使用者名稱以確認')
    if u.is_admin and _admin_count(db) <= 1:
        raise err(409, 'last_admin', '不可刪除最後一個管理員')
    db.delete(u)
    db.commit()
    return {'ok': True}


@router.get('/users/{user_id}/projects')
def user_projects(user_id: int, db: Session = Depends(get_db)):
    _get_user(db, user_id)
    rows = db.query(Project).filter(Project.user_id == user_id, Project.deleted.is_(False)).order_by(Project.name).all()
    stats = dict(
        (pid, (cnt, size)) for pid, cnt, size in db.query(
            Entry.project_id, func.count(Entry.id), func.coalesce(func.sum(Entry.size), 0)
        ).filter(Entry.user_id == user_id, Entry.deleted.is_(False), Entry.kind == 'file').group_by(Entry.project_id)
    )
    return {'projects': [{**project_out(p), 'fileCount': stats.get(p.id, (0, 0))[0],
                          'size': int(stats.get(p.id, (0, 0))[1])} for p in rows]}


def _get_project(db: Session, project_id: str) -> Project:
    p = db.get(Project, project_id)
    if p is None or p.deleted:
        raise err(404, 'not_found', '找不到專案')
    return p


@router.get('/projects/{project_id}')
def read_project(project_id: str, db: Session = Depends(get_db)):
    p = _get_project(db, project_id)
    owner = db.get(User, p.user_id)
    entries = db.query(Entry).filter(Entry.project_id == p.id, Entry.deleted.is_(False)).order_by(Entry.path).all()
    return {**project_out(p), 'owner': user_public(owner), 'entries': [entry_out(e) for e in entries]}


@router.delete('/projects/{project_id}')
def delete_project(project_id: str, db: Session = Depends(get_db)):
    p = _get_project(db, project_id)
    with user_write_lock(p.user_id):
        owner = lock_user_row(db, p.user_id)
        tombstone_project(db, owner, p)
        db.commit()
    return {'ok': True}


@router.get('/shares')
def list_shares(q: str = '', page: int = Query(1, ge=1), per_page: int = Query(50, ge=1, le=200),
                db: Session = Depends(get_db)):
    query = db.query(Share, User).join(User, User.id == Share.user_id).filter(
        or_(Share.expires_at.is_(None), Share.expires_at > now()))
    if q:
        like = f'%{q.lower()}%'
        query = query.filter(or_(func.lower(Share.title).like(like), User.username_key.like(like), Share.id == q))
    total = query.count()
    rows = query.order_by(Share.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()
    return {'total': total, 'shares': [{**share_summary(s, u), 'authorDisabled': u.is_disabled} for s, u in rows]}


@router.get('/shares/{share_id}')
def read_share(share_id: str, db: Session = Depends(get_db)):
    s = db.get(Share, share_id)
    if s is None:
        raise err(404, 'not_found', '找不到分享')
    return share_detail(db, s, db.get(User, s.user_id))


@router.delete('/shares/{share_id}')
def revoke_share(share_id: str, db: Session = Depends(get_db)):
    s = db.get(Share, share_id)
    if s is None:
        raise err(404, 'not_found', '找不到分享')
    db.delete(s)
    db.commit()
    return {'ok': True}


class SiteIn(BaseModel):
    allowRegistration: bool | None = None
    file_bytes: int | None = Field(default=None, ge=1024)
    project_bytes: int | None = Field(default=None, ge=1024)
    quota_bytes: int | None = Field(default=None, ge=0)
    max_projects: int | None = Field(default=None, ge=1)
    request_bytes: int | None = Field(default=None, ge=64 * 1024)


def _site_out(s: dict) -> dict:
    return {'allowRegistration': bool(s['allow_registration']), 'limits': {k: s[k] for k in LIMIT_KEYS}}


@router.get('/settings')
def get_site(db: Session = Depends(get_db)):
    return _site_out(load_site(db))


@router.patch('/settings')
def patch_site(body: SiteIn, db: Session = Depends(get_db)):
    patch = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None and k in LIMIT_KEYS}
    if body.allowRegistration is not None:
        patch['allow_registration'] = body.allowRegistration
    return _site_out(save_site(db, patch))
