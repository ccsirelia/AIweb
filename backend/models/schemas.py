from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


Provider = Literal["openai", "grok"]
ImageStyle = Literal["\u5199\u5b9e", "\u52a8\u6f2b", "3D", "\u6cb9\u753b", "\u4ea7\u54c1\u56fe", "\u6444\u5f71"]
ImageAspectRatio = Literal["16:9", "1:1", "9:16", "custom"]
ImageQuality = Literal["1k", "2k", "4k", "custom"]
OpenAIImageQuality = Literal["auto", "low", "medium", "high"]


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


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


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
    model: str | None = Field(None, max_length=160)

    @field_validator("provider", mode="before")
    @classmethod
    def normalize_chat_provider(cls, value: object) -> str:
        return _normalize_provider_value(value)


class ChatResponse(BaseModel):
    text: str
    session_id: int


class ChatSessionUpdateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)


class ChatExportRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=100000)


class ChatJobOut(BaseModel):
    id: int
    session_id: int
    status: str
    error: str
    provider: str
    model: str
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

    class Config:
        from_attributes = True


class ChatModelOut(BaseModel):
    id: int
    provider: str
    model_id: str
    display_name: str
    is_default: bool

    class Config:
        from_attributes = True


class ImageRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1200)
    style: ImageStyle = "\u5199\u5b9e"
    size: str = Field("1024x1024", min_length=7, max_length=20, pattern=r"^\d{2,5}x\d{2,5}$")
    aspect_ratio: ImageAspectRatio = "1:1"
    quality: ImageQuality = "1k"
    openai_quality: OpenAIImageQuality = "auto"
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
    openai_quality: str = "auto"
    mode: str = "text_to_image"
    reference_count: int = 0
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
    mode: str = "text_to_image"
    reference_count: int = 0
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


WorkflowExecutionMode = Literal["sequential", "parallel"]
WorkflowRunStatus = Literal["pending", "running", "paused", "awaiting_approval", "completed", "failed"]
WorkflowScheduleType = Literal["once", "daily", "weekly"]
WorkflowTarget = Literal["chat", "image"]


