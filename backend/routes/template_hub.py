import json
import threading
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from database.models import AppSetting, UserAccount
from database.session import get_db
from services.auth_service import current_user
from services.rate_limit import InMemoryRateLimiter


router = APIRouter(prefix="/api", tags=["template-hub"])

CATALOG_SETTING_KEY = "template_hub_catalog_v1"
MAX_TEMPLATES = 200
MAX_COMMENTS_PER_TEMPLATE = 80
_catalog_lock = threading.RLock()
catalog_read_limiter = InMemoryRateLimiter(limit=120)
catalog_mutation_limiter = InMemoryRateLimiter(limit=30)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class HubWorkflowField(BaseModel):
    key: str = Field(..., min_length=1, max_length=80)
    label: str = Field(..., min_length=1, max_length=120)
    type: Literal["text", "textarea", "select"]
    placeholder: str | None = Field(None, max_length=500)
    defaultValue: str | None = Field(None, max_length=2000)
    required: bool = False
    options: list[str] | None = Field(None, max_length=50)

    @field_validator("options")
    @classmethod
    def validate_options(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        normalized = list(dict.fromkeys(item.strip()[:120] for item in value if item.strip()))
        return normalized or None


class HubWorkflowStep(BaseModel):
    id: str = Field(..., min_length=1, max_length=100)
    title: str = Field(..., min_length=1, max_length=160)
    description: str = Field(..., min_length=1, max_length=500)


class HubWorkflow(BaseModel):
    id: str = Field(..., min_length=1, max_length=120)
    name: str = Field(..., min_length=1, max_length=80)
    category: str = Field(..., min_length=1, max_length=40)
    description: str = Field("", max_length=500)
    iconKey: str = Field("custom", max_length=40)
    accent: str = Field("#5B7CFF", pattern=r"^#[0-9A-Fa-f]{6}$")
    target: Literal["chat", "image"]
    fields: list[HubWorkflowField] = Field(default_factory=list, max_length=24)
    steps: list[HubWorkflowStep] = Field(default_factory=list, max_length=20)
    promptTemplate: str = Field(..., min_length=1, max_length=30000)
    custom: bool = True
    createdAt: str | None = Field(None, max_length=64)

    @field_validator("fields")
    @classmethod
    def unique_field_keys(cls, value: list[HubWorkflowField]) -> list[HubWorkflowField]:
        if len({field.key for field in value}) != len(value):
            raise ValueError("工作流变量键不能重复")
        return value


class PublishTemplateRequest(BaseModel):
    workflow: HubWorkflow
    releaseNotes: str = Field("", max_length=600)


class CommentRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=500)

    @field_validator("body")
    @classmethod
    def trim_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("评论不能为空")
        return value


class RatingRequest(BaseModel):
    value: int = Field(..., ge=1, le=5)


def _empty_catalog() -> dict:
    return {"version": 1, "items": []}


def _read_catalog(db: Session) -> dict:
    setting = db.query(AppSetting).filter(AppSetting.key == CATALOG_SETTING_KEY).first()
    if setting is None or not setting.value:
        return _empty_catalog()
    try:
        catalog = json.loads(setting.value)
        if not isinstance(catalog, dict) or not isinstance(catalog.get("items"), list):
            return _empty_catalog()
        catalog["items"] = [
            item for item in catalog["items"]
            if isinstance(item, dict)
            and isinstance(item.get("id"), str)
            and isinstance(item.get("workflow"), dict)
            and isinstance(item.get("owner"), dict)
        ][:MAX_TEMPLATES]
        return catalog
    except (TypeError, ValueError, json.JSONDecodeError):
        return _empty_catalog()


def _write_catalog(db: Session, catalog: dict) -> None:
    serialized = json.dumps(catalog, ensure_ascii=False, separators=(",", ":"))
    setting = db.query(AppSetting).filter(AppSetting.key == CATALOG_SETTING_KEY).first()
    if setting is None:
        db.add(AppSetting(key=CATALOG_SETTING_KEY, value=serialized))
    else:
        setting.value = serialized
    db.commit()


