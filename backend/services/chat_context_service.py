"""Build bounded, recent chat history for model requests."""

from sqlalchemy.orm import Session

from database.models import ChatMessage


DEFAULT_CONTEXT_MESSAGE_LIMIT = 20


def load_recent_chat_history(
    db: Session,
    session_id: int,
    *,
    before_message_id: int | None = None,
    limit: int = DEFAULT_CONTEXT_MESSAGE_LIMIT,
) -> list[dict[str, str]]:
    """Return the newest model-visible messages in chronological order.

    The database query runs newest-first so ``LIMIT`` selects the recent
    window instead of the beginning of a long conversation. The selected
    rows are then reversed before they are sent to the model.
    """

    safe_limit = max(1, int(limit))
    query = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id,
        ChatMessage.role.in_({"user", "assistant"}),
    )
    if before_message_id is not None:
        query = query.filter(ChatMessage.id < before_message_id)

    newest_first = query.order_by(ChatMessage.id.desc()).limit(safe_limit).all()
    return [
        {"role": message.role, "content": message.content}
        for message in reversed(newest_first)
    ]
