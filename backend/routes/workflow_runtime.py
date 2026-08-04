from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database.models import ImageRecord, UserAccount, WorkflowRun, WorkflowRunNode, WorkflowSchedule, now_utc
from database.session import get_db
from models.schemas import (
    WorkflowDefinitionRequest,
    WorkflowRunCreate,
    WorkflowRunNodeOut,
    WorkflowRunOut,
    WorkflowRunRetryRequest,
    WorkflowRunSummaryOut,
    WorkflowScheduleCreate,
    WorkflowScheduleEnabledRequest,
    WorkflowScheduleOut,
    WorkflowScheduleUpdate,
    WorkflowStepInput,
)
from services.auth_service import current_user
from services.chat_model_service import resolve_chat_model
from services.rate_limit import InMemoryRateLimiter
from services.settings_service import normalize_provider
from services.workflow_runtime_service import (
    approve_workflow_run,
    as_utc,
    canonical_steps,
    create_run_from_schedule,
    create_workflow_run,
    dump_steps,
    load_steps,
    pause_workflow_run,
    resume_workflow_run,
    retry_workflow_run,
    workflow_nodes,
)

router = APIRouter(prefix="/api/workflows", tags=["workflow-runtime"])
mutation_limiter = InMemoryRateLimiter()


def owned_run(db: Session, user_id: int, run_id: int) -> WorkflowRun:
    run = (
        db.query(WorkflowRun)
        .filter(WorkflowRun.id == run_id, WorkflowRun.user_id == user_id)
        .first()
    )
    if run is None:
        raise HTTPException(status_code=404, detail="工作流运行不存在。")
    return run


def owned_schedule(db: Session, user_id: int, schedule_id: int) -> WorkflowSchedule:
    schedule = (
        db.query(WorkflowSchedule)
        .filter(WorkflowSchedule.id == schedule_id, WorkflowSchedule.user_id == user_id)
        .first()
    )
    if schedule is None:
        raise HTTPException(status_code=404, detail="定时工作流不存在。")
    return schedule


def node_to_out(node: WorkflowRunNode) -> WorkflowRunNodeOut:
    return WorkflowRunNodeOut(
        id=node.id,
        node_key=node.node_key,
        node_type=node.node_type,
        name=node.name,
        instruction=node.instruction,
        sort_order=node.sort_order,
        status=node.status,
        input_text=node.input_text,
        output_text=node.output_text,
        error=node.error,
        attempt=node.attempt,
        duration_ms=node.duration_ms,
        prompt_tokens=node.prompt_tokens,
        completion_tokens=node.completion_tokens,
        total_tokens=node.total_tokens,
        created_at=as_utc(node.created_at),
        started_at=as_utc(node.started_at),
        completed_at=as_utc(node.completed_at),
    )


def run_summary_values(run: WorkflowRun) -> dict[str, object]:
    return {
        "id": run.id,
        "workflow_id": run.workflow_id,
        "target": run.target,
        "name": run.name,
        "prompt": run.prompt,
        "provider": run.provider,
        "model": run.model,
        "execution_mode": run.execution_mode,
        "approval_required": run.approval_required,
        "quality_gate": run.quality_gate,
        "status": run.status,
        "current_node_index": run.current_node_index,
        "final_output": run.final_output,
        "image_record_id": run.image_record_id,
        "quality_status": run.quality_status,
        "quality_feedback": run.quality_feedback,
        "error": run.error,
        "created_at": as_utc(run.created_at),
        "updated_at": as_utc(run.updated_at),
        "started_at": as_utc(run.started_at),
        "paused_at": as_utc(run.paused_at),
        "approved_at": as_utc(run.approved_at),
        "completed_at": as_utc(run.completed_at),
    }


def run_to_summary(run: WorkflowRun) -> WorkflowRunSummaryOut:
    return WorkflowRunSummaryOut(**run_summary_values(run))


def run_to_out(db: Session, run: WorkflowRun) -> WorkflowRunOut:
    image_base64: str | None = None
    if run.image_record_id is not None:
        record = db.get(ImageRecord, run.image_record_id)
        if record is not None and record.user_id == run.user_id:
            image_base64 = record.image_base64
    return WorkflowRunOut(
        **run_summary_values(run),
        image_base64=image_base64,
        nodes=[node_to_out(node) for node in workflow_nodes(db, run.id)],
    )


def schedule_to_out(schedule: WorkflowSchedule) -> WorkflowScheduleOut:
    return WorkflowScheduleOut(
        id=schedule.id,
        workflow_id=schedule.workflow_id,
        target=schedule.target,
        name=schedule.name,
        prompt=schedule.prompt,
        steps=[WorkflowStepInput.model_validate(step) for step in load_steps(schedule.steps_json)],
        provider=schedule.provider,
        model=schedule.model,
        execution_mode=schedule.execution_mode,
        approval_required=schedule.approval_required,
        quality_gate=schedule.quality_gate,
        schedule_type=schedule.schedule_type,
        enabled=schedule.enabled,
        next_run_at=as_utc(schedule.next_run_at),
        last_run_at=as_utc(schedule.last_run_at),
        last_run_id=schedule.last_run_id,
        created_at=as_utc(schedule.created_at),
        updated_at=as_utc(schedule.updated_at),
    )