def _find_item(catalog: dict, template_id: str) -> dict:
    item = next((item for item in catalog["items"] if item.get("id") == template_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="团队模板不存在或已下架。")
    return item


def _rating_summary(item: dict, user_id: int) -> tuple[float, int, int | None]:
    ratings = item.get("ratings") if isinstance(item.get("ratings"), dict) else {}
    values = [value for value in ratings.values() if isinstance(value, int) and 1 <= value <= 5]
    average = round(sum(values) / len(values), 1) if values else 0.0
    own = ratings.get(str(user_id))
    return average, len(values), own if isinstance(own, int) else None


def _nonnegative_int(value: object) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _public_item(item: dict, user_id: int, *, include_workflow: bool = True) -> dict:
    average, rating_count, my_rating = _rating_summary(item, user_id)
    comments = item.get("comments") if isinstance(item.get("comments"), list) else []
    workflow = item.get("workflow") if isinstance(item.get("workflow"), dict) else {}
    owner = item.get("owner") if isinstance(item.get("owner"), dict) else {}
    payload = {
        "id": item.get("id", ""),
        "sourceWorkflowId": item.get("sourceWorkflowId", ""),
        "owner": owner,
        "releaseNotes": item.get("releaseNotes", ""),
        "publishedAt": item.get("publishedAt", ""),
        "updatedAt": item.get("updatedAt", ""),
        "installCount": _nonnegative_int(item.get("installCount")),
        "ratingAverage": average,
        "ratingCount": rating_count,
        "myRating": my_rating,
        "comments": comments[-MAX_COMMENTS_PER_TEMPLATE:],
    }
    if include_workflow:
        payload["workflow"] = workflow
    else:
        payload["workflow"] = {
            key: workflow.get(key)
            for key in ("id", "name", "category", "description", "target", "accent", "fields", "steps", "createdAt")
        }
    return payload


@router.get("/template-hub", dependencies=[Depends(catalog_read_limiter)])
def list_templates(
    query: str = Query("", max_length=120),
    target: Literal["all", "chat", "image"] = "all",
    sort: Literal["recent", "rating", "popular"] = "recent",
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> dict:
    with _catalog_lock:
        catalog = _read_catalog(db)
        items = list(catalog["items"])

    normalized_query = query.strip().lower()
    if normalized_query:
        items = [
            item for item in items
            if normalized_query in " ".join([
                str(item.get("workflow", {}).get("name", "")),
                str(item.get("workflow", {}).get("category", "")),
                str(item.get("workflow", {}).get("description", "")),
                str(item.get("owner", {}).get("name", "")),
                str(item.get("releaseNotes", "")),
            ]).lower()
        ]
    if target != "all":
        items = [item for item in items if item.get("workflow", {}).get("target") == target]

    if sort == "rating":
        items.sort(key=lambda item: (_rating_summary(item, user.id)[0], _rating_summary(item, user.id)[1], item.get("updatedAt", "")), reverse=True)
    elif sort == "popular":
        items.sort(key=lambda item: (_nonnegative_int(item.get("installCount")), item.get("updatedAt", "")), reverse=True)
    else:
        items.sort(key=lambda item: item.get("updatedAt", ""), reverse=True)

    return {"items": [_public_item(item, user.id, include_workflow=True) for item in items], "total": len(items)}


@router.post("/template-hub", dependencies=[Depends(catalog_mutation_limiter)])
def publish_template(
    payload: PublishTemplateRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> dict:
    workflow = payload.workflow.model_dump()
    timestamp = now_iso()
    with _catalog_lock:
        catalog = _read_catalog(db)
        existing = next((
            item for item in catalog["items"]
            if item.get("sourceWorkflowId") == workflow["id"] and item.get("owner", {}).get("id") == user.id
        ), None)
        if existing is not None:
            existing["workflow"] = workflow
            existing["releaseNotes"] = payload.releaseNotes.strip()
            existing["updatedAt"] = timestamp
            item = existing
        else:
            if len(catalog["items"]) >= MAX_TEMPLATES:
                raise HTTPException(status_code=409, detail="团队模板中心已达到容量上限，请先下架旧模板。")
            item = {
                "id": f"hub-{uuid.uuid4().hex}",
                "sourceWorkflowId": workflow["id"],
                "workflow": workflow,
                "owner": {"id": user.id, "name": user.name, "username": user.username},
                "releaseNotes": payload.releaseNotes.strip(),
                "publishedAt": timestamp,
                "updatedAt": timestamp,
                "installCount": 0,
                "ratings": {},
                "comments": [],
            }
            catalog["items"].append(item)
        _write_catalog(db, catalog)
    return _public_item(item, user.id)


@router.post("/template-hub/{template_id}/comments", dependencies=[Depends(catalog_mutation_limiter)])
def add_comment(
    template_id: str,
    payload: CommentRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> dict:
    with _catalog_lock:
        catalog = _read_catalog(db)
        item = _find_item(catalog, template_id)
        comments = item.get("comments") if isinstance(item.get("comments"), list) else []
        comment = {
            "id": f"comment-{uuid.uuid4().hex}",
            "userId": user.id,
            "name": user.name,
            "username": user.username,
            "body": payload.body,
            "createdAt": now_iso(),
        }
        item["comments"] = [*comments, comment][-MAX_COMMENTS_PER_TEMPLATE:]
        item["updatedAt"] = now_iso()
        _write_catalog(db, catalog)
    return {"comment": comment, "template": _public_item(item, user.id)}


@router.put("/template-hub/{template_id}/rating", dependencies=[Depends(catalog_mutation_limiter)])
def rate_template(
    template_id: str,
    payload: RatingRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> dict:
    with _catalog_lock:
        catalog = _read_catalog(db)
        item = _find_item(catalog, template_id)
        ratings = item.get("ratings") if isinstance(item.get("ratings"), dict) else {}
        ratings[str(user.id)] = payload.value
        item["ratings"] = ratings
        item["updatedAt"] = now_iso()
        _write_catalog(db, catalog)
    average, count, own = _rating_summary(item, user.id)
    return {"ratingAverage": average, "ratingCount": count, "myRating": own}


@router.post("/template-hub/{template_id}/install", dependencies=[Depends(catalog_mutation_limiter)])
def install_template(
    template_id: str,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> dict:
    with _catalog_lock:
        catalog = _read_catalog(db)
        item = _find_item(catalog, template_id)
        item["installCount"] = min(_nonnegative_int(item.get("installCount")) + 1, 2_147_483_647)
        _write_catalog(db, catalog)
    return _public_item(item, user.id)


@router.delete("/template-hub/{template_id}", dependencies=[Depends(catalog_mutation_limiter)])
def delete_template(
    template_id: str,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> dict[str, bool]:
    with _catalog_lock:
        catalog = _read_catalog(db)
        item = _find_item(catalog, template_id)
        if item.get("owner", {}).get("id") != user.id and user.role != "admin":
            raise HTTPException(status_code=403, detail="只有发布者或管理员可以下架该模板。")
        catalog["items"] = [entry for entry in catalog["items"] if entry.get("id") != template_id]
        _write_catalog(db, catalog)
    return {"ok": True}
