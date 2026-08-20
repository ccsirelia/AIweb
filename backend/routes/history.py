from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session, load_only

from database.models import ChatRecord, ChatSession, ImageRecord, UserAccount
from database.session import get_db
from models.schemas import HistoryResponse
from services.auth_service import current_user

router = APIRouter(prefix="/api", tags=["history"])


@router.get("/history", response_model=HistoryResponse)
def history(
    chat_page: int = Query(1, ge=1, le=10000),
    image_page: int = Query(1, ge=1, le=10000),
    page_size: int = Query(12, ge=1, le=50),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> HistoryResponse:
    chat_rows = (
        db.query(ChatRecord)
        .filter(ChatRecord.user_id == user.id)
        .order_by(desc(ChatRecord.created_at))
        .offset((chat_page - 1) * page_size)
        .limit(page_size + 1)
        .all()
    )
    image_rows = (
        db.query(ImageRecord)
        .filter(ImageRecord.user_id == user.id)
        .options(
            load_only(
                ImageRecord.id,
                ImageRecord.prompt,
                ImageRecord.style,
                ImageRecord.size,
                ImageRecord.mode,
                ImageRecord.reference_count,
                ImageRecord.created_at,
            )
        )
        .order_by(desc(ImageRecord.created_at))
        .offset((image_page - 1) * page_size)
        .limit(page_size + 1)
        .all()
    )
    return HistoryResponse(
        chats=chat_rows[:page_size],
        images=image_rows[:page_size],
        chat_page=chat_page,
        image_page=image_page,
        page_size=page_size,
        chat_has_more=len(chat_rows) > page_size,
        image_has_more=len(image_rows) > page_size,
    )
