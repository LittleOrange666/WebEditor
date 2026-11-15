"""啟動時的初始化（migration、初始管理員）與定期清理（spec_new §6.2、§7.1）"""
import asyncio
import logging
from datetime import timedelta
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import config
from .db import engine, new_session
from .models import Entry, Project, Share, Token, User
from .security import hash_password, validate_password, validate_username
from .storage import now

log = logging.getLogger('webeditor')
TOMBSTONE_TTL = timedelta(days=30)
BACKEND_DIR = Path(__file__).resolve().parent.parent


def run_migrations(url: str | None = None) -> None:
    from alembic import command
    from alembic.config import Config as AlembicConfig

    cfg = AlembicConfig(str(BACKEND_DIR / 'alembic.ini'))
    cfg.set_main_option('script_location', str(BACKEND_DIR / 'migrations'))
    cfg.attributes['connection_url'] = url or str(engine().url.render_as_string(hide_password=False))
    command.upgrade(cfg, 'head')


def has_initial_admin(db: Session) -> bool:
    return db.query(User).filter(User.is_initial_admin.is_(True)).first() is not None


def create_admin(db: Session, username: str, password: str) -> User:
    """建立管理員；若還沒有初始管理員，這個就是初始管理員"""
    validate_username(username)
    validate_password(password)
    if db.query(User).filter(User.username_key == username.lower()).first():
        raise ValueError(f'使用者名稱 {username} 已存在')
    u = User(username=username, username_key=username.lower(), password_hash=hash_password(password),
             is_admin=True, is_initial_admin=not has_initial_admin(db), origin='admin')
    db.add(u)
    db.commit()
    return u


def bootstrap_admin() -> None:
    if not (config.admin_username and config.admin_password):
        return
    with new_session() as db:
        if db.query(User).filter(User.is_admin.is_(True)).first():
            return
        try:
            create_admin(db, config.admin_username, config.admin_password)
            log.info('已建立初始管理員 %s', config.admin_username)
        except Exception as e:  # noqa: BLE001
            log.error('無法建立初始管理員：%s', getattr(e, 'message', e))


def cleanup(db: Session) -> dict:
    """刪除過期的分享、過期的 token、超過 30 天的墓碑"""
    t = now()
    shares = db.query(Share).filter(Share.expires_at.isnot(None), Share.expires_at <= t).delete()
    tokens = db.query(Token).filter(Token.expires_at <= t).delete()
    cutoff = t - TOMBSTONE_TTL
    purged = 0
    # 記錄每個帳號被清除的最大 rev，讓太久沒同步的客戶端改做完整同步
    for uid, max_rev in db.query(Entry.user_id, func.max(Entry.rev)).filter(
            Entry.deleted.is_(True), Entry.updated_at <= cutoff).group_by(Entry.user_id).all():
        _bump_purged(db, uid, max_rev)
    for uid, max_rev in db.query(Project.user_id, func.max(Project.rev)).filter(
            Project.deleted.is_(True), Project.updated_at <= cutoff).group_by(Project.user_id).all():
        _bump_purged(db, uid, max_rev)
    purged += db.query(Entry).filter(Entry.deleted.is_(True), Entry.updated_at <= cutoff).delete()
    old_projects = db.query(Project).filter(Project.deleted.is_(True), Project.updated_at <= cutoff).all()
    for p in old_projects:
        if db.query(Entry.id).filter(Entry.project_id == p.id).first() is None:
            db.delete(p)
            purged += 1
    db.commit()
    return {'shares': shares, 'tokens': tokens, 'tombstones': purged}


def _bump_purged(db: Session, user_id: int, rev: int) -> None:
    u = db.get(User, user_id)
    if u is not None and (u.purged_rev or 0) < rev:
        u.purged_rev = rev


async def cleanup_loop() -> None:
    while True:
        try:
            with new_session() as db:
                r = await asyncio.to_thread(cleanup, db)
                if any(r.values()):
                    log.info('清理完成：%s', r)
        except Exception:  # noqa: BLE001
            log.exception('清理失敗')
        await asyncio.sleep(config.cleanup_interval_s)
