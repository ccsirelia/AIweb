"""Execute image generation jobs claimed by the in-process worker."""

from __future__ import annotations

import logging

from database.models import ImageJob, ImageRecord, now_utc
from database.session import SessionLocal
from models.schemas import ImageRequest
from services.openai_service import OpenAIService, OpenAIServiceError
from services.token_usage_service import record_token_usage

logger = logging.getLogger(__name__)

GENERIC_IMAGE_ERROR = "图片生成失败，请稍后重试。"


def public_image_error(exc: Exception, provider: str) -> str:
    if not isinstance(exc, OpenAIServiceError):
        return GENERIC_IMAGE_ERROR

    message = str(exc).strip()
    if provider == "gork" and "400" in message:
        return "Gork 生图请求被上游拒绝。请确认后台 Gork 生图模型配置正确，并且前端只选择 1k 或 2k。"
    if "size" in message.lower():
        return "当前模型或中转不支持该原生分辨率。请检查后台生图模型配置或更换分辨率。"
    if message:
        return message[:300]
    return GENERIC_IMAGE_ERROR


def run_image_job(job_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.get(ImageJob, job_id)
        if job is None:
            return
        if job.status not in {"pending", "running"}:
            return

        payload = ImageRequest(
            prompt=job.prompt,
            style=job.style,  # type: ignore[arg-type]
            size=job.size if "x" in job.size else "1024x1024",
            aspect_ratio=job.aspect_ratio,  # type: ignore[arg-type]
            quality=job.quality,  # type: ignore[arg-type]
            provider=job.provider,  # type: ignore[arg-type]
        )
        if job.provider == "openai":
            payload.size = job.size
        elif job.provider == "gork":
            # gork size field stores "16:9 1k"; keep request fields from job columns
            parts = job.size.split()
            if len(parts) == 2:
                payload.aspect_ratio = parts[0]  # type: ignore[assignment]
                payload.quality = parts[1]  # type: ignore[assignment]
                payload.size = "1024x1024"

        service = OpenAIService(provider=job.provider)
        result = service.generate_image(payload)
        image_base64 = str(result["image_base64"])

        record = ImageRecord(
            user_id=job.user_id,
            prompt=job.prompt,
            style=job.style,
            size=job.size,
            image_base64=image_base64,
        )
        db.add(record)
        db.flush()

        record_token_usage(
            db,
            user_id=job.user_id,
            source="image",
            provider=job.provider,
            model=str(result.get("model") or service.image_model),
            prompt_tokens=int(result.get("prompt_tokens") or 0),
            completion_tokens=int(result.get("completion_tokens") or 0),
            total_tokens=int(result.get("total_tokens") or 0),
        )

        job.image_record_id = record.id
        job.status = "completed"
        job.error = ""
        job.completed_at = now_utc()
        db.commit()
    except Exception as exc:
        logger.exception("Image job %s failed", job_id)
        db.rollback()
        job = db.get(ImageJob, job_id)
        if job is not None and job.status not in {"completed", "failed"}:
            job.status = "failed"
            job.error = public_image_error(exc, job.provider)
            job.completed_at = now_utc()
            db.commit()
    finally:
        db.close()
