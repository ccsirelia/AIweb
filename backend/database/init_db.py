import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from database.models import AppSetting, ChatJob, ChatMessage, ChatRecord, ChatSession, ImageRecord, UserAccount
from database.session import Base, engine


def _columns(table_name: str) -> set[str]:
    with engine.connect() as connection:
        rows = connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def _run_sql(sql: str) -> None:
    with engine.begin() as connection:
        connection.exec_driver_sql(sql)


def migrate_sqlite_schema() -> None:
    if not str(engine.url).startswith("sqlite"):
        return

    user_columns = _columns("user_accounts")
    if "username" not in user_columns:
        _run_sql("ALTER TABLE user_accounts ADD COLUMN username VARCHAR(80)")
        _run_sql("UPDATE user_accounts SET username = lower(COALESCE(NULLIF(email, ''), 'user_' || id))")
        _run_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_user_accounts_username ON user_accounts (username)")
    if "password_hash" not in user_columns:
        _run_sql("ALTER TABLE user_accounts ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''")

    chat_record_columns = _columns("chat_records")
    if "user_id" not in chat_record_columns:
        _run_sql("ALTER TABLE chat_records ADD COLUMN user_id INTEGER")
        _run_sql("CREATE INDEX IF NOT EXISTS ix_chat_records_user_id ON chat_records (user_id)")

    session_columns = _columns("chat_sessions")
    if "user_id" not in session_columns:
        _run_sql("ALTER TABLE chat_sessions ADD COLUMN user_id INTEGER")
        _run_sql("CREATE INDEX IF NOT EXISTS ix_chat_sessions_user_id ON chat_sessions (user_id)")

    image_columns = _columns("image_records")
    if "user_id" not in image_columns:
        _run_sql("ALTER TABLE image_records ADD COLUMN user_id INTEGER")
        _run_sql("CREATE INDEX IF NOT EXISTS ix_image_records_user_id ON image_records (user_id)")


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    migrate_sqlite_schema()


if __name__ == "__main__":
    init_db()
