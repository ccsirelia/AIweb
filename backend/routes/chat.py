import logging
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from database.models import ChatAttachment, ChatJob, ChatMessage, ChatRecord, ChatSession, UserAccount, now_utc
from database.session import get_db
from models.schemas import ChatJobOut, ChatModelOut, ChatRequest, ChatResponse, ChatSessionDetail, ChatSessionOut
from services.auth_service import current_user
from services.chat_context_service import load_recent_chat_history
from services.chat_model_service import list_active_chat_models, resolve_chat_model
from services.document_extract import DEFAULT_MAX_CHARS, extract_document_text
from services.openai_service import OpenAIService, OpenAIServiceError
from services.rate_limit import InMemoryRateLimiter
from services.settings_service import normalize_provider
from services.token_usage_service import record_token_usage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])
rate_limiter = InMemoryRateLimiter()

UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads" / "chat"
MAX_FILES = 5
MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_EXTRACTED_TEXT = DEFAULT_MAX_CHARS
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
IMAGE_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
REQUIRE_EXTRACTED_TEXT_EXTENSIONS = {".docx", ".pdf", ".pptx", ".xlsx"}


def make_session_title(message: str) -> str:
    title = " ".join(message.strip().split())
    return title[:42] or "New chat"


def safe_filename(filename: str) -> str:
    name = Path(filename or "attachment").name
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", name)[:180] or "attachment"


def extract_text(filename: str, content_type: str, data: bytes) -> str | None:
    """Extract readable text from plain text and office documents."""
    text = extract_document_text(filename, content_type, data, max_chars=MAX_EXTRACTED_TEXT)
    if text:
        logger.info("Extracted %s chars from %s", len(text), filename)
    else:
        logger.warning("No text extracted from %s (%s)", filename, content_type)
    return text


def _is_upload_file(value: Any) -> bool:
    """Detect uploaded files from multipart forms.

    FastAPI's request.form() yields starlette UploadFile objects. Checking
    against fastapi.UploadFile with isinstance can miss them and drop files.
    """
    if isinstance(value, UploadFile):
        return True
    return bool(getattr(value, "filename", None) is not None and hasattr(value, "read"))


def collect_upload_files(form: Any) -> list[UploadFile]:
    files: list[UploadFile] = []
    for key, value in form.multi_items():
        if key not in {"files", "file", "attachment", "attachments"}:
            continue
        if not _is_upload_file(value):
            continue
        filename = str(getattr(value, "filename", None) or "").strip()
        # Browsers sometimes include an empty file field with no name.
        if not filename:
            continue
        files.append(value)
    return files


async def parse_chat_job_request(request: Request) -> tuple[str, int | None, str, str | None, list[UploadFile]]:
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" in content_type:
        form = await request.form()
        message = str(form.get("message") or "").strip()
        raw_session_id = str(form.get("session_id") or "").strip()
        provider = normalize_provider(str(form.get("provider") or "openai"))
        model = str(form.get("model") or "").strip() or None
        files = collect_upload_files(form)
        session_id = int(raw_session_id) if raw_session_id.isdigit() else None
        logger.info("Parsed multipart chat job: message_len=%s files=%s", len(message), len(files))
        return message, session_id, provider, model, files

    payload = ChatRequest.model_validate(await request.json())
    return payload.message.strip(), payload.session_id, normalize_provider(payload.provider), payload.model, []


