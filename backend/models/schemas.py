from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ImageStyle = Literal["写实", "动漫", "3D", "油画", "产品图", "摄影"]
ImageSize = Literal["1024x1024", "1536x864", "864x1536"]


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


class ChatResponse(BaseModel):
    text: str
    session_id: int


class ChatJobOut(BaseModel):
    id: int
    session_id: int
    status: str
    error: str
    created_at: datetime
    completed_at: datetime | None = None

    class Config:
        from_attributes = True


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
