import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from database.models import (
    AppSetting,
    ChatAttachment,
    ChatJob,
    ChatMessage,
    ChatModel,
    ChatRecord,
    ChatSession,
    ImageJob,
    ImageJobReference,
    ImageRecord,
    TokenUsageRecord,
    UserAccount,
)
from database.session import Base, engine


def _columns(table_name: str) -> set[str]:
    with engine.connect() as connection:
        rows = connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def _table_exists(table_name: str) -> bool:
    with engine.connect() as connection:
        row = connection.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,),
        ).fetchone()
    return row is not None


def _run_sql(sql: str) -> None:
    with engine.begin() as connection:
        connection.exec_driver_sql(sql)


def migrate_sqlite_schema() -> None:
    if not str(engine.url).startswith("sqlite"):
        return

    if _table_exists("user_accounts"):
        user_columns = _columns("user_accounts")
        if "username" not in user_columns:
            _run_sql("ALTER TABLE user_accounts ADD COLUMN username VARCHAR(80)")
            _run_sql("UPDATE user_accounts SET username = lower(COALESCE(NULLIF(email, ''), 'user_' || id))")
            _run_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_user_accounts_username ON user_accounts (username)")
        if "password_hash" not in user_columns:
            _run_sql("ALTER TABLE user_accounts ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''")

    if _table_exists("chat_records"):
        chat_record_columns = _columns("chat_records")
        if "user_id" not in chat_record_columns:
            _run_sql("ALTER TABLE chat_records ADD COLUMN user_id INTEGER")
            _run_sql("CREATE INDEX IF NOT EXISTS ix_chat_records_user_id ON chat_records (user_id)")

    if _table_exists("chat_sessions"):
        session_columns = _columns("chat_sessions")
        if "user_id" not in session_columns:
            _run_sql("ALTER TABLE chat_sessions ADD COLUMN user_id INTEGER")
            _run_sql("CREATE INDEX IF NOT EXISTS ix_chat_sessions_user_id ON chat_sessions (user_id)")

    if _table_exists("image_records"):
        image_columns = _columns("image_records")
        if "user_id" not in image_columns:
            _run_sql("ALTER TABLE image_records ADD COLUMN user_id INTEGER")
            _run_sql("CREATE INDEX IF NOT EXISTS ix_image_records_user_id ON image_records (user_id)")
        if "mode" not in image_columns:
            _run_sql("ALTER TABLE image_records ADD COLUMN mode VARCHAR(30) NOT NULL DEFAULT 'text_to_image'")
            _run_sql("CREATE INDEX IF NOT EXISTS ix_image_records_mode ON image_records (mode)")
        if "reference_count" not in image_columns:
            _run_sql("ALTER TABLE image_records ADD COLUMN reference_count INTEGER NOT NULL DEFAULT 0")

    if _table_exists("image_jobs"):
        image_job_columns = _columns("image_jobs")
        if "mode" not in image_job_columns:
            _run_sql("ALTER TABLE image_jobs ADD COLUMN mode VARCHAR(30) NOT NULL DEFAULT 'text_to_image'")
            _run_sql("CREATE INDEX IF NOT EXISTS ix_image_jobs_mode ON image_jobs (mode)")

    if _table_exists("chat_jobs"):
        job_columns = _columns("chat_jobs")
        if "provider" not in job_columns:
            _run_sql("ALTER TABLE chat_jobs ADD COLUMN provider VARCHAR(40) NOT NULL DEFAULT 'openai'")
            _run_sql("CREATE INDEX IF NOT EXISTS ix_chat_jobs_provider ON chat_jobs (provider)")
        if "started_at" not in job_columns:
            _run_sql("ALTER TABLE chat_jobs ADD COLUMN started_at DATETIME")
        if "model" not in job_columns:
            _run_sql("ALTER TABLE chat_jobs ADD COLUMN model VARCHAR(160) NOT NULL DEFAULT ''")
        _run_sql("CREATE INDEX IF NOT EXISTS ix_chat_jobs_model ON chat_jobs (model)")

    # Rename legacy provider misspelling gork → grok in job/usage tables.
    if _table_exists("chat_jobs"):
        _run_sql("UPDATE chat_jobs SET provider = 'grok' WHERE provider = 'gork'")
    if _table_exists("image_jobs"):
        _run_sql("UPDATE image_jobs SET provider = 'grok' WHERE provider = 'gork'")
    if _table_exists("token_usage_records"):
        _run_sql("UPDATE token_usage_records SET provider = 'grok' WHERE provider = 'gork'")


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    migrate_sqlite_schema()
    try:
        from services.chat_model_service import ensure_default_chat_models
        from services.settings_service import migrate_gork_settings

        migrate_gork_settings()
        ensure_default_chat_models()
    except Exception:
        # Settings migration is best-effort; app should still start.
        pass


if __name__ == "__main__":
    init_db()
