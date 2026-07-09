from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import TokenUsageRecord


def estimate_text_tokens(text: str) -> int:
    cleaned = (text or "").strip()
    if not cleaned:
        return 0
    # Rough bilingual estimate: ~4 chars per token for mixed Chinese/English content.
    return max(1, (len(cleaned) + 3) // 4)


def extract_usage_dict(response: object) -> dict[str, int]:
    usage = getattr(response, "usage", None)
    if usage is None and hasattr(response, "model_dump"):
        dumped = response.model_dump()
        if isinstance(dumped, dict):
            usage = dumped.get("usage")
    if usage is None and isinstance(response, dict):
        usage = response.get("usage")

    if usage is None:
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    if hasattr(usage, "model_dump"):
        usage = usage.model_dump()
    elif not isinstance(usage, dict):
        usage = {
            "prompt_tokens": getattr(usage, "prompt_tokens", None),
            "input_tokens": getattr(usage, "input_tokens", None),
            "completion_tokens": getattr(usage, "completion_tokens", None),
            "output_tokens": getattr(usage, "output_tokens", None),
            "total_tokens": getattr(usage, "total_tokens", None),
        }

    prompt_tokens = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))
    return {
        "prompt_tokens": max(0, prompt_tokens),
        "completion_tokens": max(0, completion_tokens),
        "total_tokens": max(0, total_tokens),
    }


def record_token_usage(
    db: Session,
    *,
    user_id: int,
    source: str,
    provider: str,
    model: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
) -> None:
    prompt_tokens = max(0, int(prompt_tokens or 0))
    completion_tokens = max(0, int(completion_tokens or 0))
    total_tokens = max(0, int(total_tokens or (prompt_tokens + completion_tokens)))
    if total_tokens <= 0:
        return

    db.add(
        TokenUsageRecord(
            user_id=user_id,
            source=source,
            provider=provider,
            model=model or "",
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )
    )


def sum_tokens_since(db: Session, user_id: int, since: datetime | None = None) -> int:
    query = db.query(func.coalesce(func.sum(TokenUsageRecord.total_tokens), 0)).filter(TokenUsageRecord.user_id == user_id)
    if since is not None:
        query = query.filter(TokenUsageRecord.created_at >= since)
    return int(query.scalar() or 0)


def get_token_usage_summary(db: Session, user_id: int) -> dict[str, int]:
    now = datetime.now(timezone.utc)
    return {
        "total_tokens": sum_tokens_since(db, user_id),
        "last_7_days_tokens": sum_tokens_since(db, user_id, now - timedelta(days=7)),
        "last_24_hours_tokens": sum_tokens_since(db, user_id, now - timedelta(hours=24)),
    }