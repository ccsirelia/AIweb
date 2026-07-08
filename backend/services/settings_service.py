import os

from sqlalchemy.orm import Session

from database.models import AppSetting
from database.session import SessionLocal


SETTING_OPENAI_BASE_URL = "openai_base_url"
SETTING_OPENAI_API_KEY = "openai_api_key"
SETTING_OPENAI_TEXT_MODEL = "openai_text_model"
SETTING_OPENAI_IMAGE_MODEL = "openai_image_model"

SETTING_GORK_BASE_URL = "gork_base_url"
SETTING_GORK_API_KEY = "gork_api_key"
SETTING_GORK_TEXT_MODEL = "gork_text_model"
SETTING_GORK_IMAGE_MODEL = "gork_image_model"

ProviderName = str


def normalize_provider(provider: str | None) -> ProviderName:
    value = (provider or "openai").strip().lower()
    return value if value in {"openai", "gork"} else "openai"


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


def get_runtime_config(provider: str = "openai") -> tuple[str | None, str]:
    provider = normalize_provider(provider)
    with SessionLocal() as db:
        if provider == "gork":
            base_url = get_setting(db, SETTING_GORK_BASE_URL, "").strip() or os.getenv("GORK_BASE_URL", "").strip() or None
            api_key = get_setting(db, SETTING_GORK_API_KEY, "").strip() or os.getenv("GORK_API_KEY", "")
            return base_url, api_key

        base_url = get_setting(db, SETTING_OPENAI_BASE_URL, "").strip() or os.getenv("OPENAI_BASE_URL", "").strip() or None
        api_key = get_setting(db, SETTING_OPENAI_API_KEY, "").strip() or os.getenv("OPENAI_API_KEY", "")
    return base_url, api_key


def get_model_config(provider: str = "openai") -> tuple[str, str]:
    provider = normalize_provider(provider)
    with SessionLocal() as db:
        if provider == "gork":
            text_model = get_setting(db, SETTING_GORK_TEXT_MODEL, "").strip() or os.getenv("GORK_TEXT_MODEL", "grok-3-mini")
            image_model = get_setting(db, SETTING_GORK_IMAGE_MODEL, "").strip() or os.getenv("GORK_IMAGE_MODEL", "grok-2-image")
            return text_model, image_model

        text_model = get_setting(db, SETTING_OPENAI_TEXT_MODEL, "").strip() or os.getenv("OPENAI_TEXT_MODEL", "gpt-4.1-mini")
        image_model = get_setting(db, SETTING_OPENAI_IMAGE_MODEL, "").strip() or os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")
    return text_model, image_model


def get_openai_runtime_config() -> tuple[str | None, str]:
    return get_runtime_config("openai")


def get_openai_model_config() -> tuple[str, str]:
    return get_model_config("openai")


def mask_secret(value: str) -> str:
    if not value:
        return "未设置"
    if len(value) <= 10:
        return "********"
    return f"{value[:6]}...{value[-4:]}"