async def save_attachments(
    files: list[UploadFile],
    db: Session,
    user_id: int,
    session_id: int,
    message_id: int,
) -> list[str]:
    if not files:
        return []
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Upload at most {MAX_FILES} files at once.")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    names: list[str] = []
    saved_paths: list[Path] = []
    try:
        for upload in files:
            original_name = str(upload.filename or "attachment")
            filename = safe_filename(original_name)
            ext = Path(filename).suffix.lower() or Path(original_name).suffix.lower()
            if ext not in ALLOWED_EXTENSIONS:
                raise HTTPException(status_code=400, detail=f"Unsupported attachment type: {original_name}")

            data = await upload.read()
            if not data:
                # Retry once in case the stream was partially consumed.
                try:
                    await upload.seek(0)
                    data = await upload.read()
                except Exception:
                    data = b""
            if not data:
                raise HTTPException(status_code=400, detail=f"Empty attachment: {original_name}")
            if len(data) > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail=f"Attachment exceeds 20MB: {original_name}")

            content_type = (getattr(upload, "content_type", None) or "").strip() or "application/octet-stream"
            # Some browsers send empty/octet-stream for images; infer from extension.
            if not content_type.startswith("image/"):
                guessed = IMAGE_MIME_BY_EXT.get(ext)
                if guessed:
                    content_type = guessed
            text_content = extract_text(filename, content_type, data)
            if ext in REQUIRE_EXTRACTED_TEXT_EXTENSIONS and not (text_content or "").strip():
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"无法从 {original_name} 提取可读正文。"
                        "请确认文件未加密、未损坏，并且不是仅包含扫描图片的文档。"
                    ),
                )

            stored_name = f"{user_id}_{message_id}_{uuid.uuid4().hex}_{filename}"
            stored_path = UPLOAD_DIR / stored_name
            stored_path.write_bytes(data)
            saved_paths.append(stored_path)
            db.add(
                ChatAttachment(
                    user_id=user_id,
                    session_id=session_id,
                    message_id=message_id,
                    filename=filename if filename != "attachment" or not original_name else safe_filename(original_name) or "attachment",
                    content_type=content_type,
                    file_path=str(stored_path.resolve()),
                    file_size=len(data),
                    text_content=text_content,
                )
            )
            names.append(original_name)
            logger.info(
                "Saved attachment message_id=%s name=%s size=%s type=%s text_chars=%s",
                message_id,
                original_name,
                len(data),
                content_type,
                len(text_content or ""),
            )
    except Exception:
        for stored_path in saved_paths:
            try:
                stored_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Failed to clean up attachment after upload error: %s", stored_path)
        raise
    return names


@router.get("/chat/sessions", response_model=list[ChatSessionOut])
def chat_sessions(db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> list[ChatSessionOut]:
    return db.query(ChatSession).filter(ChatSession.user_id == user.id).order_by(desc(ChatSession.updated_at)).limit(10).all()


@router.get("/chat/models", response_model=list[ChatModelOut])
def chat_models(db: Session = Depends(get_db), _user: UserAccount = Depends(current_user)) -> list[ChatModelOut]:
    return list_active_chat_models(db)


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
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ChatJobOut:
    """Enqueue a chat job for the in-process worker. Does not call the model inline."""
    user_message, session_id, provider, requested_model, files = await parse_chat_job_request(request)
    if not user_message and not files:
        raise HTTPException(status_code=422, detail="Please enter a message or upload an attachment.")
    if not user_message and files:
        user_message = "请分析这些附件。"
    if len(user_message) > 4000:
        raise HTTPException(status_code=422, detail="Input cannot exceed 4000 characters.")
    try:
        selected_model = resolve_chat_model(db, provider, requested_model)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

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
    if files and not attachment_names:
        raise HTTPException(status_code=400, detail="附件上传失败，请重试。")
    if attachment_names:
        message.content = f"{user_message}\n\nAttachments: {', '.join(attachment_names)}"
        # Ensure the attachment rows and updated message are flushed before commit.
        db.flush()

    job = ChatJob(
        user_id=user.id,
        session_id=session.id,
        user_message_id=message.id,
        provider=provider,
        model=selected_model,
        status="pending",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(rate_limiter)])
def chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ChatResponse:
    """Synchronous chat (compatibility). Prefer POST /api/chat/jobs for production UI."""
    user_message = payload.message.strip()
    session = db.get(ChatSession, payload.session_id) if payload.session_id else None
    if session is not None and session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    if session is None:
        session = ChatSession(title=make_session_title(user_message), user_id=user.id)
        db.add(session)
        db.flush()

    history = load_recent_chat_history(db, session.id)
    provider = normalize_provider(payload.provider)
    try:
        selected_model = resolve_chat_model(db, provider, payload.model)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        service = OpenAIService(provider=provider, text_model=selected_model)
        result = service.chat(user_message, history=history)
        text = str(result["text"])
        db.add(ChatMessage(session_id=session.id, role="user", content=user_message))
        db.add(ChatMessage(session_id=session.id, role="assistant", content=text))
        db.add(ChatRecord(user_id=user.id, user_message=user_message, ai_response=text))
        record_token_usage(
            db,
            user_id=user.id,
            source="chat",
            provider=provider,
            model=str(result.get("model") or service.text_model),
            prompt_tokens=int(result.get("prompt_tokens") or 0),
            completion_tokens=int(result.get("completion_tokens") or 0),
            total_tokens=int(result.get("total_tokens") or 0),
        )
        session.updated_at = now_utc()
        db.commit()
        return ChatResponse(text=text, session_id=session.id)
    except OpenAIServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
