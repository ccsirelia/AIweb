from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database.models import ChatRecord
from database.session import get_db
from models.schemas import ChatRequest, ChatResponse
from services.openai_service import OpenAIService, OpenAIServiceError
from services.rate_limit import InMemoryRateLimiter

router = APIRouter(prefix="/api", tags=["chat"])
rate_limiter = InMemoryRateLimiter()


@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(rate_limiter)])
def chat(payload: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
    try:
        service = OpenAIService()
        text = service.chat(payload.message.strip())
        db.add(ChatRecord(user_message=payload.message.strip(), ai_response=text))
        db.commit()
        return ChatResponse(text=text)
    except OpenAIServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
