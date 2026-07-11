"""Execute chat jobs claimed by the in-process worker."""

from __future__ import annotations

import base64
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from database.models import ChatAttachment, ChatJob, ChatMessage, ChatRecord, ChatSession, now_utc
from database.session import SessionLocal
from services.openai_service import OpenAIService, OpenAIServiceError
from services.token_usage_service import record_token_usage

logger = logging.getLogger(__name__)

GENERIC_CHAT_ERROR = "AI 回复失败，请稍后重试。"


def attachment_payloads(db: Session, message_id: int) -> list[dict[str, str | int | None]]:
    attachments = (
        db.query(ChatAttachment)
        .filter(ChatAttachment.message_id == message_id)
        .order_by(ChatAttachment.created_at)
        .all()
    )
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


def public_chat_error(exc: Exception) -> str:
    if isinstance(exc, OpenAIServiceError):
        message = str(exc).strip()
        if message:
            # Keep short provider messages; strip overly long dumps.
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

        previous_messages = (
            db.query(ChatMessage)
            .filter(ChatMessage.session_id == job.session_id, ChatMessage.id < job.user_message_id)
            .order_by(ChatMessage.created_at)
            .limit(20)
            .all()
        )
        history = [
            {"role": item.role, "content": item.content}
            for item in previous_messages
            if item.role in {"user", "assistant"}
        ]

        service = OpenAIService(provider=job.provider)
        result = service.chat(
            user_message.content,
            history=history,
            attachments=attachment_payloads(db, user_message.id),
        )
        text = str(result["text"])
        db.add(ChatMessage(session_id=job.session_id, role="assistant", content=text))
        db.add(ChatRecord(user_id=job.user_id, user_message=user_message.content, ai_response=text))
        record_token_usage(
            db,
            user_id=job.user_id,
            source="chat",
            provider=job.provider,
            model=str(result.get("model") or service.text_model),
            prompt_tokens=int(result.get("prompt_tokens") or 0),
            completion_tokens=int(result.get("completion_tokens") or 0),
            total_tokens=int(result.get("total_tokens") or 0),
        )
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
