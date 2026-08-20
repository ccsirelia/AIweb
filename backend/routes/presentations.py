from __future__ import annotations

import json
import re
import sys
import uuid
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException
from starlette.requests import ClientDisconnect

from database.models import PresentationJob, PresentationJobAsset, UserAccount, now_utc
from database.session import get_db
from models.schemas import PresentationJobOut
from services.auth_service import current_user
from services.document_extract import extract_document_text
from services.chat_model_service import resolve_chat_model
from services.rate_limit import InMemoryRateLimiter
from services.presentation_service import OUTPUT_ROOT

router = APIRouter(prefix="/api/presentations", tags=["presentations"])
mutation_limiter = InMemoryRateLimiter(limit=12, key_by_user=True)
UPLOAD_ROOT = Path(__file__).resolve().parents[1] / "uploads" / "presentation-jobs"
MAX_ASSETS = 8
MAX_REFERENCE_SIZE = 25 * 1024 * 1024
MAX_TEMPLATE_SIZE = 100 * 1024 * 1024
MAX_TOTAL_SIZE = 125 * 1024 * 1024
MAX_MULTIPART_OVERHEAD = 10 * 1024 * 1024
ALLOWED_REFERENCE_EXTENSIONS = {".pdf", ".docx", ".pptx", ".xlsx", ".csv", ".txt", ".md", ".json", ".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_TEMPLATE_EXTENSIONS = {".pptx"}
ALLOWED_STYLES = {
    "random",
    "state-briefing",
    "aviation-blue",
    "aqua-planning",
    "security-report",
    "dark-tech",
    "swiss-minimal",
    "glassmorphism",
    "data-journalism",
    "editorial",
    "blueprint",
    "ink-notes",
    "photo-editorial",
    "soft-rounded",
    "vivid-launch",
    "clean-business",  # legacy jobs remain retryable
}
ALLOWED_RATIOS = {"16:9", "4:3"}
ALLOWED_MODES = {"pyramid", "narrative", "instructional", "showcase", "briefing"}
ALLOWED_FEATURES = {
    "assertion_titles",
    "kicker_summary",
    "layout_variety",
    "visual_decor",
    "metrics",
    "roadmap",
    "comparison",
    "source_notes",
    "data_story",
    "template_fidelity",
}
PROJECT_SKILL_ROOT = Path(__file__).resolve().parents[2] / "skills" / "ppt-master"

SKILL_CATALOG = {
    "modes": [
        {"id": "pyramid", "label": "结论金字塔", "description": "先给判断，再用证据支持决策。"},
        {"id": "narrative", "label": "叙事推进", "description": "情境、张力、转折与解决方案。"},
        {"id": "instructional", "label": "教学拆解", "description": "按步骤建立理解，适合培训与方法论。"},
        {"id": "showcase", "label": "视觉发布", "description": "大标题、大数字与强节奏展示。"},
        {"id": "briefing", "label": "信息简报", "description": "中性、完整、适合会议资料查阅。"},
    ],
    "styles": [
        {"id": "random", "label": "智能随机", "description": "根据提示词、资料和模板自动选择最合适的视觉方向。"},
        {"id": "state-briefing", "label": "国企蓝白", "description": "白底、机场蓝、顶部章节条与克制的信息层级，适合正式汇报。"},
        {"id": "aviation-blue", "label": "机场专项蓝", "description": "白底与机场蓝、编号章、图纸或现场照片证据，适合项目与外包专项汇报。"},
        {"id": "aqua-planning", "label": "浅青年度规划", "description": "浅青底、轻量章节号与阶段控件，适合年度计划、部署和成果展望。"},
        {"id": "security-report", "label": "安护年度深蓝", "description": "深蓝章节、浅色数据页与硬朗标签，适合安全、安保和年度总结。"},
        {"id": "dark-tech", "label": "暗夜科技", "description": "深色底、光感线条、几何节点。"},
        {"id": "swiss-minimal", "label": "瑞士极简", "description": "网格、留白与极少装饰。"},
        {"id": "glassmorphism", "label": "玻璃拟态", "description": "半透明面板、光晕与悬浮层次。"},
        {"id": "data-journalism", "label": "数据新闻", "description": "数据密度、侧栏与出版物规则线。"},
        {"id": "editorial", "label": "杂志社论", "description": "杂志栏目、眉题、引文与层级。"},
        {"id": "blueprint", "label": "工程蓝图", "description": "工程图、标注线与技术图纸语言。"},
        {"id": "ink-notes", "label": "墨迹笔记", "description": "手绘线条、概念圈与克制批注。"},
        {"id": "photo-editorial", "label": "摄影社论", "description": "图片主导、标题与图注辅助。"},
        {"id": "soft-rounded", "label": "柔和圆角", "description": "柔和卡片、轻量层次与亲和节奏。"},
        {"id": "vivid-launch", "label": "鲜明发布", "description": "高对比色块、发布会气氛与动势。"},
    ],
    "features": [
        {"id": "assertion_titles", "label": "结论式标题", "description": "把页标题写成可直接汇报的判断。"},
        {"id": "kicker_summary", "label": "小标题 + 页面总结", "description": "每页增加眉题、结论带和一句话总结。"},
        {"id": "layout_variety", "label": "多版式轮换", "description": "在观点、对比、指标、流程、引文之间切换构图。"},
        {"id": "visual_decor", "label": "视觉装饰与控件", "description": "按页面角色生成规则线、编号章、章节条、证据标签与克制装饰。"},
        {"id": "metrics", "label": "关键指标页", "description": "把事实提炼成适合管理层快速扫描的数字。"},
        {"id": "roadmap", "label": "路线图页", "description": "自动生成阶段、负责人和下一步动作的时间轴。"},
        {"id": "comparison", "label": "对比决策页", "description": "把方案、现状或竞品放到同一判断框架。"},
        {"id": "source_notes", "label": "来源备注", "description": "为资料页保留来源和可追溯说明。"},
        {"id": "data_story", "label": "数据叙事与图表", "description": "从可核验数据选择柱状、折线、环形或原生图表。"},
        {"id": "template_fidelity", "label": "原生模板保真", "description": "沿用上传 PPT 的母版、页眉、图片和表格槽位。"},
    ],
}


def _as_bool(value: object, default: bool = True) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _as_csv(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).split(",") if item.strip()]


