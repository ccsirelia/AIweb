"""Execute chat jobs claimed by the in-process worker."""

from __future__ import annotations

import base64
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from database.models import ChatAttachment, ChatJob, ChatMessage, ChatRecord, ChatSession, now_utc
from database.session import SessionLocal
from services.chat_context_service import load_recent_chat_history
from services.chat_model_service import resolve_chat_model
from services.document_extract import extract_document_text
from services.openai_service import IMAGE_EXTENSIONS, IMAGE_MIME, OpenAIService, OpenAIServiceError
from services.settings_service import normalize_provider
from services.token_usage_service import record_token_usage

logger = logging.getLogger(__name__)

GENERIC_CHAT_ERROR = "AI 回复失败，请稍后重试。"


def _guess_image_mime(filename: str, content_type: str) -> str | None:
    content_type = (content_type or "").lower().strip()
    if content_type.startswith("image/"):
        return content_type
    ext = Path(filename or "").suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        return IMAGE_MIME.get(ext, "image/png")
    return None


def attachment_payloads(db: Session, message_id: int) -> list[dict[str, str | int | None]]:
    attachments = (
        db.query(ChatAttachment)
        .filter(ChatAttachment.message_id == message_id)
        .order_by(ChatAttachment.created_at)
        .all()
    )
    payloads: list[dict[str, str | int | None]] = []
    for item in attachments:
        mime = _guess_image_mime(item.filename, item.content_type) or item.content_type or "application/octet-stream"
        text_content = item.text_content
        # Backfill text extraction for office docs uploaded before extractors existed,
        # or when save-time extraction failed.
        if (not text_content or not str(text_content).strip()) and not mime.startswith("image/"):
            try:
                raw = Path(item.file_path).read_bytes()
                extracted = extract_document_text(item.filename, item.content_type, raw)
                if extracted:
                    text_content = extracted
                    item.text_content = extracted
                    logger.info(
                        "Backfilled text extraction for attachment %s (%s chars)",
                        item.filename,
                        len(extracted),
                    )
            except OSError as exc:
                logger.warning("Failed to read attachment for text extract %s: %s", item.file_path, exc)

        payload: dict[str, str | int | None] = {
            "filename": item.filename,
            "content_type": mime,
            "file_path": item.file_path,
            "file_size": item.file_size,
            "text_content": text_content,
        }
        if mime.startswith("image/"):
            try:
                image_data = Path(item.file_path).read_bytes()
                if image_data:
                    payload["data_url"] = f"data:{mime};base64,{base64.b64encode(image_data).decode('ascii')}"
            except OSError as exc:
                logger.warning("Failed to read attachment image %s: %s", item.file_path, exc)
                payload["data_url"] = None
        payloads.append(payload)
    return payloads


def public_chat_error(exc: Exception) -> str:
    if isinstance(exc, OpenAIServiceError):
        message = str(exc).strip()
        if message:
            return message[:300]
        return GENERIC_CHAT_ERROR
    return GENERIC_CHAT_ERROR


def run_chat_job(job_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.get(ChatJob, job_id)
        if job is None:
            return
        if job.status not in {"pending", "running"}:
            return

        user_message = db.get(ChatMessage, job.user_message_id)
        session = db.get(ChatSession, job.session_id)
        if user_message is None or session is None:
            job.status = "failed"
            job.error = "聊天消息不存在。"
            job.completed_at = now_utc()
            db.commit()
            return

        history = load_recent_chat_history(
            db,
            job.session_id,
            before_message_id=job.user_message_id,
        )

        # Prefer the raw user text without the "Attachments: ..." suffix when
        # real attachment payloads are available for the model.
        raw_content = user_message.content or ""
        user_text = raw_content
        marker = "\n\nAttachments:"
        if marker in raw_content:
            user_text = raw_content.split(marker, 1)[0].strip() or "请分析这些附件。"

        attachments = attachment_payloads(db, user_message.id)
        if not attachments and marker in raw_content:
            logger.warning(
                "Chat job %s mentions attachments in message text but no attachment rows for message_id=%s",
                job_id,
                user_message.id,
            )
        else:
            logger.info(
                "Chat job %s attachments=%s images=%s",
                job_id,
                len(attachments),
                sum(1 for item in attachments if isinstance(item.get("data_url"), str)),
            )
        provider = normalize_provider(job.provider)
        selected_model = (job.model or "").strip() or resolve_chat_model(db, provider)
        service = OpenAIService(provider=provider, text_model=selected_model)
        result = service.chat(user_text, history=history, attachments=attachments or None)
        text = str(result["text"]).strip()
        if not text:
            raise OpenAIServiceError("模型返回了空回复")

        db.add(ChatMessage(session_id=job.session_id, role="assistant", content=text))
        db.add(ChatRecord(user_id=job.user_id, user_message=user_message.content, ai_response=text))
        record_token_usage(
            db,
            user_id=job.user_id,
            source="chat",
            provider=provider,
            model=str(result.get("model") or service.text_model),
            prompt_tokens=int(result.get("prompt_tokens") or 0),
            completion_tokens=int(result.get("completion_tokens") or 0),
            total_tokens=int(result.get("total_tokens") or 0),
        )
        job.provider = provider
        job.model = selected_model
        session.updated_at = now_utc()
        job.status = "completed"
        job.error = ""
        job.completed_at = now_utc()
        db.commit()
    except Exception as exc:
        logger.exception("Chat job %s failed", job_id)
        db.rollback()
        job = db.get(ChatJob, job_id)
        if job is not None and job.status not in {"completed", "failed"}:
            job.status = "failed"
            job.error = public_chat_error(exc)
            job.completed_at = now_utc()
            db.commit()
    finally:
        db.close()
