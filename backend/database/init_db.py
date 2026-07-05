import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from database.models import AppSetting, ChatRecord, ImageRecord, UserAccount
from database.session import Base, engine


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


if __name__ == "__main__":
    init_db()
