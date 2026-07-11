import os

from sqlalchemy.orm import Session

from database.models import AppSetting
from database.session import SessionLocal


SETTING_OPENAI_BASE_URL = "openai_base_url"
SETTING_OPENAI_API_KEY = "openai_api_key"
SETTING_OPENAI_TEXT_MODEL = "openai_text_model"
SETTING_OPENAI_IMAGE_MODEL = "openai_image_model"

SETTING_GROK_BASE_URL = "grok_base_url"
SETTING_GROK_API_KEY = "grok_api_key"
SETTING_GROK_TEXT_MODEL = "grok_text_model"
SETTING_GROK_IMAGE_MODEL = "grok_image_model"

# Legacy misspelled keys (gork → grok).
LEGACY_GROK_KEY_MAP = {
    "gork_base_url": SETTING_GROK_BASE_URL,
    "gork_api_key": SETTING_GROK_API_KEY,
    "gork_text_model": SETTING_GROK_TEXT_MODEL,
    "gork_image_model": SETTING_GROK_IMAGE_MODEL,
}

ProviderName = str


def normalize_provider(provider: str | None) -> ProviderName:
    value = (provider or "openai").strip().lower()
    # Accept legacy misspelling.
    if value == "gork":
        return "grok"
    return value if value in {"openai", "grok"} else "openai"


def get_setting(db: Session, key: str, default: str = "") -> str:
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()
    if setting is not None:
        return setting.value
    # Fall back to legacy gork_* keys for one release.
    for legacy_key, modern_key in LEGACY_GROK_KEY_MAP.items():
        if modern_key == key:
            legacy = db.query(AppSetting).filter(AppSetting.key == legacy_key).first()
            if legacy is not None and legacy.value:
                return legacy.value
    return default


def set_setting(db: Session, key: str, value: str) -> None:
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()
    if setting is None:
        db.add(AppSetting(key=key, value=value))
    else:
        setting.value = value


def migrate_gork_settings(db: Session | None = None) -> None:
    """Copy legacy gork_* app_settings into grok_* when target is empty."""
    owns_session = db is None
    if db is None:
        db = SessionLocal()
    try:
        for legacy_key, modern_key in LEGACY_GROK_KEY_MAP.items():
            legacy = db.query(AppSetting).filter(AppSetting.key == legacy_key).first()
            if legacy is None or not (legacy.value or "").strip():
                continue
            modern = db.query(AppSetting).filter(AppSetting.key == modern_key).first()
            if modern is None:
                db.add(AppSetting(key=modern_key, value=legacy.value))
            elif not (modern.value or "").strip():
                modern.value = legacy.value
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        if owns_session:
            db.close()


def get_runtime_config(provider: str = "openai") -> tuple[str | None, str]:
    provider = normalize_provider(provider)
    with SessionLocal() as db:
        if provider == "grok":
            base_url = (
                get_setting(db, SETTING_GROK_BASE_URL, "").strip()
                or os.getenv("GROK_BASE_URL", "").strip()
                or os.getenv("GORK_BASE_URL", "").strip()
                or None
            )
            api_key = (
                get_setting(db, SETTING_GROK_API_KEY, "").strip()
                or os.getenv("GROK_API_KEY", "")
                or os.getenv("GORK_API_KEY", "")
            )
            return base_url, api_key

        base_url = get_setting(db, SETTING_OPENAI_BASE_URL, "").strip() or os.getenv("OPENAI_BASE_URL", "").strip() or None
        api_key = get_setting(db, SETTING_OPENAI_API_KEY, "").strip() or os.getenv("OPENAI_API_KEY", "")
    return base_url, api_key


def get_model_config(provider: str = "openai") -> tuple[str, str]:
    provider = normalize_provider(provider)
    with SessionLocal() as db:
        if provider == "grok":
            text_model = (
                get_setting(db, SETTING_GROK_TEXT_MODEL, "").strip()
                or os.getenv("GROK_TEXT_MODEL", "")
                or os.getenv("GORK_TEXT_MODEL", "")
                or "grok-3-mini"
            )
            image_model = (
                get_setting(db, SETTING_GROK_IMAGE_MODEL, "").strip()
                or os.getenv("GROK_IMAGE_MODEL", "")
                or os.getenv("GORK_IMAGE_MODEL", "")
                or "grok-2-image"
            )
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
