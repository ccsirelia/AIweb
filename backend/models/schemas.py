from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ImageStyle = Literal["写实", "动漫", "3D", "油画", "产品图", "摄影"]
ImageSize = Literal["1024x1024", "1536x864", "864x1536"]


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    text: str


class ImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1200)
    style: ImageStyle = "写实"
    size: ImageSize = "1024x1024"


class ImageResponse(BaseModel):
    image_base64: str


class ChatRecordOut(BaseModel):
    id: int
    user_message: str
    ai_response: str
    created_at: datetime

    class Config:
        from_attributes = True


class ImageRecordOut(BaseModel):
    id: int
    prompt: str
    style: str
    size: str
    image_base64: str
    created_at: datetime

    class Config:
        from_attributes = True


class HistoryResponse(BaseModel):
    chats: list[ChatRecordOut]
    images: list[ImageRecordOut]
