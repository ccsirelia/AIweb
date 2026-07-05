import os

from sqlalchemy.orm import Session

from database.models import AppSetting
from database.session import SessionLocal


SETTING_OPENAI_BASE_URL = "openai_base_url"
SETTING_OPENAI_API_KEY = "openai_api_key"
SETTING_OPENAI_TEXT_MODEL = "openai_text_model"
SETTING_OPENAI_IMAGE_MODEL = "openai_image_model"


def get_setting(db: Session, key: str, default: str = "") -> str:
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()
    if setting is None:
        return default
    return setting.value


def set_setting(db: Session, key: str, value: str) -> None:
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()
    if setting is None:
        db.add(AppSetting(key=key, value=value))
    else:
        setting.value = value


def get_openai_runtime_config() -> tuple[str | None, str]:
    with SessionLocal() as db:
        base_url = get_setting(db, SETTING_OPENAI_BASE_URL, "").strip() or os.getenv("OPENAI_BASE_URL", "").strip() or None
        api_key = get_setting(db, SETTING_OPENAI_API_KEY, "").strip() or os.getenv("OPENAI_API_KEY", "")
    return base_url, api_key


def get_openai_model_config() -> tuple[str, str]:
    with SessionLocal() as db:
        text_model = get_setting(db, SETTING_OPENAI_TEXT_MODEL, "").strip() or os.getenv("OPENAI_TEXT_MODEL", "gpt-4.1-mini")
        image_model = get_setting(db, SETTING_OPENAI_IMAGE_MODEL, "").strip() or os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")
    return text_model, image_model


def mask_secret(value: str) -> str:
    if not value:
        return "未设置"
    if len(value) <= 10:
        return "********"
    return f"{value[:6]}...{value[-4:]}"
