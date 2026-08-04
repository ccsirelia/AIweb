import asyncio
import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from starlette.requests import Request

from services.auth_service import create_token, hash_password
from services.rate_limit import InMemoryRateLimiter


def make_request(authorization: str = "") -> Request:
    headers = []
    if authorization:
        headers.append((b"authorization", authorization.encode("ascii")))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/chat/stream",
            "headers": headers,
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "scheme": "http",
            "query_string": b"",
        }
    )


class RateLimiterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.user = SimpleNamespace(
            id=7,
            username="rate-user",
            password_hash=hash_password("rate limit password"),
        )

    def test_bearer_scheme_variants_share_one_user_bucket(self) -> None:
        limiter = InMemoryRateLimiter(limit=2)
        token = create_token(self.user)

        asyncio.run(limiter(make_request(f"Bearer {token}")))
        asyncio.run(limiter(make_request(f"bEaReR {token}")))

        with self.assertRaises(HTTPException) as raised:
            asyncio.run(limiter(make_request(f"BEARER {token}")))

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(len(limiter._hits), 1)

    def test_invalid_headers_share_the_anonymous_bucket(self) -> None:
        limiter = InMemoryRateLimiter(limit=2)

        asyncio.run(limiter(make_request("Bearer invalid-one")))
        asyncio.run(limiter(make_request("Bearer invalid-two")))

        with self.assertRaises(HTTPException):
            asyncio.run(limiter(make_request("Bearer invalid-three")))

        self.assertEqual(len(limiter._hits), 1)

    def test_ip_only_mode_ignores_valid_bearer_subjects(self) -> None:
        limiter = InMemoryRateLimiter(limit=2, key_by_user=False)
        other_user = SimpleNamespace(
            id=8,
            username="other-rate-user",
            password_hash=hash_password("other rate limit password"),
        )

        asyncio.run(limiter(make_request(f"Bearer {create_token(self.user)}")))
        asyncio.run(limiter(make_request(f"Bearer {create_token(other_user)}")))

        with self.assertRaises(HTTPException):
            asyncio.run(limiter(make_request()))

        self.assertEqual(len(limiter._hits), 1)

    def test_concurrent_requests_never_exceed_limit(self) -> None:
        limiter = InMemoryRateLimiter(limit=30)

        async def attempt() -> bool:
            try:
                await limiter(make_request())
                return True
            except HTTPException:
                return False

        async def run_requests() -> list[bool]:
            return await asyncio.gather(*(attempt() for _ in range(100)))

        results = asyncio.run(run_requests())
        self.assertEqual(sum(results), 30)


if __name__ == "__main__":
    unittest.main()
