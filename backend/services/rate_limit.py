import os
import time
from collections import defaultdict, deque
from typing import Deque

from fastapi import HTTPException, Request


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self.limit = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))
        self.window_seconds = 60
        self._hits: dict[str, Deque[float]] = defaultdict(deque)

    async def __call__(self, request: Request) -> None:
        client = request.client.host if request.client else "anonymous"
        now = time.time()
        bucket = self._hits[client]
        while bucket and now - bucket[0] > self.window_seconds:
            bucket.popleft()
        if len(bucket) >= self.limit:
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试。")
        bucket.append(now)
