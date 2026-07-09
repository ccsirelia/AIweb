import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database.models import ImageRecord, UserAccount
from database.session import get_db
from models.schemas import ImageRecordOut, ImageRequest, ImageResponse
from services.auth_service import current_user
from services.openai_service import OpenAIService, OpenAIServiceError
from services.rate_limit import InMemoryRateLimiter
from services.token_usage_service import record_token_usage

router = APIRouter(prefix="/api", tags=["image"])
rate_limiter = InMemoryRateLimiter()

PRESET_SIZES = {
    "16:9": {"1k": "1920x1024", "2k": "2560x1440", "4k": "3840x2160"},
    "1:1": {"1k": "1024x1024", "2k": "2560x2560", "4k": "3840x3840"},
    "9:16": {"1k": "1024x1920", "2k": "1440x2560", "4k": "2160x3840"},
}
GORK_ASPECT_RATIOS = {"16:9", "1:1", "9:16"}
GORK_RESOLUTIONS = {"1k", "2k"}


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


def resolve_gork_size(payload: ImageRequest) -> str:
    if payload.aspect_ratio not in GORK_ASPECT_RATIOS:
        raise HTTPException(status_code=422, detail="Gork 生图只支持 16:9、1:1、9:16。")
    if payload.quality not in GORK_RESOLUTIONS:
        raise HTTPException(status_code=422, detail="Gork 生图只支持 1k 或 2k，不支持 4k 或自定义分辨率。")
    return f"{payload.aspect_ratio} {payload.quality}"


@router.get("/images", response_model=list[ImageRecordOut])
def images(db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> list[ImageRecordOut]:
    return db.query(ImageRecord).filter(ImageRecord.user_id == user.id).order_by(desc(ImageRecord.created_at)).limit(10).all()


@router.post("/image", response_model=ImageResponse, dependencies=[Depends(rate_limiter)])
def image(
    payload: ImageRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ImageResponse:
    resolved_size = resolve_gork_size(payload) if payload.provider == "gork" else resolve_openai_size(payload)
    if payload.provider == "openai":
        payload.size = resolved_size

    try:
        service = OpenAIService(provider=payload.provider)
        result = service.generate_image(payload)
        image_base64 = str(result["image_base64"])
        db.add(
            ImageRecord(
                user_id=user.id,
                prompt=payload.prompt.strip(),
                style=payload.style,
                size=resolved_size,
                image_base64=image_base64,
            )
        )
        record_token_usage(
            db,
            user_id=user.id,
            source="image",
            provider=payload.provider,
            model=str(result.get("model") or service.image_model),
            prompt_tokens=int(result.get("prompt_tokens") or 0),
            completion_tokens=int(result.get("completion_tokens") or 0),
            total_tokens=int(result.get("total_tokens") or 0),
        )
        db.commit()
        return ImageResponse(image_base64=image_base64)
    except OpenAIServiceError as exc:
        db.rollback()
        message = str(exc)
        if payload.provider == "gork" and "400" in message:
            message = "Gork 生图请求被上游拒绝。请确认后台 Gork 生图模型配置正确，并且前端只选择 1k 或 2k。"
        elif "size" in message.lower():
            message = "当前模型或中转不支持该原生分辨率。系统已尽量使用合法底图尺寸并输出目标尺寸；如果仍失败，请检查后台生图模型配置。"
        raise HTTPException(status_code=502, detail=message) from exc
