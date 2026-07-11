from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


Provider = Literal["openai", "grok"]
ImageStyle = Literal["\u5199\u5b9e", "\u52a8\u6f2b", "3D", "\u6cb9\u753b", "\u4ea7\u54c1\u56fe", "\u6444\u5f71"]
ImageAspectRatio = Literal["16:9", "1:1", "9:16", "custom"]
ImageQuality = Literal["1k", "2k", "4k", "custom"]


def _normalize_provider_value(value: object) -> str:
    text = str(value or "openai").strip().lower()
    if text == "gork":
        return "grok"
    if text in {"openai", "grok"}:
        return text
    return "openai"


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=80, pattern=r"^[a-zA-Z0-9_@.-]+$")
    name: str = Field(..., min_length=1, max_length=120)
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=6, max_length=128)


class LoginRequest(BaseModel):
    account: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)


class UserOut(BaseModel):
    id: int
    username: str
    name: str
    email: str
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    token: str
    user: UserOut


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    session_id: int | None = None
    provider: Provider = "openai"

    @field_validator("provider", mode="before")
    @classmethod
    def normalize_chat_provider(cls, value: object) -> str:
        return _normalize_provider_value(value)


class ChatResponse(BaseModel):
    text: str
    session_id: int


class ChatJobOut(BaseModel):
    id: int
    session_id: int
    status: str
    error: str
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

    class Config:
        from_attributes = True


class ImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1200)
    style: ImageStyle = "\u5199\u5b9e"
    size: str = Field("1024x1024", min_length=7, max_length=20, pattern=r"^\d{2,5}x\d{2,5}$")
    aspect_ratio: ImageAspectRatio = "1:1"
    quality: ImageQuality = "1k"
    provider: Provider = "openai"

    @field_validator("provider", mode="before")
    @classmethod
    def normalize_image_provider(cls, value: object) -> str:
        return _normalize_provider_value(value)


class ImageResponse(BaseModel):
    image_base64: str


class ImageJobOut(BaseModel):
    id: int
    status: str
    error: str
    prompt: str
    style: str
    size: str
    provider: str
    image_record_id: int | None = None
    image_base64: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

    class Config:
        from_attributes = True


class ChatRecordOut(BaseModel):
    id: int
    user_message: str
    ai_response: str
    created_at: datetime

    class Config:
        from_attributes = True


class ChatMessageOut(BaseModel):
    id: int
    session_id: int
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class ChatSessionOut(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ChatSessionDetail(BaseModel):
    session: ChatSessionOut
    messages: list[ChatMessageOut]


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


class TokenUsageSummary(BaseModel):
    total_tokens: int
    last_7_days_tokens: int
    last_24_hours_tokens: int


class AccountProfileResponse(BaseModel):
    user: UserOut
    created_at: datetime
    token_usage: TokenUsageSummary
    recent_images: list[ImageRecordOut]
