"""Admin console session auth and CSRF helpers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Optional

from fastapi import Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from database.models import UserAccount
from services.auth_service import AUTH_SECRET_KEY

ADMIN_SESSION_COOKIE = "aiweb_admin_session"
ADMIN_CSRF_COOKIE = "aiweb_admin_csrf"
ADMIN_COOKIE_PATH = "/admin"
ADMIN_SESSION_TTL_SECONDS = int(os.getenv("ADMIN_SESSION_TTL_SECONDS", str(60 * 60 * 8)))
ADMIN_COOKIE_SECURE = os.getenv("ADMIN_COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes"}
ADMIN_COOKIE_SAMESITE = "lax"


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _b64decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("utf-8"))


def create_admin_session_token(user: UserAccount) -> str:
    payload = {
        "sub": user.id,
        "username": user.username,
        "typ": "admin_session",
        "exp": int(time.time()) + ADMIN_SESSION_TTL_SECONDS,
    }
    payload_raw = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(
        AUTH_SECRET_KEY.encode("utf-8"),
        payload_raw.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{payload_raw}.{_b64encode(signature)}"


def decode_admin_session_token(token: str) -> dict[str, object]:
    payload_raw, signature_raw = token.split(".", 1)
    expected = hmac.new(
        AUTH_SECRET_KEY.encode("utf-8"),
        payload_raw.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(_b64decode(signature_raw), expected):
        raise ValueError("bad admin session signature")
    payload = json.loads(_b64decode(payload_raw))
    if payload.get("typ") != "admin_session":
        raise ValueError("invalid admin session type")
    if int(payload.get("exp", 0)) < int(time.time()):
        raise ValueError("admin session expired")
    return payload


def issue_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def get_admin_user(request: Request, db: Session) -> Optional[UserAccount]:
    token = request.cookies.get(ADMIN_SESSION_COOKIE)
    if not token:
        return None
    try:
        payload = decode_admin_session_token(token)
        user = db.get(UserAccount, int(payload["sub"]))
    except Exception:
        return None
    if user is None or not user.is_active or user.role != "admin":
        return None
    return user


def count_admins(db: Session) -> int:
    return (
        db.query(UserAccount)
        .filter(UserAccount.role == "admin", UserAccount.is_active.is_(True))
        .count()
    )


def validate_csrf(request: Request, form_csrf: str) -> bool:
    cookie_csrf = request.cookies.get(ADMIN_CSRF_COOKIE, "")
    submitted = (form_csrf or "").strip()
    if not cookie_csrf or not submitted:
        return False
    return hmac.compare_digest(cookie_csrf, submitted)


def set_admin_cookies(response: Response, session_token: str, csrf_token: str) -> None:
    common = {
        "httponly": True,
        "secure": ADMIN_COOKIE_SECURE,
        "samesite": ADMIN_COOKIE_SAMESITE,
        "max_age": ADMIN_SESSION_TTL_SECONDS,
        "path": ADMIN_COOKIE_PATH,
    }
    response.set_cookie(ADMIN_SESSION_COOKIE, session_token, **common)
    response.set_cookie(ADMIN_CSRF_COOKIE, csrf_token, **common)


def set_csrf_cookie(response: Response, csrf_token: str) -> None:
    response.set_cookie(
        ADMIN_CSRF_COOKIE,
        csrf_token,
        httponly=True,
        secure=ADMIN_COOKIE_SECURE,
        samesite=ADMIN_COOKIE_SAMESITE,
        max_age=ADMIN_SESSION_TTL_SECONDS,
        path=ADMIN_COOKIE_PATH,
    )


def clear_admin_cookies(response: Response) -> None:
    response.delete_cookie(ADMIN_SESSION_COOKIE, path=ADMIN_COOKIE_PATH)
    response.delete_cookie(ADMIN_CSRF_COOKIE, path=ADMIN_COOKIE_PATH)


def ensure_csrf_token(request: Request) -> str:
    existing = request.cookies.get(ADMIN_CSRF_COOKIE, "").strip()
    if existing:
        return existing
    return issue_csrf_token()