def _skill_available() -> bool:
    return (PROJECT_SKILL_ROOT / "SKILL.md").is_file() and (PROJECT_SKILL_ROOT / "workflows").is_dir()


def _safe_filename(value: str, fallback: str) -> str:
    name = Path(value or fallback).name
    name = re.sub(r"[^A-Za-z0-9\u4e00-\u9fff._-]+", "-", name).strip(".-")
    return (name or fallback)[:255]


def _validate_pptx_archive(path: Path) -> None:
    """Validate PPTX structure without loading all embedded media into RAM."""
    script_root = str(PROJECT_SKILL_ROOT / "scripts")
    if script_root not in sys.path:
        sys.path.insert(0, script_root)
    from template_fill_pptx.archive_safety import (
        PPTX_ARCHIVE_LIMITS,
        UnsafeZipArchiveError,
        validate_zip_members,
    )

    try:
        with ZipFile(path) as archive:
            members = validate_zip_members(
                archive,
                limits=PPTX_ARCHIVE_LIMITS,
                label="PPTX template upload",
            )
            names = {member.filename for member in members}
            required = {"[Content_Types].xml", "ppt/presentation.xml"}
            slide_names = sorted(name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name))
            if not required.issubset(names) or not slide_names:
                raise ValueError("missing required presentation parts")
            # Parsing the small structural parts catches truncated/corrupt XML
            # while avoiding expansion of large images and videos.
            ElementTree.fromstring(archive.read("ppt/presentation.xml"))
            ElementTree.fromstring(archive.read(slide_names[0]))
    except (BadZipFile, KeyError, OSError, ElementTree.ParseError, UnsafeZipArchiveError, ValueError) as exc:
        raise ValueError("invalid PPTX archive") from exc


