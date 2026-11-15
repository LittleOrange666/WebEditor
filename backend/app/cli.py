"""管理員救援指令（spec_new §6.2）

  python -m app.cli create-admin <username>
  python -m app.cli set-password <username>
  python -m app.cli promote <username>
  python -m app.cli demote <username>
"""
import argparse
import getpass
import sys

from .db import new_session
from .errors import APIError
from .maintenance import create_admin, run_migrations
from .models import Token, User
from .security import hash_password, validate_password


def _ask_password() -> str:
    pw = getpass.getpass('密碼：')
    if pw != getpass.getpass('再輸入一次：'):
        raise SystemExit('兩次輸入的密碼不同')
    return pw


def _find(db, username: str) -> User:
    u = db.query(User).filter(User.username_key == username.lower()).one_or_none()
    if u is None:
        raise SystemExit(f'找不到使用者 {username}')
    return u


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog='python -m app.cli')
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name in ('create-admin', 'set-password', 'promote', 'demote'):
        p = sub.add_parser(name)
        p.add_argument('username')
        if name in ('create-admin', 'set-password'):
            p.add_argument('--password', help='不指定時互動輸入')
    args = ap.parse_args(argv)
    run_migrations()
    try:
        with new_session() as db:
            if args.cmd == 'create-admin':
                u = create_admin(db, args.username, args.password or _ask_password())
                print(f'已建立管理員 {u.username}' + ('（初始管理員）' if u.is_initial_admin else ''))
            elif args.cmd == 'set-password':
                u = _find(db, args.username)
                pw = validate_password(args.password or _ask_password())
                u.password_hash = hash_password(pw)
                db.query(Token).filter(Token.user_id == u.id).delete()
                db.commit()
                print(f'已重設 {u.username} 的密碼')
            elif args.cmd == 'promote':
                u = _find(db, args.username)
                u.is_admin = True
                u.is_disabled = False
                db.commit()
                print(f'{u.username} 已設為管理員')
            elif args.cmd == 'demote':
                u = _find(db, args.username)
                if u.is_initial_admin:
                    raise SystemExit('初始管理員不可取消管理員身分')
                if db.query(User).filter(User.is_admin.is_(True), User.id != u.id).count() == 0:
                    raise SystemExit('不可取消最後一個管理員')
                u.is_admin = False
                db.commit()
                print(f'{u.username} 已取消管理員身分')
    except APIError as e:
        print(e.message, file=sys.stderr)
        return 1
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
