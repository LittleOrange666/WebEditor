"""統一錯誤格式：{ "error": { "code", "message" } }（spec_new §7.3）"""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


def err(status: int, code: str, message: str) -> APIError:
    return APIError(status, code, message)


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({'error': {'code': code, 'message': message}}, status_code=status)


_HTTP_MESSAGES = {
    404: ('not_found', '找不到資源'),
    405: ('method_not_allowed', '不支援的請求方法'),
}


def install(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def _api(_: Request, e: APIError):
        return error_response(e.status, e.code, e.message)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError):
        first = e.errors()[0] if e.errors() else {}
        loc = '.'.join(str(x) for x in first.get('loc', [])[1:])
        return error_response(422, 'invalid', f'請求格式錯誤{f"（{loc}）" if loc else ""}')

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        code, msg = _HTTP_MESSAGES.get(e.status_code, ('error', str(e.detail)))
        return error_response(e.status_code, code, msg)
