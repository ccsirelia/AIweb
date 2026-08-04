import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from services import auth_service


class PasswordHashTests(unittest.TestCase):
    def test_password_round_trip_and_unique_salts(self) -> None:
        first = auth_service.hash_password("correct horse battery staple")
        second = auth_service.hash_password("correct horse battery staple")

        self.assertNotEqual(first, second)
        self.assertTrue(auth_service.verify_password("correct horse battery staple", first))
        self.assertFalse(auth_service.verify_password("incorrect", first))

    def test_malformed_or_unknown_hash_is_rejected(self) -> None:
        self.assertFalse(auth_service.verify_password("secret", "malformed"))
        self.assertFalse(auth_service.verify_password("secret", "bcrypt$salt$digest"))


class AuthTokenTests(unittest.TestCase):
    def setUp(self) -> None:
        self.user = SimpleNamespace(
            id=42,
            username="test-user",
            password_hash=auth_service.hash_password("initial password"),
            is_active=True,
        )

    def test_token_round_trip(self) -> None:
        token = auth_service.create_token(self.user)
        payload = auth_service.decode_token(token)

        self.assertEqual(payload["sub"], 42)
        self.assertEqual(payload["username"], "test-user")
        self.assertGreater(int(payload["exp"]), int(time.time()))

    def test_tampered_token_is_rejected(self) -> None:
        token = auth_service.create_token(self.user)
        payload, signature = token.split(".", 1)
        replacement = "A" if payload[-1] != "A" else "B"

        with self.assertRaises(HTTPException) as raised:
            auth_service.decode_token(f"{payload[:-1]}{replacement}.{signature}")

        self.assertEqual(raised.exception.status_code, 401)

    def test_expired_token_is_rejected(self) -> None:
        with patch.object(auth_service, "TOKEN_TTL_SECONDS", -1):
            token = auth_service.create_token(self.user)

        with self.assertRaises(HTTPException) as raised:
            auth_service.decode_token(token)

        self.assertEqual(raised.exception.status_code, 401)

    def test_new_token_is_invalid_after_password_change(self) -> None:
        token = auth_service.create_token(self.user)
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/api/auth/me",
                "headers": [(b"authorization", f"Bearer {token}".encode("ascii"))],
                "client": ("127.0.0.1", 12345),
                "server": ("testserver", 80),
                "scheme": "http",
                "query_string": b"",
            }
        )
        db = SimpleNamespace(get=lambda _model, _user_id: self.user)

        self.assertIs(auth_service.current_user(request, db), self.user)
        self.user.password_hash = auth_service.hash_password("changed password")

        with self.assertRaises(HTTPException) as raised:
            auth_service.current_user(request, db)

        self.assertEqual(raised.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
