import base64
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database.models import ChatAttachment, ChatJob, ChatMessage, ChatRecord, ChatSession, UserAccount, now_utc
from database.session import SessionLocal, get_db
from models.schemas import ChatJobOut, ChatRequest, ChatResponse, ChatSessionDetail, ChatSessionOut
from services.auth_service import current_user
from services.openai_service import OpenAIService, OpenAIServiceError
from services.rate_limit import InMemoryRateLimiter
from services.settings_service import normalize_provider

router = APIRouter(prefix="/api", tags=["chat"])
rate_limiter = InMemoryRateLimiter()

UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads" / "chat"
MAX_FILES = 5
MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_EXTRACTED_TEXT = 200_000
ALLOWED_EXTENSIONS = {
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".html",
    ".css",
    ".xml",
    ".yaml",
    ".yml",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
}
TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".html",
    ".css",
    ".xml",
    ".yaml",
    ".yml",
}


def make_session_title(message: str) -> str:
    title = " ".join(message.strip().split())
    return title[:42] or "New chat"


def safe_filename(filename: str) -> str:
    name = Path(filename or "attachment").name
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", name)[:180] or "attachment"


def extract_text(filename: str, content_type: str, data: bytes) -> str | None:
    ext = Path(filename).suffix.lower()
    if ext not in TEXT_EXTENSIONS and not content_type.startswith("text/"):
        return None
    sample = data[:MAX_EXTRACTED_TEXT]
    for encoding in ("utf-8", "utf-8-sig", "gb18030"):
        try:
            return sample.decode(encoding, errors="strict")
        except UnicodeDecodeError:
            continue
    return sample.decode("utf-8", errors="ignore")


def attachment_payloads(db: Session, message_id: int) -> list[dict[str, str | int | None]]:
    attachments = db.query(ChatAttachment).filter(ChatAttachment.message_id == message_id).order_by(ChatAttachment.created_at).all()
    payloads: list[dict[str, str | int | None]] = []
    for item in attachments:
        payload: dict[str, str | int | None] = {
            "filename": item.filename,
            "content_type": item.content_type,
            "file_path": item.file_path,
            "file_size": item.file_size,
            "text_content": item.text_content,
        }
        if item.content_type.startswith("image/"):
            try:
                image_data = Path(item.file_path).read_bytes()
                payload["data_url"] = f"data:{item.content_type};base64,{base64.b64encode(image_data).decode('ascii')}"
            except OSError:
                payload["data_url"] = None
        payloads.append(payload)
    return payloads


async def parse_chat_job_request(request: Request) -> tuple[str, int | None, str, list[UploadFile]]:
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        message = str(form.get("message") or "").strip()
        raw_session_id = str(form.get("session_id") or "").strip()
        provider = normalize_provider(str(form.get("provider") or "openai"))
        files = [value for key, value in form.multi_items() if key == "files" and isinstance(value, UploadFile)]
        session_id = int(raw_session_id) if raw_session_id.isdigit() else None
        return message, session_id, provider, files

    payload = ChatRequest.model_validate(await request.json())
    return payload.message.strip(), payload.session_id, normalize_provider(payload.provider), []


async def save_attachments(
    files: list[UploadFile],
    db: Session,
    user_id: int,
    session_id: int,
    message_id: int,
) -> list[str]:
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Upload at most {MAX_FILES} files at once.")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    names: list[str] = []
    for upload in files:
        filename = safe_filename(upload.filename or "attachment")
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Unsupported attachment type: {filename}")

        data = await upload.read()
        if len(data) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"Attachment exceeds 20MB: {filename}")

        stored_name = f"{user_id}_{message_id}_{uuid.uuid4().hex}_{filename}"
        stored_path = UPLOAD_DIR / stored_name
        stored_path.write_bytes(data)
        content_type = upload.content_type or "application/octet-stream"
        db.add(
            ChatAttachment(
                user_id=user_id,
                session_id=session_id,
                message_id=message_id,
                filename=filename,
                content_type=content_type,
                file_path=str(stored_path),
                file_size=len(data),
                text_content=extract_text(filename, content_type, data),
            )
        )
        names.append(filename)
    return names


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
            job.error = "Chat message not found."
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

        service = OpenAIService(provider=job.provider)
        text = service.chat(user_message.content, history=history, attachments=attachment_payloads(db, user_message.id))
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
        raise HTTPException(status_code=404, detail="Chat session not found.")
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at).all()
    return ChatSessionDetail(session=session, messages=messages)


@router.delete("/chat/sessions/{session_id}")
def delete_chat_session(
    session_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> dict[str, str]:
    session = db.get(ChatSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Chat session not found.")

    attachments = db.query(ChatAttachment).filter(ChatAttachment.session_id == session_id, ChatAttachment.user_id == user.id).all()
    for attachment in attachments:
        try:
            Path(attachment.file_path).unlink(missing_ok=True)
        except OSError:
            pass

    db.query(ChatAttachment).filter(ChatAttachment.session_id == session_id, ChatAttachment.user_id == user.id).delete(synchronize_session=False)
    db.query(ChatJob).filter(ChatJob.session_id == session_id, ChatJob.user_id == user.id).delete(synchronize_session=False)
    db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete(synchronize_session=False)
    db.delete(session)
    db.commit()
    return {"status": "ok"}


@router.get("/chat/jobs/{job_id}", response_model=ChatJobOut)
def chat_job(job_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> ChatJobOut:
    job = db.get(ChatJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Chat job not found.")
    return job


@router.post("/chat/jobs", response_model=ChatJobOut, dependencies=[Depends(rate_limiter)])
async def create_chat_job(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ChatJobOut:
    user_message, session_id, provider, files = await parse_chat_job_request(request)
    if not user_message:
        raise HTTPException(status_code=422, detail="Please enter a message.")
    if len(user_message) > 4000:
        raise HTTPException(status_code=422, detail="Input cannot exceed 4000 characters.")

    session = db.get(ChatSession, session_id) if session_id else None
    if session is not None and session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    if session is None:
        session = ChatSession(title=make_session_title(user_message), user_id=user.id)
        db.add(session)
        db.flush()

    message = ChatMessage(session_id=session.id, role="user", content=user_message)
    db.add(message)
    session.updated_at = now_utc()
    db.flush()

    attachment_names = await save_attachments(files, db, user.id, session.id, message.id)
    if attachment_names:
        message.content = f"{user_message}\n\nAttachments: {', '.join(attachment_names)}"

    job = ChatJob(user_id=user.id, session_id=session.id, user_message_id=message.id, provider=provider, status="pending")
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
        raise HTTPException(status_code=404, detail="Chat session not found.")
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
        service = OpenAIService(provider=payload.provider)
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
