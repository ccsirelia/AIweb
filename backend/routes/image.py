from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database.models import ImageRecord
from database.session import get_db
from models.schemas import ImageRequest, ImageResponse
from services.openai_service import OpenAIService, OpenAIServiceError
from services.rate_limit import InMemoryRateLimiter

router = APIRouter(prefix="/api", tags=["image"])
rate_limiter = InMemoryRateLimiter()


@router.post("/image", response_model=ImageResponse, dependencies=[Depends(rate_limiter)])
def image(payload: ImageRequest, db: Session = Depends(get_db)) -> ImageResponse:
    try:
        service = OpenAIService()
        image_base64 = service.generate_image(payload)
        db.add(
            ImageRecord(
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
