from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database.models import ImageRecord
from database.session import get_db
from models.schemas import ImageRecordOut, ImageRequest, ImageResponse
from services.auth_service import current_user
from services.openai_service import OpenAIService, OpenAIServiceError
from services.rate_limit import InMemoryRateLimiter
from database.models import UserAccount

router = APIRouter(prefix="/api", tags=["image"])
rate_limiter = InMemoryRateLimiter()


@router.get("/images", response_model=list[ImageRecordOut])
def images(db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> list[ImageRecordOut]:
    return db.query(ImageRecord).filter(ImageRecord.user_id == user.id).order_by(desc(ImageRecord.created_at)).limit(10).all()


@router.post("/image", response_model=ImageResponse, dependencies=[Depends(rate_limiter)])
def image(
    payload: ImageRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ImageResponse:
    try:
        service = OpenAIService()
        image_base64 = service.generate_image(payload)
        db.add(
            ImageRecord(
                user_id=user.id,
                prompt=payload.prompt.strip(),
                style=payload.style,
                size=payload.size,
                image_base64=image_base64,
            )
        )
        db.commit()
        return ImageResponse(image_base64=image_base64)
    except OpenAIServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