def definition_error(exc: Exception) -> HTTPException:
    message = str(exc).strip() or "工作流配置无效。"
    return HTTPException(status_code=422, detail=message[:300])


@router.post(
    "/runs",
    response_model=WorkflowRunOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(mutation_limiter)],
)
def create_run(
    payload: WorkflowRunCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> WorkflowRunOut:
    try:
        run = create_workflow_run(db, user_id=user.id, definition=payload)
        db.commit()
        db.refresh(run)
    except ValueError as exc:
        db.rollback()
        raise definition_error(exc) from exc
    return run_to_out(db, run)


@router.get("/runs", response_model=list[WorkflowRunSummaryOut])
def list_runs(
    run_status: str | None = Query(None, alias="status", max_length=24),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> list[WorkflowRunSummaryOut]:
    query = db.query(WorkflowRun).filter(WorkflowRun.user_id == user.id)
    if run_status:
        if run_status not in {"pending", "running", "paused", "awaiting_approval", "completed", "failed"}:
            raise HTTPException(status_code=422, detail="不支持的工作流状态。")
        query = query.filter(WorkflowRun.status == run_status)
    runs = query.order_by(desc(WorkflowRun.created_at), desc(WorkflowRun.id)).offset(offset).limit(limit).all()
    # Polling responses intentionally omit node payloads and image bytes.
    return [run_to_summary(run) for run in runs]


@router.get("/runs/{run_id}", response_model=WorkflowRunOut)
def get_run(
    run_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> WorkflowRunOut:
    return run_to_out(db, owned_run(db, user.id, run_id))


def apply_run_action(db: Session, run: WorkflowRun, action: str) -> WorkflowRun:
    try:
        if action == "pause":
            return pause_workflow_run(db, run)
        if action == "resume":
            return resume_workflow_run(db, run)
        return approve_workflow_run(db, run)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/runs/{run_id}/pause", response_model=WorkflowRunOut, dependencies=[Depends(mutation_limiter)])
def pause_run(
    run_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> WorkflowRunOut:
    run = apply_run_action(db, owned_run(db, user.id, run_id), "pause")
    return run_to_out(db, run)


@router.post("/runs/{run_id}/resume", response_model=WorkflowRunOut, dependencies=[Depends(mutation_limiter)])
def resume_run(
    run_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> WorkflowRunOut:
    run = apply_run_action(db, owned_run(db, user.id, run_id), "resume")
    return run_to_out(db, run)


@router.post("/runs/{run_id}/approve", response_model=WorkflowRunOut, dependencies=[Depends(mutation_limiter)])
def approve_run(
    run_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> WorkflowRunOut:
    run = apply_run_action(db, owned_run(db, user.id, run_id), "approve")
    return run_to_out(db, run)


@router.post("/runs/{run_id}/retry", response_model=WorkflowRunOut, dependencies=[Depends(mutation_limiter)])
def retry_run(
    run_id: int,
    payload: WorkflowRunRetryRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> WorkflowRunOut:
    run = owned_run(db, user.id, run_id)
    try:
        run = retry_workflow_run(db, run, node_key=payload.node_key, node_index=payload.node_index)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return run_to_out(db, run)


@router.post(
    "/schedules",
    response_model=WorkflowScheduleOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(mutation_limiter)],
)
def create_schedule(
    payload: WorkflowScheduleCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> WorkflowScheduleOut:
    try:
        provider = normalize_provider(payload.provider)
        selected_model = resolve_chat_model(db, provider, payload.model)
        steps = canonical_steps(payload.steps)
        schedule = WorkflowSchedule(
            user_id=user.id,
            workflow_id=payload.workflow_id,
            target=payload.target,
            name=payload.name,
            prompt=payload.prompt,
            steps_json=dump_steps(steps),
            provider=provider,
            model=selected_model,
            execution_mode=payload.execution_mode,
            approval_required=payload.approval_required,
            quality_gate=payload.quality_gate,
            schedule_type=payload.schedule_type,
            enabled=payload.enabled,
            next_run_at=payload.next_run_at,
        )
        db.add(schedule)
        db.commit()
        db.refresh(schedule)
    except ValueError as exc:
        db.rollback()
        raise definition_error(exc) from exc
    return schedule_to_out(schedule)


@router.get("/schedules", response_model=list[WorkflowScheduleOut])
def list_schedules(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10000),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> list[WorkflowScheduleOut]:
    schedules = (
        db.query(WorkflowSchedule)
        .filter(WorkflowSchedule.user_id == user.id)
        .order_by(desc(WorkflowSchedule.created_at), desc(WorkflowSchedule.id))
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [schedule_to_out(schedule) for schedule in schedules]


@router.get("/schedules/{schedule_id}", response_model=WorkflowScheduleOut)
def get_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> WorkflowScheduleOut:
    return schedule_to_out(owned_schedule(db, user.id, schedule_id))


@router.patch("/schedules/{schedule_id}", response_model=WorkflowScheduleOut, dependencies=[Depends(mutation_limiter)])
def update_schedule(
    schedule_id: int,
    payload: WorkflowScheduleUpdate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> WorkflowScheduleOut:
    schedule = owned_schedule(db, user.id, schedule_id)
    changes = payload.model_fields_set
    try:
        non_nullable_fields = {
            "workflow_id",
            "target",
            "name",
            "prompt",
            "steps",
            "provider",
            "execution_mode",
            "approval_required",
            "quality_gate",
            "schedule_type",
            "enabled",
        }
        if any(field in changes and getattr(payload, field) is None for field in non_nullable_fields):
            raise ValueError("定时工作流的必填字段不能设为空。")
        merged = WorkflowDefinitionRequest(
            workflow_id=payload.workflow_id if "workflow_id" in changes else schedule.workflow_id,
            target=payload.target if "target" in changes else schedule.target,
            name=payload.name if "name" in changes else schedule.name,
            prompt=payload.prompt if "prompt" in changes else schedule.prompt,
            steps=payload.steps if "steps" in changes else load_steps(schedule.steps_json),
            provider=payload.provider if "provider" in changes else schedule.provider,
            model=payload.model if "model" in changes else schedule.model,
            execution_mode=payload.execution_mode if "execution_mode" in changes else schedule.execution_mode,
            approval_required=(
                payload.approval_required if "approval_required" in changes else schedule.approval_required
            ),
            quality_gate=payload.quality_gate if "quality_gate" in changes else schedule.quality_gate,
        )
        provider = normalize_provider(merged.provider)
        requested_model = merged.model
        if "provider" in changes and "model" not in changes:
            requested_model = None
        selected_model = resolve_chat_model(db, provider, requested_model)
        canonical = canonical_steps(merged.steps)

        schedule.workflow_id = merged.workflow_id
        schedule.target = merged.target
        schedule.name = merged.name
        schedule.prompt = merged.prompt
        schedule.steps_json = dump_steps(canonical)
        schedule.provider = provider
        schedule.model = selected_model
        schedule.execution_mode = merged.execution_mode
        schedule.approval_required = merged.approval_required
        schedule.quality_gate = merged.quality_gate
        if "schedule_type" in changes:
            schedule.schedule_type = payload.schedule_type
        if "next_run_at" in changes:
            schedule.next_run_at = payload.next_run_at
        if "enabled" in changes:
            schedule.enabled = bool(payload.enabled)
        if schedule.enabled and schedule.next_run_at is None:
            raise ValueError("启用定时任务前必须设置下一次运行时间。")
        schedule.updated_at = now_utc()
        db.commit()
        db.refresh(schedule)
    except ValueError as exc:
        db.rollback()
        raise definition_error(exc) from exc
    return schedule_to_out(schedule)


@router.delete("/schedules/{schedule_id}")
def delete_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> dict[str, str]:
    schedule = owned_schedule(db, user.id, schedule_id)
    db.delete(schedule)
    db.commit()
    return {"status": "ok"}


@router.patch(
    "/schedules/{schedule_id}/enabled",
    response_model=WorkflowScheduleOut,
    dependencies=[Depends(mutation_limiter)],
)
def toggle_schedule(
    schedule_id: int,
    payload: WorkflowScheduleEnabledRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> WorkflowScheduleOut:
    schedule = owned_schedule(db, user.id, schedule_id)
    if payload.enabled and schedule.next_run_at is None:
        raise HTTPException(status_code=409, detail="请先设置下一次运行时间。")
    schedule.enabled = payload.enabled
    schedule.updated_at = now_utc()
    db.commit()
    db.refresh(schedule)
    return schedule_to_out(schedule)


@router.post(
    "/schedules/{schedule_id}/run-now",
    response_model=WorkflowRunOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(mutation_limiter)],
)
def run_schedule_now(
    schedule_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(current_user),
) -> WorkflowRunOut:
    schedule = owned_schedule(db, user.id, schedule_id)
    try:
        run = create_run_from_schedule(db, schedule, advance_schedule=False)
        db.commit()
        db.refresh(run)
    except (ValueError, RuntimeError) as exc:
        db.rollback()
        raise definition_error(exc) from exc
    return run_to_out(db, run)
