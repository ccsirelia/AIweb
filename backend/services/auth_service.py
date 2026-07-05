import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database.models import UserAccount
from database.session import get_db

AUTH_SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "aiweb-dev-secret-change-me")
TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_SECONDS", str(60 * 60 * 24 * 7)))


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, salt, expected = stored_hash.split("$", 2)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()
    return hmac.compare_digest(digest, expected)


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _b64decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("utf-8"))


def create_token(user: UserAccount) -> str:
    payload = {"sub": user.id, "username": user.username, "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    payload_raw = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(AUTH_SECRET_KEY.encode("utf-8"), payload_raw.encode("utf-8"), hashlib.sha256).digest()
    return f"{payload_raw}.{_b64encode(signature)}"


def decode_token(token: str) -> dict[str, object]:
    try:
        payload_raw, signature_raw = token.split(".", 1)
        expected = hmac.new(AUTH_SECRET_KEY.encode("utf-8"), payload_raw.encode("utf-8"), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64decode(signature_raw), expected):
            raise ValueError("bad signature")
        payload = json.loads(_b64decode(payload_raw))
        if int(payload.get("exp", 0)) < int(time.time()):
            raise ValueError("expired token")
        return payload
    except Exception as exc:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录。") from exc


def current_user(request: Request, db: Session = Depends(get_db)) -> UserAccount:
    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="请先登录。")
    payload = decode_token(token)
    user = db.get(UserAccount, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="账号不存在或已被禁用。")
    return user
