from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database.models import ChatJob, ChatMessage, ChatRecord, ChatSession, UserAccount, now_utc
from database.session import SessionLocal, get_db
from models.schemas import ChatJobOut, ChatRequest, ChatResponse, ChatSessionDetail, ChatSessionOut
from services.auth_service import current_user
from services.openai_service import OpenAIService, OpenAIServiceError
from services.rate_limit import InMemoryRateLimiter
router = APIRouter(prefix="/api", tags=["chat"])
rate_limiter = InMemoryRateLimiter()


def make_session_title(message: str) -> str:
    title = " ".join(message.strip().split())
    return title[:42] or "新的对话"


def run_chat_job(job_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.get(ChatJob, job_id)
        if job is None:
            return
        job.status = "running"
        db.commit()

        user_message = db.get(ChatMessage, job.user_message_id)
        session = db.get(ChatSession, job.session_id)
        if user_message is None or session is None:
            job.status = "failed"
            job.error = "会话消息不存在。"
            job.completed_at = now_utc()
            db.commit()
            return

        previous_messages = (
            db.query(ChatMessage)
            .filter(ChatMessage.session_id == job.session_id, ChatMessage.id < job.user_message_id)
            .order_by(ChatMessage.created_at)
            .limit(20)
            .all()
        )
        history = [{"role": item.role, "content": item.content} for item in previous_messages if item.role in {"user", "assistant"}]

        service = OpenAIService()
        text = service.chat(user_message.content, history=history)
        db.add(ChatMessage(session_id=job.session_id, role="assistant", content=text))
        db.add(ChatRecord(user_id=job.user_id, user_message=user_message.content, ai_response=text))
        session.updated_at = now_utc()
        job.status = "completed"
        job.completed_at = now_utc()
        db.commit()
    except Exception as exc:
        db.rollback()
        job = db.get(ChatJob, job_id)
        if job is not None:
            job.status = "failed"
            job.error = str(exc)
            job.completed_at = now_utc()
            db.commit()
    finally:
        db.close()


@router.get("/chat/sessions", response_model=list[ChatSessionOut])
def chat_sessions(db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> list[ChatSessionOut]:
    return db.query(ChatSession).filter(ChatSession.user_id == user.id).order_by(desc(ChatSession.updated_at)).limit(10).all()


@router.get("/chat/sessions/{session_id}", response_model=ChatSessionDetail)
def chat_session(
    session_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ChatSessionDetail:
    session = db.get(ChatSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="会话不存在")
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at).all()
    return ChatSessionDetail(session=session, messages=messages)


@router.get("/chat/jobs/{job_id}", response_model=ChatJobOut)
def chat_job(job_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> ChatJobOut:
    job = db.get(ChatJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job


@router.post("/chat/jobs", response_model=ChatJobOut, dependencies=[Depends(rate_limiter)])
def create_chat_job(
    payload: ChatRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ChatJobOut:
    user_message = payload.message.strip()
    session = db.get(ChatSession, payload.session_id) if payload.session_id else None
    if session is not None and session.user_id != user.id:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session is None:
        session = ChatSession(title=make_session_title(user_message), user_id=user.id)
        db.add(session)
        db.flush()

    message = ChatMessage(session_id=session.id, role="user", content=user_message)
    db.add(message)
    session.updated_at = now_utc()
    db.flush()

    job = ChatJob(user_id=user.id, session_id=session.id, user_message_id=message.id, status="pending")
    db.add(job)
    db.commit()
    db.refresh(job)
    background_tasks.add_task(run_chat_job, job.id)
    return job


@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(rate_limiter)])
def chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ChatResponse:
    user_message = payload.message.strip()
    session = db.get(ChatSession, payload.session_id) if payload.session_id else None
    if session is not None and session.user_id != user.id:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session is None:
        session = ChatSession(title=make_session_title(user_message), user_id=user.id)
        db.add(session)
        db.flush()

    previous_messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at)
        .limit(20)
        .all()
    )
    history = [{"role": item.role, "content": item.content} for item in previous_messages if item.role in {"user", "assistant"}]

    try:
        service = OpenAIService()
        text = service.chat(user_message, history=history)
        db.add(ChatMessage(session_id=session.id, role="user", content=user_message))
        db.add(ChatMessage(session_id=session.id, role="assistant", content=text))
        db.add(ChatRecord(user_id=user.id, user_message=user_message, ai_response=text))
        session.updated_at = now_utc()
        db.commit()
        return ChatResponse(text=text, session_id=session.id)
    except OpenAIServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
