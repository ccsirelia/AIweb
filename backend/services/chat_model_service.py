"""Manage the administrator-controlled chat model catalog."""

from __future__ import annotations

from sqlalchemy.orm import Session

from database.models import ChatModel
from database.session import SessionLocal
from services.settings_service import get_model_config, normalize_provider


def list_active_chat_models(db: Session) -> list[ChatModel]:
    return (
        db.query(ChatModel)
        .filter(ChatModel.is_active.is_(True))
        .order_by(ChatModel.provider.asc(), ChatModel.is_default.desc(), ChatModel.sort_order.asc(), ChatModel.id.asc())
        .all()
    )


def resolve_chat_model(db: Session, provider: str, requested_model: str | None = None) -> str:
    provider = normalize_provider(provider)
    requested = (requested_model or "").strip()
    query = db.query(ChatModel).filter(ChatModel.provider == provider, ChatModel.is_active.is_(True))

    if requested:
        selected = query.filter(ChatModel.model_id == requested).first()
        if selected is None:
            raise ValueError("所选模型不存在、已停用或不属于当前通道。")
        return selected.model_id

    selected = (
        query.order_by(ChatModel.is_default.desc(), ChatModel.sort_order.asc(), ChatModel.id.asc()).first()
    )
    if selected is not None:
        return selected.model_id
    return get_model_config(provider)[0]


def set_default_chat_model(db: Session, model: ChatModel) -> None:
    db.query(ChatModel).filter(ChatModel.provider == model.provider, ChatModel.id != model.id).update(
        {ChatModel.is_default: False}, synchronize_session=False
    )
    model.is_active = True
    model.is_default = True


def add_legacy_model_to_catalog(db: Session, provider: str, model_id: str) -> ChatModel | None:
    provider = normalize_provider(provider)
    model_id = model_id.strip()
    if not model_id:
        return None
    if len(model_id) > 160 or any(character.isspace() for character in model_id):
        raise ValueError("模型 ID 不能超过 160 个字符或包含空格。")
    existing = (
        db.query(ChatModel)
        .filter(ChatModel.provider == provider, ChatModel.model_id == model_id)
        .first()
    )
    if existing is not None:
        return existing

    has_provider_models = db.query(ChatModel.id).filter(ChatModel.provider == provider).first() is not None
    model = ChatModel(
        provider=provider,
        model_id=model_id,
        display_name=model_id,
        is_active=True,
        is_default=not has_provider_models,
        sort_order=100,
    )
    db.add(model)
    db.flush()
    return model


def ensure_default_chat_models(db: Session | None = None) -> None:
    owns_session = db is None
    if db is None:
        db = SessionLocal()
    try:
        for provider in ("openai", "grok"):
            configured_model = get_model_config(provider)[0]
            configured = add_legacy_model_to_catalog(db, provider, configured_model)
            current_default = (
                db.query(ChatModel)
                .filter(ChatModel.provider == provider, ChatModel.is_default.is_(True))
                .order_by(ChatModel.id.asc())
                .first()
            )
            if current_default is not None:
                set_default_chat_model(db, current_default)
            elif configured is not None:
                set_default_chat_model(db, configured)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        if owns_session:
            db.close()
