import re
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from PIL import Image, UnidentifiedImageError
from sqlalchemy import desc, func
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from database.models import ImageJob, ImageJobReference, ImageRecord, UserAccount
from database.session import get_db
from models.schemas import ImageJobOut, ImageRecordOut, ImageRequest, ImageResponse
from services.auth_service import current_user
from services.image_job_service import public_image_error
from services.openai_service import OpenAIService, OpenAIServiceError
from services.rate_limit import InMemoryRateLimiter
from services.settings_service import normalize_provider
from services.token_usage_service import record_token_usage

router = APIRouter(prefix="/api", tags=["image"])
rate_limiter = InMemoryRateLimiter()
REFERENCE_UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads" / "image-references"
MAX_REFERENCE_IMAGES = 6
MAX_REFERENCE_IMAGE_SIZE = 10 * 1024 * 1024
MAX_REFERENCE_PIXELS = 40_000_000
ALLOWED_REFERENCE_FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}

PRESET_SIZES = {
    "16:9": {"1k": "1920x1024", "2k": "2560x1440", "4k": "3840x2160"},
    "1:1": {"1k": "1024x1024", "2k": "2560x2560", "4k": "3840x3840"},
    "9:16": {"1k": "1024x1920", "2k": "1440x2560", "4k": "2160x3840"},
}
GROK_ASPECT_RATIOS = {"16:9", "1:1", "9:16"}
GROK_RESOLUTIONS = {"1k", "2k"}


def validate_image2_size(size: str) -> str:
    match = re.fullmatch(r"(\d{2,5})x(\d{2,5})", size.strip().lower())
    if not match:
        raise HTTPException(status_code=422, detail="分辨率格式必须是 WIDTHxHEIGHT，例如 1920x1024。")

    width = int(match.group(1))
    height = int(match.group(2))
    if width < 512 or height < 512:
        raise HTTPException(status_code=422, detail="分辨率宽高不能小于 512。")
    if width > 3840 or height > 3840:
        raise HTTPException(status_code=422, detail="分辨率宽高不能超过 3840。")
    if width % 16 != 0 or height % 16 != 0:
        raise HTTPException(status_code=422, detail="自定义分辨率要求宽高都能被 16 整除。")
    ratio = width / height
    if ratio < 1 / 3 or ratio > 3:
        raise HTTPException(status_code=422, detail="自定义分辨率比例必须在 1:3 到 3:1 之间。")
    if width * height > 3840 * 3840:
        raise HTTPException(status_code=422, detail="分辨率像素总量不能超过 3840x3840。")
    return f"{width}x{height}"


def resolve_openai_size(payload: ImageRequest) -> str:
    if payload.aspect_ratio != "custom" and payload.quality != "custom":
        expected = PRESET_SIZES.get(payload.aspect_ratio, {}).get(payload.quality)
        if expected and payload.size != expected:
            raise HTTPException(status_code=422, detail=f"当前画幅和清晰度对应的分辨率应为 {expected}。")
    return validate_image2_size(payload.size)


def resolve_grok_size(payload: ImageRequest) -> str:
    if payload.aspect_ratio not in GROK_ASPECT_RATIOS:
        raise HTTPException(status_code=422, detail="Grok 生图只支持 16:9、1:1、9:16。")
    if payload.quality not in GROK_RESOLUTIONS:
        raise HTTPException(status_code=422, detail="Grok 生图只支持 1k 或 2k，不支持 4k 或自定义分辨率。")
    return f"{payload.aspect_ratio} {payload.quality}"


