from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database.models import UserAccount
from database.session import get_db
from models.schemas import AuthResponse, LoginRequest, RegisterRequest, UserOut
from services.auth_service import create_token, current_user, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def normalize_username(username: str) -> str:
    return username.strip().lower()


@router.post("/register", response_model=AuthResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> AuthResponse:
    username = normalize_username(payload.username)
    email = payload.email.strip().lower()
    existing = db.query(UserAccount).filter(or_(UserAccount.username == username, UserAccount.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="用户名或邮箱已存在。")

    user = UserAccount(
        username=username,
        name=payload.name.strip() or username,
        email=email,
        password_hash=hash_password(payload.password),
        role="member",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return AuthResponse(token=create_token(user), user=user)


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    account = payload.account.strip().lower()
    user = db.query(UserAccount).filter(or_(UserAccount.username == account, UserAccount.email == account)).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误。")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已被禁用。")
    return AuthResponse(token=create_token(user), user=user)


@router.get("/me", response_model=UserOut)
def me(user: UserAccount = Depends(current_user)) -> UserOut:
    return user
