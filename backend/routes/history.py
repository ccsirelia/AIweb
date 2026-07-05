from fastapi import APIRouter, Depends
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database.models import ChatRecord, ChatSession, ImageRecord, UserAccount
from database.session import get_db
from models.schemas import HistoryResponse
from services.auth_service import current_user

router = APIRouter(prefix="/api", tags=["history"])


@router.get("/history", response_model=HistoryResponse)
def history(db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> HistoryResponse:
    chats = db.query(ChatRecord).filter(ChatRecord.user_id == user.id).order_by(desc(ChatRecord.created_at)).limit(50).all()
    images = db.query(ImageRecord).filter(ImageRecord.user_id == user.id).order_by(desc(ImageRecord.created_at)).limit(50).all()
    return HistoryResponse(chats=chats, images=images)
