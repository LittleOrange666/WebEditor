import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault('RUN_MIGRATIONS', 'true')

from fastapi.testclient import TestClient  # noqa: E402

from app import site  # noqa: E402
from app.config import config  # noqa: E402
from app.db import init_engine, new_session  # noqa: E402
from app.main import create_app  # noqa: E402
from app.maintenance import create_admin, run_migrations  # noqa: E402
from app.ratelimit import auth_limiter  # noqa: E402

PW = 'password123'


@pytest.fixture()
def client(tmp_path):
    url = f'sqlite:///{(tmp_path / "test.db").as_posix()}'
    init_engine(url)
    run_migrations(url)
    site.reset_cache()
    auth_limiter.reset()
    config.allow_registration = True
    config.allowed_origins = ['http://localhost:5173']
    app = create_app(use_lifespan=False)
    with new_session() as db:
        create_admin(db, 'root', PW)
        site.load(db)
    with TestClient(app) as c:
        yield c


def login(client, username, password=PW):
    r = client.post('/api/v1/auth/login', json={'username': username, 'password': password})
    assert r.status_code == 200, r.text
    return {'Authorization': f'Bearer {r.json()["token"]}'}


def register(client, username, password=PW):
    r = client.post('/api/v1/auth/register', json={'username': username, 'password': password})
    assert r.status_code == 200, r.text
    return {'Authorization': f'Bearer {r.json()["token"]}'}


@pytest.fixture()
def admin(client):
    return login(client, 'root')