def image_job_to_out(job: ImageJob, db: Session) -> ImageJobOut:
    image_base64: str | None = None
    if job.status == "completed" and job.image_record_id:
        record = db.get(ImageRecord, job.image_record_id)
        if record is not None:
            image_base64 = record.image_base64
    return ImageJobOut(
        id=job.id,
        status=job.status,
        error=job.error,
        prompt=job.prompt,
        style=job.style,
        size=job.size,
        provider=job.provider,
        mode=job.mode,
        reference_count=db.query(func.count(ImageJobReference.id)).filter(ImageJobReference.job_id == job.id).scalar() or 0,
        image_record_id=job.image_record_id,
        image_base64=image_base64,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


@router.get("/images", response_model=list[ImageRecordOut])
def images(db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> list[ImageRecordOut]:
    return db.query(ImageRecord).filter(ImageRecord.user_id == user.id).order_by(desc(ImageRecord.created_at)).limit(10).all()


@router.get("/image/jobs/{job_id}", response_model=ImageJobOut)
def image_job(
    job_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ImageJobOut:
    job = db.get(ImageJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Image job not found.")
    return image_job_to_out(job, db)


def collect_reference_images(form: Any) -> list[UploadFile]:
    images: list[UploadFile] = []
    for key, value in form.multi_items():
        if key not in {"reference_images", "images", "files"}:
            continue
        if not isinstance(value, UploadFile) and not (getattr(value, "filename", None) and hasattr(value, "read")):
            continue
        if str(getattr(value, "filename", "") or "").strip():
            images.append(value)
    return images


async def parse_image_job_request(request: Request) -> tuple[ImageRequest, str, list[UploadFile]]:
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" not in content_type:
        return ImageRequest.model_validate(await request.json()), "text_to_image", []

    form = await request.form()
    payload = ImageRequest.model_validate(
        {
            "prompt": str(form.get("prompt") or ""),
            "style": str(form.get("style") or "写实"),
            "size": str(form.get("size") or "1024x1024"),
            "aspect_ratio": str(form.get("aspect_ratio") or "1:1"),
            "quality": str(form.get("quality") or "1k"),
            "provider": str(form.get("provider") or "openai"),
        }
    )
    mode = str(form.get("mode") or "image_to_image").strip()
    if mode not in {"text_to_image", "image_to_image"}:
        raise HTTPException(status_code=422, detail="不支持的生图模式。")
    return payload, mode, collect_reference_images(form)


async def read_reference_image(upload: UploadFile) -> tuple[bytes, str]:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_REFERENCE_IMAGE_SIZE:
            raise HTTPException(status_code=413, detail=f"参考图 {upload.filename} 超过 10MB。")
        chunks.append(chunk)
    data = b"".join(chunks)
    try:
        with Image.open(BytesIO(data)) as source:
            image_format = str(source.format or "").upper()
            if image_format not in ALLOWED_REFERENCE_FORMATS:
                raise HTTPException(status_code=415, detail="参考图仅支持 PNG、JPG/JPEG 和 WebP。")
            if source.width * source.height > MAX_REFERENCE_PIXELS:
                raise HTTPException(status_code=413, detail=f"参考图 {upload.filename} 像素尺寸过大。")
            source.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=415, detail=f"参考图 {upload.filename} 不是有效图片。") from exc
    return data, ALLOWED_REFERENCE_FORMATS[image_format]


@router.post("/image/jobs", response_model=ImageJobOut, dependencies=[Depends(rate_limiter)])
async def create_image_job(
    request: Request,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ImageJobOut:
    """Enqueue an image job for the in-process worker. Returns immediately."""
    payload, mode, reference_images = await parse_image_job_request(request)
    if mode == "image_to_image" and not reference_images:
        raise HTTPException(status_code=422, detail="图生图模式至少需要上传一张参考图。")
    if mode == "text_to_image" and reference_images:
        raise HTTPException(status_code=422, detail="文生图模式不能携带参考图。")
    if len(reference_images) > MAX_REFERENCE_IMAGES:
        raise HTTPException(status_code=422, detail=f"一次最多上传 {MAX_REFERENCE_IMAGES} 张参考图。")

    provider = normalize_provider(payload.provider)
    if provider == "grok" and len(reference_images) > 3:
        raise HTTPException(status_code=422, detail="Grok 官方接口一次最多支持 3 张参考图。")
    resolved_size = resolve_grok_size(payload) if provider == "grok" else resolve_openai_size(payload)
    job = ImageJob(
        user_id=user.id,
        prompt=payload.prompt.strip(),
        style=payload.style,
        size=resolved_size,
        aspect_ratio=payload.aspect_ratio,
        quality=payload.quality,
        provider=provider,
        mode=mode,
        status="pending",
    )
    stored_paths: list[Path] = []
    try:
        db.add(job)
        db.flush()
        if reference_images:
            REFERENCE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        for index, upload in enumerate(reference_images):
            data, content_type = await read_reference_image(upload)
            suffix = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[content_type]
            stored_path = REFERENCE_UPLOAD_DIR / f"{job.id}_{uuid.uuid4().hex}{suffix}"
            stored_path.write_bytes(data)
            stored_paths.append(stored_path)
            db.add(
                ImageJobReference(
                    job_id=job.id,
                    user_id=user.id,
                    filename=Path(str(upload.filename or f"reference-{index + 1}{suffix}")).name[:255],
                    content_type=content_type,
                    file_path=str(stored_path),
                    file_size=len(data),
                    sort_order=index,
                )
            )
        db.commit()
        db.refresh(job)
    except Exception:
        db.rollback()
        for stored_path in stored_paths:
            stored_path.unlink(missing_ok=True)
        raise
    return image_job_to_out(job, db)


@router.post("/image", response_model=ImageResponse, dependencies=[Depends(rate_limiter)])
def image(
    payload: ImageRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ImageResponse:
    """Synchronous image generation (compatibility). Prefer POST /api/image/jobs."""
    provider = normalize_provider(payload.provider)
    resolved_size = resolve_grok_size(payload) if provider == "grok" else resolve_openai_size(payload)
    if provider == "openai":
        payload.size = resolved_size

    try:
        service = OpenAIService(provider=provider)
        result = service.generate_image(payload)
        image_base64 = str(result["image_base64"])
        db.add(
            ImageRecord(
                user_id=user.id,
                prompt=payload.prompt.strip(),
                style=payload.style,
                size=resolved_size,
                mode="text_to_image",
                reference_count=0,
                image_base64=image_base64,
            )
        )
        record_token_usage(
            db,
            user_id=user.id,
            source="image",
            provider=provider,
            model=str(result.get("model") or service.image_model),
            prompt_tokens=int(result.get("prompt_tokens") or 0),
            completion_tokens=int(result.get("completion_tokens") or 0),
            total_tokens=int(result.get("total_tokens") or 0),
        )
        db.commit()
        return ImageResponse(image_base64=image_base64)
    except OpenAIServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=public_image_error(exc, provider)) from exc
