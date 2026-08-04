import os
import threading
import time
from collections import defaultdict, deque
from typing import Deque

from fastapi import HTTPException, Request

from services.auth_service import decode_token


class InMemoryRateLimiter:
    def __init__(
        self,
        *,
        limit: int | None = None,
        window_seconds: int = 60,
        key_by_user: bool = True,
    ) -> None:
        self.limit = max(1, limit if limit is not None else int(os.getenv("RATE_LIMIT_PER_MINUTE", "30")))
        self.window_seconds = max(1, window_seconds)
        self.key_by_user = key_by_user
        self._hits: dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_cleanup = time.monotonic()

    def _client_key(self, request: Request) -> str:
        client = request.client.host if request.client else "anonymous"
        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if self.key_by_user and scheme.lower() == "bearer" and token:
            try:
                subject = int(decode_token(token).get("sub", 0))
                if subject > 0:
                    return f"{client}:user:{subject}"
            except (HTTPException, TypeError, ValueError):
                pass
        return f"{client}:anonymous"

    async def __call__(self, request: Request) -> None:
        client = self._client_key(request)
        now = time.monotonic()
        with self._lock:
            if now - self._last_cleanup > 300:
                stale_keys = [key for key, hits in self._hits.items() if not hits or now - hits[-1] > self.window_seconds]
                for key in stale_keys:
                    self._hits.pop(key, None)
                self._last_cleanup = now

            bucket = self._hits[client]
            while bucket and now - bucket[0] > self.window_seconds:
                bucket.popleft()
            if len(bucket) >= self.limit:
                raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试。")
            bucket.append(now)
