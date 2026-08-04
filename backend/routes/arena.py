"""Authenticated, side-effect-free model comparison endpoints."""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from database.models import UserAccount
from database.session import get_db
from services.auth_service import current_user
from services.chat_model_service import resolve_chat_model
from services.openai_service import OpenAIService, OpenAIServiceError
from services.rate_limit import InMemoryRateLimiter
from services.settings_service import normalize_provider
from services.token_usage_service import record_token_usage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/arena", tags=["arena"])
# One comparison fans out to as many as three upstream requests, so this is
# intentionally stricter than the regular chat limiter.
arena_rate_limiter = InMemoryRateLimiter(limit=6, window_seconds=60)
GENERIC_ARENA_ERROR = "候选模型执行失败，请稍后重试。"


class ArenaContestant(BaseModel):
    provider: Literal["openai", "grok"] = "openai"
    model: str | None = Field(default=None, max_length=160)
    role: str = Field(default="", max_length=500)

    @field_validator("provider", mode="before")
    @classmethod
    def normalize_contestant_provider(cls, value: object) -> str:
        return normalize_provider(str(value or "openai"))

    @field_validator("model", "role", mode="before")
    @classmethod
    def strip_optional_text(cls, value: object) -> str | None:
        if value is None:
            return None
        return str(value).strip()


class ArenaCompareRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    contestants: list[ArenaContestant] = Field(..., min_length=2, max_length=3)

    @field_validator("prompt", mode="before")
    @classmethod
    def strip_prompt(cls, value: object) -> str:
        return str(value or "").strip()


class ArenaTokenUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ArenaResult(BaseModel):
    contestant_index: int
    text: str
    model: str
    provider: Literal["openai", "grok"]
    latency_ms: int
    tokens: ArenaTokenUsage
    error: str | None = None


class ArenaCompareResponse(BaseModel):
    results: list[ArenaResult]


def _role_history(role: str) -> list[dict[str, str]] | None:
    role = role.strip()
    if not role:
        return None
    return [
        {
            "role": "system",
            "content": (
                "You are one contestant in a model comparison. Adopt the following perspective "
                "while answering the user's request directly. Do not claim to have seen other "
                f"contestants' answers. Perspective: {role}"
            ),
        }
    ]


def _public_arena_error(exc: Exception) -> str:
    if not isinstance(exc, OpenAIServiceError):
        return GENERIC_ARENA_ERROR
    message = str(exc).strip().lower()
    if "api key" in message and "not configured" in message:
        return "该模型通道尚未配置。"
    if "rate limit" in message or "429" in message:
        return "模型服务繁忙，请稍后重试。"
    if "timeout" in message or "timed out" in message:
        return "候选模型响应超时，请稍后重试。"
    if "空回复" in message or "empty" in message:
        return "候选模型返回了空回复。"
    return GENERIC_ARENA_ERROR


def _run_contestant(index: int, prompt: str, contestant: ArenaContestant, model: str) -> ArenaResult:
    started = time.perf_counter()
    provider = normalize_provider(contestant.provider)
    try:
        service = OpenAIService(provider=provider, text_model=model)
        result = service.chat(prompt, history=_role_history(contestant.role or ""))
        text = str(result.get("text") or "").strip()
        if not text:
            raise OpenAIServiceError("模型返回了空回复")
        return ArenaResult(
            contestant_index=index,
            text=text,
            model=str(result.get("model") or service.text_model),
            provider=provider,
            latency_ms=max(0, round((time.perf_counter() - started) * 1000)),
            tokens=ArenaTokenUsage(
                prompt_tokens=max(0, int(result.get("prompt_tokens") or 0)),
                completion_tokens=max(0, int(result.get("completion_tokens") or 0)),
                total_tokens=max(0, int(result.get("total_tokens") or 0)),
            ),
        )
    except Exception as exc:
        logger.warning(
            "Arena contestant failed index=%s provider=%s model=%s: %s",
            index,
            provider,
            model,
            exc,
        )
        return ArenaResult(
            contestant_index=index,
            text="",
            model=model,
            provider=provider,
            latency_ms=max(0, round((time.perf_counter() - started) * 1000)),
            tokens=ArenaTokenUsage(),
            error=_public_arena_error(exc),
        )


@router.post(
    "/compare",
    response_model=ArenaCompareResponse,
    dependencies=[Depends(arena_rate_limiter)],
)
def compare_models(
    payload: ArenaCompareRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> ArenaCompareResponse:
    resolved: list[tuple[int, ArenaContestant, str]] = []
    for index, contestant in enumerate(payload.contestants):
        provider = normalize_provider(contestant.provider)
        try:
            selected_model = resolve_chat_model(db, provider, contestant.model)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"参赛者 {index + 1}：{exc}") from exc
        resolved.append((index, contestant, selected_model))

    with ThreadPoolExecutor(max_workers=len(resolved), thread_name_prefix="arena") as executor:
        futures = [
            executor.submit(_run_contestant, index, payload.prompt, contestant, selected_model)
            for index, contestant, selected_model in resolved
        ]
        results = [future.result() for future in futures]

    try:
        for result in results:
            if result.error or result.tokens.total_tokens <= 0:
                continue
            record_token_usage(
                db,
                user_id=user.id,
                source="arena",
                provider=result.provider,
                model=result.model,
                prompt_tokens=result.tokens.prompt_tokens,
                completion_tokens=result.tokens.completion_tokens,
                total_tokens=result.tokens.total_tokens,
            )
        db.commit()
    except Exception:
        # Returning already-paid-for answers is preferable to inviting a retry
        # that spends more tokens. The accounting failure remains observable.
        db.rollback()
        logger.exception("Failed to record arena token usage for user_id=%s", user.id)

    return ArenaCompareResponse(results=results)