class WorkflowStepInput(BaseModel):
    id: str | None = Field(None, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    title: str | None = Field(None, min_length=1, max_length=160)
    name: str | None = Field(None, min_length=1, max_length=160)
    description: str | None = Field(None, min_length=1, max_length=4000)
    prompt: str | None = Field(None, min_length=1, max_length=4000)
    instruction: str | None = Field(None, min_length=1, max_length=4000)

    @model_validator(mode="after")
    def normalize_step(self) -> "WorkflowStepInput":
        resolved_name = (self.title or self.name or "").strip()
        resolved_instruction = (self.prompt or self.instruction or self.description or "").strip()
        if not resolved_name:
            raise ValueError("每个工作流节点都需要 title 或 name。")
        if not resolved_instruction:
            raise ValueError("每个工作流节点都需要 prompt、instruction 或 description。")
        self.title = resolved_name
        self.prompt = resolved_instruction
        return self


class WorkflowDefinitionRequest(BaseModel):
    workflow_id: str = Field(..., min_length=1, max_length=120, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    target: WorkflowTarget = "chat"
    name: str = Field(..., min_length=1, max_length=160)
    prompt: str = Field(..., min_length=1, max_length=12000)
    steps: list[WorkflowStepInput] = Field(..., min_length=1, max_length=16)
    provider: Provider = "openai"
    model: str | None = Field(None, max_length=160)
    execution_mode: WorkflowExecutionMode = "sequential"
    approval_required: bool = False
    quality_gate: bool = False

    @field_validator("provider", mode="before")
    @classmethod
    def normalize_workflow_provider(cls, value: object) -> str:
        text = str(value or "openai").strip().lower()
        if text == "gork":
            return "grok"
        if text not in {"openai", "grok"}:
            raise ValueError("工作流通道仅支持 openai 或 grok。")
        return text

    @field_validator("name", "prompt")
    @classmethod
    def strip_workflow_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("内容不能为空。")
        return value

    @model_validator(mode="after")
    def validate_workflow_size(self) -> "WorkflowDefinitionRequest":
        total_chars = len(self.prompt) + sum(len(step.prompt or "") for step in self.steps)
        if total_chars > 48000:
            raise ValueError("工作流总输入不能超过 48000 个字符。")
        node_ids = [step.id for step in self.steps if step.id]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("工作流节点 ID 不能重复。")
        return self


class WorkflowRunCreate(WorkflowDefinitionRequest):
    pass


class WorkflowRunNodeOut(BaseModel):
    id: int
    node_key: str
    node_type: str
    name: str
    instruction: str
    sort_order: int
    status: str
    input_text: str
    output_text: str
    error: str
    attempt: int
    duration_ms: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

    class Config:
        from_attributes = True


class WorkflowRunSummaryOut(BaseModel):
    id: int
    workflow_id: str
    target: WorkflowTarget
    name: str
    prompt: str
    provider: str
    model: str
    execution_mode: str
    approval_required: bool
    quality_gate: bool
    status: str
    current_node_index: int
    final_output: str
    image_record_id: int | None = None
    quality_status: str
    quality_feedback: str
    error: str
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    paused_at: datetime | None = None
    approved_at: datetime | None = None
    completed_at: datetime | None = None

    class Config:
        from_attributes = True


class WorkflowRunOut(WorkflowRunSummaryOut):
    image_base64: str | None = None
    nodes: list[WorkflowRunNodeOut] = Field(default_factory=list)

    class Config:
        from_attributes = True


class WorkflowRunRetryRequest(BaseModel):
    node_key: str | None = Field(None, min_length=1, max_length=100)
    node_index: int | None = Field(None, ge=0, le=15)


class WorkflowScheduleCreate(WorkflowDefinitionRequest):
    schedule_type: WorkflowScheduleType = "once"
    next_run_at: datetime
    enabled: bool = True

    @field_validator("next_run_at")
    @classmethod
    def validate_schedule_datetime(cls, value: datetime) -> datetime:
        normalized = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        current = datetime.now(timezone.utc)
        if normalized < current - timedelta(days=366) or normalized > current + timedelta(days=3650):
            raise ValueError("定时时间必须在过去 1 年到未来 10 年范围内。")
        return normalized


class WorkflowScheduleUpdate(BaseModel):
    workflow_id: str | None = Field(None, min_length=1, max_length=120, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    target: WorkflowTarget | None = None
    name: str | None = Field(None, min_length=1, max_length=160)
    prompt: str | None = Field(None, min_length=1, max_length=12000)
    steps: list[WorkflowStepInput] | None = Field(None, min_length=1, max_length=16)
    provider: Provider | None = None
    model: str | None = Field(None, max_length=160)
    execution_mode: WorkflowExecutionMode | None = None
    approval_required: bool | None = None
    quality_gate: bool | None = None
    schedule_type: WorkflowScheduleType | None = None
    next_run_at: datetime | None = None
    enabled: bool | None = None

    @field_validator("next_run_at")
    @classmethod
    def validate_optional_schedule_datetime(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        normalized = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        current = datetime.now(timezone.utc)
        if normalized < current - timedelta(days=366) or normalized > current + timedelta(days=3650):
            raise ValueError("定时时间必须在过去 1 年到未来 10 年范围内。")
        return normalized

    @field_validator("provider", mode="before")
    @classmethod
    def normalize_schedule_provider(cls, value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip().lower()
        if text == "gork":
            return "grok"
        if text not in {"openai", "grok"}:
            raise ValueError("工作流通道仅支持 openai 或 grok。")
        return text

    @model_validator(mode="after")
    def validate_update_size(self) -> "WorkflowScheduleUpdate":
        if self.prompt is not None and not self.prompt.strip():
            raise ValueError("工作流输入不能为空。")
        if self.name is not None and not self.name.strip():
            raise ValueError("工作流名称不能为空。")
        if self.steps is not None:
            total_chars = len(self.prompt or "") + sum(len(step.prompt or "") for step in self.steps)
            if total_chars > 48000:
                raise ValueError("工作流总输入不能超过 48000 个字符。")
            node_ids = [step.id for step in self.steps if step.id]
            if len(node_ids) != len(set(node_ids)):
                raise ValueError("工作流节点 ID 不能重复。")
        return self


class WorkflowScheduleEnabledRequest(BaseModel):
    enabled: bool


class WorkflowScheduleOut(BaseModel):
    id: int
    workflow_id: str
    target: WorkflowTarget
    name: str
    prompt: str
    steps: list[WorkflowStepInput]
    provider: str
    model: str
    execution_mode: str
    approval_required: bool
    quality_gate: bool
    schedule_type: str
    enabled: bool
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    last_run_id: int | None = None
    created_at: datetime
    updated_at: datetime
