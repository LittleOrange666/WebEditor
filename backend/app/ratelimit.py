"""登入與註冊的速率限制（spec_new §3.5）：每個 key 每分鐘最多 N 次，記憶體內的滑動視窗"""
import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from .config import config
from .errors import err


class RateLimiter:
    def __init__(self, limit: int = 10, window_s: float = 60.0):
        self.limit = limit
        self.window = window_s
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, *keys: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in keys:
                q = self._hits[key]
                while q and now - q[0] > self.window:
                    q.popleft()
                if len(q) >= self.limit:
                    raise err(429, 'rate_limited', '嘗試次數過多，請稍後再試')
            for key in keys:
                self._hits[key].append(now)
            if len(self._hits) > 10000:  # 避免無限成長
                for k in [k for k, q in self._hits.items() if not q or now - q[-1] > self.window]:
                    del self._hits[k]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


auth_limiter = RateLimiter()


def client_ip(request: Request) -> str:
    if config.trust_proxy:
        fwd = request.headers.get('x-forwarded-for')
        if fwd:
            return fwd.split(',')[0].strip()
    return request.client.host if request.client else 'unknown'
