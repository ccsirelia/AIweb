from fastapi import APIRouter, Depends
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database.models import ImageRecord, UserAccount
from database.session import get_db
from models.schemas import AccountProfileResponse, TokenUsageSummary
from services.auth_service import current_user
from services.token_usage_service import get_token_usage_summary

router = APIRouter(prefix="/api", tags=["account"])


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