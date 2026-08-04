from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database.models import ImageRecord, UserAccount
from database.session import get_db
from models.schemas import AccountProfileResponse, AuthResponse, ChangePasswordRequest, TokenUsageSummary
from services.auth_service import create_token, current_user, hash_password, verify_password
from services.rate_limit import InMemoryRateLimiter
from services.token_usage_service import get_token_usage_summary

router = APIRouter(prefix="/api", tags=["account"])
password_rate_limiter = InMemoryRateLimiter(limit=5)


@router.get("/account/profile", response_model=AccountProfileResponse)
def account_profile(
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> AccountProfileResponse:
    recent_images = (
        db.query(ImageRecord)
        .filter(ImageRecord.user_id == user.id)
        .order_by(desc(ImageRecord.created_at))
        .limit(3)
        .all()
    )
    usage = get_token_usage_summary(db, user.id)
    return AccountProfileResponse(
        user=user,
        created_at=user.created_at,
        token_usage=TokenUsageSummary(**usage),
        recent_images=recent_images,
    )


@router.put("/account/password", response_model=AuthResponse, dependencies=[Depends(password_rate_limiter)])
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> AuthResponse:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确。")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=422, detail="新密码不能与当前密码相同。")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    db.refresh(user)
    return AuthResponse(token=create_token(user), user=user)