def _job_to_out(job: PresentationJob, db: Session, asset_count: int | None = None) -> PresentationJobOut:
    if asset_count is None:
        asset_count = int(
            db.query(func.count(PresentationJobAsset.id))
            .filter(PresentationJobAsset.job_id == job.id)
            .scalar()
            or 0
        )
    return PresentationJobOut(
        id=job.id,
        title=job.title,
        brief=job.brief,
        audience=job.audience,
        purpose=job.purpose,
        slide_count=job.slide_count,
        language=job.language,
        style=job.style,
        aspect_ratio=job.aspect_ratio,
        include_images=job.include_images,
        provider=job.provider,
        model=job.model,
        workflow_id=job.workflow_id,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        asset_count=asset_count,
        output_filename=job.output_filename,
        download_available=job.status == "completed" and bool(job.output_path),
        error=job.error,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def _format_mb(size: int) -> str:
    return f"{size // (1024 * 1024)}MB"


def _parse_slide_count(value: object) -> int:
    slide_count = int(str(value or "10"))
    if not 5 <= slide_count <= 100:
        raise ValueError("slide count outside supported range")
    return slide_count


async def _read_upload(upload: UploadFile, *, max_size: int, label: str) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size:
            raise HTTPException(status_code=413, detail=f"{label} {upload.filename or '未命名'} 超过 {_format_mb(max_size)}。")
        chunks.append(chunk)
    return b"".join(chunks)


async def _stream_upload(upload: UploadFile, destination: Path, *, max_size: int, label: str) -> int:
    """Persist a large upload without creating a second full-size bytes copy.

    Starlette already spools multipart files to a temporary file. Reading a
    template into ``bytes`` here used to briefly double its memory footprint
    before writing it to the job directory, which is especially fragile when
    Next.js is buffering the same request in the proxy.
    """
    total = 0
    try:
        with destination.open("wb") as target:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_size:
                    raise HTTPException(status_code=413, detail=f"{label} {upload.filename or '未命名'} 超过 {_format_mb(max_size)}。")
                target.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return total


def _uploads_from_form(form: Any, key: str) -> list[UploadFile]:
    result: list[UploadFile] = []
    for form_key, value in form.multi_items():
        if form_key != key or not isinstance(value, UploadFile):
            continue
        if str(value.filename or "").strip():
            result.append(value)
    return result


@router.get("/jobs", response_model=list[PresentationJobOut])
def list_presentation_jobs(
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> list[PresentationJobOut]:
    jobs = db.query(PresentationJob).filter(PresentationJob.user_id == user.id).order_by(PresentationJob.created_at.desc(), PresentationJob.id.desc()).limit(limit).all()
    job_ids = [job.id for job in jobs]
    asset_counts = dict(
        db.query(PresentationJobAsset.job_id, func.count(PresentationJobAsset.id))
        .filter(PresentationJobAsset.job_id.in_(job_ids))
        .group_by(PresentationJobAsset.job_id)
        .all()
    ) if job_ids else {}
    return [_job_to_out(job, db, int(asset_counts.get(job.id, 0))) for job in jobs]


@router.get("/catalog")
def presentation_catalog() -> dict[str, object]:
    """Expose the project-local PPT Master capability catalog to the UI.

    The application only returns curated IDs and labels; it never imports or
    executes a local Agent. Deployments can ship the ``skills/ppt-master``
    directory as a normal project asset and keep the same behavior on a server.
    """
    return {
        "skill": {
            "id": "ppt-master",
            "version": "4.8.0",
            "installed": _skill_available(),
            "source": "project-local",
        },
        **SKILL_CATALOG,
    }


@router.get("/jobs/{job_id}", response_model=PresentationJobOut)
def get_presentation_job(job_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> PresentationJobOut:
    job = db.get(PresentationJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="PPT 任务不存在。")
    return _job_to_out(job, db)


@router.post("/jobs", response_model=PresentationJobOut, dependencies=[Depends(mutation_limiter)])
async def create_presentation_job(
    request: Request,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> PresentationJobOut:
    content_type = (request.headers.get("content-type") or "").lower()
    declared_length = request.headers.get("content-length")
    if declared_length:
        try:
            # Multipart framing adds a small amount beyond the actual assets.
            if int(declared_length) > MAX_TOTAL_SIZE + MAX_MULTIPART_OVERHEAD:
                raise HTTPException(status_code=413, detail=f"本次上传总大小不能超过 {_format_mb(MAX_TOTAL_SIZE)}。")
        except ValueError:
            pass
    try:
        if "multipart/form-data" in content_type:
            form = await request.form(max_files=MAX_ASSETS + 2, max_fields=64)
        elif "application/json" in content_type:
            form = await request.json()
            if not isinstance(form, dict):
                raise HTTPException(status_code=422, detail="PPT 请求内容格式无效。")
        else:
            raise HTTPException(status_code=415, detail="PPT 创建请求必须使用 multipart/form-data 或 JSON。")
    except ClientDisconnect as exc:
        raise HTTPException(status_code=400, detail="上传连接被中断，请检查网络或文件大小后重试。") from exc
    except MultiPartException as exc:
        # Starlette raises this when a multipart boundary is truncated (for
        # example by an upstream proxy body limit). Return JSON so the browser
        # can show an actionable message instead of a generic fetch failure.
        detail = str(exc) or "上传表单解析失败，请重新上传。"
        status_code = 413 if "exceed" in detail.lower() or "size" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=f"上传内容无效：{detail}") from exc
    except HTTPException as exc:
        # Request.form() converts MultiPartException to HTTPException before it
        # reaches this handler on an ASGI app. Normalize that generic 400 too.
        detail = str(exc.detail or "")
        if exc.status_code == 400 and ("parsing" in detail.lower() or "multipart" in detail.lower() or "size" in detail.lower()):
            status_code = 413 if "size" in detail.lower() or "exceed" in detail.lower() else 400
            raise HTTPException(status_code=status_code, detail=f"上传内容无效：{detail or 'multipart 表单解析失败'}") from exc
        raise
    title = str(form.get("title") or "").strip()
    brief = str(form.get("brief") or "").strip()
    if not title or not brief:
        raise HTTPException(status_code=422, detail="请填写演示标题和内容简报。")
    if len(title) > 180 or len(brief) > 12000:
        raise HTTPException(status_code=422, detail="标题或简报超出长度限制。")
    try:
        slide_count = _parse_slide_count(form.get("slide_count"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="页数必须是 5 到 100 之间的整数。") from exc
    style = str(form.get("style") or "state-briefing").strip()
    ratio = str(form.get("aspect_ratio") or "16:9").strip()
    if style not in ALLOWED_STYLES or ratio not in ALLOWED_RATIOS:
        raise HTTPException(status_code=422, detail="不支持的 PPT 风格或画幅。")
    mode = str(form.get("mode") or "pyramid").strip()
    if mode not in ALLOWED_MODES:
        raise HTTPException(status_code=422, detail="不支持的叙事模式。")
    raw_features = form.get("features")
    features = _as_csv(raw_features)
    if raw_features is None:
        features = [item["id"] for item in SKILL_CATALOG["features"]]
    invalid_features = [item for item in features if item not in ALLOWED_FEATURES]
    if invalid_features:
        raise HTTPException(status_code=422, detail="存在不支持的 PPT 功能选项。")

    references = _uploads_from_form(form, "references") if hasattr(form, "multi_items") else []
    template_values = _uploads_from_form(form, "template") if hasattr(form, "multi_items") else []
    if len(template_values) > 1:
        raise HTTPException(status_code=422, detail="一次只能上传一个 PPTX 模板。")
    if len(references) + len(template_values) > MAX_ASSETS:
        raise HTTPException(status_code=422, detail=f"参考资料最多上传 {MAX_ASSETS} 个文件。")

    provider = str(form.get("provider") or "openai").strip().lower()
    if provider == "gork":
        provider = "grok"
    if provider not in {"openai", "grok"}:
        provider = "openai"
    try:
        selected_model = resolve_chat_model(db, provider, str(form.get("model") or "").strip() or None)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    job = PresentationJob(
        user_id=user.id,
        title=title,
        brief=brief,
        audience=str(form.get("audience") or "").strip()[:180],
        purpose=str(form.get("purpose") or "").strip()[:180],
        slide_count=slide_count,
        language=str(form.get("language") or "zh-CN").strip()[:24],
        style=style,
        aspect_ratio=ratio,
        include_images=_as_bool(form.get("include_images"), True),
        provider=provider,
        model=selected_model[:160],
        workflow_id=str(form.get("workflow_id") or "").strip()[:120],
        status="pending",
        stage="queued",
        progress=0,
        metadata_json=json.dumps({"mode": mode, "features": features, "requested_style": style}, ensure_ascii=False),
    )
    stored_paths: list[Path] = []
    total_size = 0
    try:
        db.add(job)
        db.flush()
        job_dir = UPLOAD_ROOT / str(user.id) / str(job.id)
        job_dir.mkdir(parents=True, exist_ok=True)
        for role, uploads in (("reference", references), ("template", template_values)):
            for index, upload in enumerate(uploads):
                filename = _safe_filename(str(upload.filename or ""), f"asset-{index + 1}")
                extension = Path(filename).suffix.lower()
                allowed = ALLOWED_TEMPLATE_EXTENSIONS if role == "template" else ALLOWED_REFERENCE_EXTENSIONS
                if extension not in allowed:
                    raise HTTPException(status_code=415, detail=f"不支持的文件类型：{filename}。")
                max_size = MAX_TEMPLATE_SIZE if role == "template" else MAX_REFERENCE_SIZE
                stored_path = job_dir / f"{index + 1}-{uuid.uuid4().hex}{extension}"
                if role == "template":
                    # Keep the large template on disk throughout the request;
                    # python-pptx accepts a path and does not require another
                    # in-memory copy of all embedded media.
                    file_size = await _stream_upload(
                        upload,
                        stored_path,
                        max_size=max_size,
                        label="PPT 模板",
                    )
                    try:
                        _validate_pptx_archive(stored_path)
                    except ValueError as exc:
                        stored_path.unlink(missing_ok=True)
                        raise HTTPException(status_code=415, detail=f"模板 {filename} 不是有效的 PPTX 文件。") from exc
                else:
                    data = await _read_upload(upload, max_size=max_size, label="参考资料")
                    file_size = len(data)
                    stored_path.write_bytes(data)
                total_size += file_size
                if total_size > MAX_TOTAL_SIZE:
                    stored_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail=f"本次上传总大小不能超过 {_format_mb(MAX_TOTAL_SIZE)}。")
                stored_paths.append(stored_path)
                extracted = None
                if role == "reference" and not extension in {".png", ".jpg", ".jpeg", ".webp"}:
                    try:
                        extracted = extract_document_text(filename, str(upload.content_type or ""), data, max_chars=30_000)
                    except Exception:
                        extracted = None
                db.add(PresentationJobAsset(
                    job_id=job.id,
                    user_id=user.id,
                    role=role,
                    filename=filename,
                    content_type=str(upload.content_type or "application/octet-stream")[:120],
                    file_path=str(stored_path),
                    file_size=file_size,
                    text_content=extracted,
                ))
        db.commit()
        db.refresh(job)
    except Exception:
        db.rollback()
        for path in stored_paths:
            path.unlink(missing_ok=True)
        raise
    finally:
        # Release Starlette's spooled temporary files promptly. This matters
        # for repeated large-template uploads on a long-lived worker.
        for upload in [*references, *template_values]:
            try:
                await upload.close()
            except Exception:
                # Closing a client-aborted temporary stream is best effort and
                # must not turn an already persisted job into a 500 response.
                pass
    return _job_to_out(job, db)


@router.post("/jobs/{job_id}/retry", response_model=PresentationJobOut, dependencies=[Depends(mutation_limiter)])
def retry_presentation_job(job_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> PresentationJobOut:
    job = db.get(PresentationJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="PPT 任务不存在。")
    if job.status not in {"failed", "completed"}:
        raise HTTPException(status_code=409, detail="当前任务还不能重试。")
    if job.output_path:
        Path(job.output_path).unlink(missing_ok=True)
    job.status = "pending"
    job.stage = "queued"
    job.progress = 0
    job.output_path = ""
    job.output_filename = ""
    job.error = ""
    job.started_at = None
    job.completed_at = None
    job.created_at = now_utc()
    db.commit()
    db.refresh(job)
    return _job_to_out(job, db)


@router.get("/jobs/{job_id}/download")
def download_presentation(job_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> FileResponse:
    job = db.get(PresentationJob, job_id)
    if job is None or job.user_id != user.id or job.status != "completed":
        raise HTTPException(status_code=404, detail="PPT 文件不存在或尚未生成完成。")
    output = Path(job.output_path).resolve()
    try:
        output.relative_to(OUTPUT_ROOT.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="PPT 文件已失效，请重新生成。") from exc
    if not output.exists() or not output.is_file():
        raise HTTPException(status_code=404, detail="PPT 文件已失效，请重新生成。")
    return FileResponse(str(output), media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation", filename=job.output_filename or "aiweb-presentation.pptx")


@router.delete("/jobs/{job_id}")
def delete_presentation_job(job_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(current_user)) -> dict[str, str]:
    job = db.get(PresentationJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="PPT 任务不存在。")
    if job.status in {"pending", "running"}:
        # A worker owns the row while it is generating. Deleting it here would
        # make its progress commits raise StaleDataError and leave a noisy,
        # misleading failure in the service log.
        raise HTTPException(status_code=409, detail="任务处理中，完成或失败后再删除。")
    paths = [job.output_path] + [asset.file_path for asset in db.query(PresentationJobAsset).filter(PresentationJobAsset.job_id == job.id).all()]
    db.delete(job)
    db.commit()
    for raw_path in paths:
        if raw_path:
            Path(raw_path).unlink(missing_ok=True)
    return {"status": "ok"}
