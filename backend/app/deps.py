"""目前使用者（Bearer token）"""
from datetime import datetime, timezone

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from .db import get_db
from .errors import err
from .models import Token, User
from .security import TOKEN_TOUCH_INTERVAL, aware, hash_token, token_expiry


def _bearer(request: Request) -> str | None:
    h = request.headers.get('authorization', '')
    if h[:7].lower() == 'bearer ':
        return h[7:].strip() or None
    return None


def current_token(request: Request, db: Session = Depends(get_db)) -> Token:
    raw = _bearer(request)
    if not raw:
        raise err(401, 'unauthorized', '請先登入')
    tok = db.query(Token).filter(Token.token_hash == hash_token(raw)).one_or_none()
    now = datetime.now(timezone.utc)
    if tok is None or aware(tok.expires_at) <= now:
        raise err(401, 'unauthorized', '登入已失效，請重新登入')
    if now - aware(tok.last_used_at) > TOKEN_TOUCH_INTERVAL:
        tok.last_used_at = now
        tok.expires_at = token_expiry(now)
        db.commit()
    return tok


def current_user(tok: Token = Depends(current_token), db: Session = Depends(get_db)) -> User:
    user = db.get(User, tok.user_id)
    if user is None:
        raise err(401, 'unauthorized', '登入已失效，請重新登入')
    if user.is_disabled:
        raise err(403, 'account_disabled', '此帳號已被停用')
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise err(403, 'forbidden', '沒有權限')
    return user
