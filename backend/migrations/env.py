"""Alembic 環境：連線網址優先取自呼叫端（app.maintenance.run_migrations），否則用 DATABASE_URL"""
import sys
from pathlib import Path

from alembic import context

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import config as app_config
from app.db import make_engine
from app.models import Base

target_metadata = Base.metadata


def run() -> None:
    url = context.config.attributes.get('connection_url') or app_config.database_url
    if context.is_offline_mode():
        context.configure(url=url, target_metadata=target_metadata, literal_binds=True, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()
        return
    engine = make_engine(url)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run()
