from fastapi import APIRouter, Depends
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database.models import ChatRecord, ImageRecord
from database.session import get_db
from models.schemas import HistoryResponse

router = APIRouter(prefix="/api", tags=["history"])


@router.get("/history", response_model=HistoryResponse)
def history(db: Session = Depends(get_db)) -> HistoryResponse:
    chats = db.query(ChatRecord).order_by(desc(ChatRecord.created_at)).limit(50).all()
    images = db.query(ImageRecord).order_by(desc(ImageRecord.created_at)).limit(50).all()
    return HistoryResponse(chats=chats, images=images)
