"""資料庫連線"""
from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import config

_engine: Engine | None = None
_Session: sessionmaker | None = None


def make_engine(url: str) -> Engine:
    if url.startswith('sqlite'):
        eng = create_engine(url, connect_args={'check_same_thread': False, 'timeout': 30})

        @event.listens_for(eng, 'connect')
        def _pragma(conn, _):
            cur = conn.cursor()
            cur.execute('PRAGMA journal_mode=WAL')
            cur.execute('PRAGMA foreign_keys=ON')
            cur.execute('PRAGMA busy_timeout=30000')
            cur.close()

        return eng
    return create_engine(url, pool_pre_ping=True)


def init_engine(url: str | None = None) -> Engine:
    global _engine, _Session
    _engine = make_engine(url or config.database_url)
    _Session = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def engine() -> Engine:
    if _engine is None:
        init_engine()
    return _engine


def new_session() -> Session:
    if _Session is None:
        init_engine()
    return _Session()


def get_db() -> Iterator[Session]:
    s = new_session()
    try:
        yield s
    finally:
        s.close()
