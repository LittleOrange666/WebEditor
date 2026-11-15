"""帳號：註冊、登入、登出（spec_new §3.1–§3.3）"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_token, current_user
from ..errors import err
from ..models import Token, User
from ..ratelimit import auth_limiter, client_ip
from ..security import (dummy_verify, hash_password, hash_token, new_token, token_expiry, validate_display_name,
                        validate_password, validate_username, verify_password)
from ..serialize import user_with_usage
from ..site import LIMIT_KEYS, load as load_site

router = APIRouter()


@router.get('/config')
def site_config(db: Session = Depends(get_db)):
    s = load_site(db)
    return {'allowRegistration': bool(s['allow_registration']), 'limits': {k: s[k] for k in LIMIT_KEYS}}


class RegisterIn(BaseModel):
    username: str
    password: str
    displayName: str | None = None


class LoginIn(BaseModel):
    username: str
    password: str


def issue_token(db: Session, user: User, request: Request) -> str:
    raw = new_token()
    now = datetime.now(timezone.utc)
    db.add(Token(user_id=user.id, token_hash=hash_token(raw), created_at=now, last_used_at=now,
                 expires_at=token_expiry(now), user_agent=(request.headers.get('user-agent') or '')[:255]))
    user.last_login_at = now
    db.commit()
    return raw


@router.post('/auth/register')
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    auth_limiter.hit(f'ip:{client_ip(request)}')
    if not load_site(db)['allow_registration']:
        raise err(403, 'registration_closed', '目前未開放自行註冊，請聯絡管理員建立帳號')
    username = validate_username(body.username)
    validate_password(body.password)
    user = User(username=username, username_key=username.lower(), display_name=validate_display_name(body.displayName),
                password_hash=hash_password(body.password), origin='self')
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise err(409, 'username_taken', '此使用者名稱已被使用')
    token = issue_token(db, user, request)
    return {'token': token, 'user': user_with_usage(db, user)}


@router.post('/auth/login')
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    key = (body.username or '').lower()
    auth_limiter.hit(f'ip:{client_ip(request)}', f'user:{key}')
    user = db.query(User).filter(User.username_key == key).one_or_none()
    if user is None:
        dummy_verify(body.password or '')
        raise err(401, 'bad_credentials', '帳號或密碼錯誤')
    if not verify_password(body.password or '', user.password_hash):
        raise err(401, 'bad_credentials', '帳號或密碼錯誤')
    if user.is_disabled:
        raise err(403, 'account_disabled', '此帳號已被停用')
    token = issue_token(db, user, request)
    return {'token': token, 'user': user_with_usage(db, user)}


@router.post('/auth/logout')
def logout(tok: Token = Depends(current_token), db: Session = Depends(get_db)):
    db.delete(db.merge(tok))
    db.commit()
    return {'ok': True}


@router.post('/auth/logout-all')
def logout_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(Token).filter(Token.user_id == user.id).delete()
    db.commit()
    return {'ok': True}
