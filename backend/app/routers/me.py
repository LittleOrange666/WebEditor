"""帳號設定（spec_new §3.4）"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..errors import err
from ..models import Token, User
from ..security import hash_password, validate_display_name, validate_password, verify_password
from ..serialize import user_with_usage

router = APIRouter()


@router.get('/me')
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_with_usage(db, user)


class PatchMe(BaseModel):
    displayName: str | None = None


@router.patch('/me')
def patch_me(body: PatchMe, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.display_name = validate_display_name(body.displayName)
    db.commit()
    return user_with_usage(db, user)


class PasswordIn(BaseModel):
    oldPassword: str
    newPassword: str


@router.post('/me/password')
def change_password(body: PasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(body.oldPassword, user.password_hash):
        raise err(403, 'bad_password', '舊密碼不正確')
    validate_password(body.newPassword)
    user.password_hash = hash_password(body.newPassword)
    db.query(Token).filter(Token.user_id == user.id).delete()  # 撤銷所有 token（含目前這個）
    db.commit()
    return {'ok': True}


class DeleteMe(BaseModel):
    password: str


@router.delete('/me')
def delete_me(body: DeleteMe, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.is_initial_admin:
        raise err(403, 'protected_account', '初始管理員帳號不可刪除')
    if user.origin != 'self':
        raise err(403, 'admin_created', '由管理員建立的帳號不能自行刪除，請聯絡管理員')
    if not verify_password(body.password, user.password_hash):
        raise err(403, 'bad_password', '密碼不正確')
    if user.is_admin and db.query(User).filter(User.is_admin.is_(True), User.id != user.id).count() == 0:
        raise err(409, 'last_admin', '不可刪除最後一個管理員')
    db.delete(user)
    db.commit()
    return {'ok': True}
