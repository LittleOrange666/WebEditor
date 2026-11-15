"""WebEditor 雲端版後端（spec_new §7）"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from . import errors
from .config import config
from .db import init_engine, new_session
from .errors import error_response
from .maintenance import bootstrap_admin, cleanup_loop, run_migrations
from .routers import admin, auth, me, shares, sync
from .site import cached_request_limit, load as load_site

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')

WRITE_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}


class GuardMiddleware:
    """所有回應加上 CORP；寫入請求只接受 JSON，並限制本文大小（spec_new §3.5、§4.5）"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)

        async def send_with_corp(message):
            if message['type'] == 'http.response.start':
                headers = list(message.get('headers', []))
                headers.append((b'cross-origin-resource-policy', b'cross-origin'))
                message = {**message, 'headers': headers}
            await send(message)

        method = scope['method']
        headers = {k.decode().lower(): v.decode() for k, v in scope.get('headers', [])}
        limit = cached_request_limit()
        if method in WRITE_METHODS:
            length = headers.get('content-length')
            if length is not None and length.isdigit() and int(length) > limit:
                return await error_response(413, 'too_large', '請求內容過大')(scope, receive, send_with_corp)
            has_body = (length not in (None, '0')) or 'transfer-encoding' in headers
            if has_body and not headers.get('content-type', '').lower().startswith('application/json'):
                return await error_response(415, 'unsupported_media_type', '只接受 application/json')(
                    scope, receive, send_with_corp)

            received = 0

            async def limited_receive():
                nonlocal received
                message = await receive()
                if message['type'] == 'http.request':
                    received += len(message.get('body', b''))
                    if received > limit:
                        raise _TooLarge()
                return message

            try:
                return await self.app(scope, limited_receive, send_with_corp)
            except _TooLarge:
                return await error_response(413, 'too_large', '請求內容過大')(scope, receive, send_with_corp)
        return await self.app(scope, receive, send_with_corp)


class _TooLarge(Exception):
    pass


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_engine()
    if config.run_migrations:
        await asyncio.to_thread(run_migrations)
    bootstrap_admin()
    with new_session() as db:
        load_site(db)  # 預先載入站台設定（請求大小限制要用）
    task = asyncio.create_task(cleanup_loop())
    try:
        yield
    finally:
        task.cancel()


def create_app(use_lifespan: bool = True) -> FastAPI:
    app = FastAPI(title='WebEditor API', lifespan=lifespan if use_lifespan else None,
                  docs_url=None, redoc_url=None, openapi_url=None)
    errors.install(app)
    api = APIRouter(prefix='/api/v1')
    for r in (auth.router, me.router, sync.router, shares.router, admin.router):
        api.include_router(r)
    app.include_router(api)

    @app.get('/health')
    def health():
        return {'ok': True}

    app.add_middleware(GuardMiddleware)
    # CORS 放最外層，讓錯誤回應也帶 CORS 標頭
    app.add_middleware(CORSMiddleware, allow_origins=config.allowed_origins, allow_credentials=False,
                       allow_methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
                       allow_headers=['Authorization', 'Content-Type'], max_age=600)
    return app


app = create_app()
