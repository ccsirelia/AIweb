"""Persistent workflow execution, quality gates, retries, and schedules."""

from __future__ import annotations

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from database.models import ImageRecord, WorkflowRun, WorkflowRunNode, WorkflowSchedule, now_utc
from database.session import SessionLocal
from models.schemas import ImageRequest, WorkflowDefinitionRequest, WorkflowStepInput
from services.chat_model_service import resolve_chat_model
from services.openai_service import OpenAIService, OpenAIServiceError
from services.settings_service import normalize_provider
from services.token_usage_service import record_token_usage

logger = logging.getLogger(__name__)

MAX_MODEL_INPUT_CHARS = 64_000
MAX_NODE_OUTPUT_CHARS = 200_000
MAX_IMAGE_PROMPT_CHARS = 1_200
MAX_PARALLEL_NODES = 4
SPECIAL_NODE_ORDER = 10_000
IMAGE_NODE_KEY = "__image_generation__"
RUN_EXECUTABLE_STATUSES = {"pending", "running"}

ServiceFactory = Callable[..., OpenAIService]


class WorkflowRuntimeError(RuntimeError):
    pass


class WorkflowExecutionHalted(RuntimeError):
    """Internal control flow for a pause, timeout, or already-terminal run."""


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def canonical_steps(steps: list[WorkflowStepInput] | list[dict[str, Any]]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    used_keys: set[str] = set()
    for index, raw_step in enumerate(steps):
        data = raw_step.model_dump() if hasattr(raw_step, "model_dump") else dict(raw_step)
        node_key = str(data.get("id") or f"step-{index + 1}").strip()
        name = str(data.get("title") or data.get("name") or "").strip()
        instruction = str(
            data.get("prompt") or data.get("instruction") or data.get("description") or ""
        ).strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,79}", node_key):
            raise ValueError("节点 ID 格式无效。")
        if node_key in used_keys:
            raise ValueError("工作流节点 ID 不能重复。")
        if not name or len(name) > 160:
            raise ValueError("节点名称无效。")
        if not instruction or len(instruction) > 4000:
            raise ValueError("节点指令无效或超过 4000 个字符。")
        used_keys.add(node_key)
        normalized.append({"id": node_key, "title": name, "description": instruction})
    if not 1 <= len(normalized) <= 16:
        raise ValueError("工作流必须包含 1 到 16 个节点。")
    return normalized


def dump_steps(steps: list[WorkflowStepInput] | list[dict[str, Any]]) -> str:
    return json.dumps(canonical_steps(steps), ensure_ascii=False, separators=(",", ":"))


def load_steps(value: str) -> list[dict[str, str]]:
    try:
        raw = json.loads(value)
    except (TypeError, json.JSONDecodeError) as exc:
        raise WorkflowRuntimeError("工作流步骤快照已损坏。") from exc
    if not isinstance(raw, list):
        raise WorkflowRuntimeError("工作流步骤快照已损坏。")
    try:
        return canonical_steps(raw)
    except (TypeError, ValueError) as exc:
        raise WorkflowRuntimeError("工作流步骤快照已损坏。") from exc


def _validate_total_input(prompt: str, steps: list[dict[str, str]]) -> None:
    total = len(prompt) + sum(len(step["description"]) for step in steps)
    if not prompt.strip() or len(prompt) > 12_000 or total > 48_000:
        raise ValueError("工作流输入无效或超过长度限制。")


def create_workflow_run(
    db: Session,
    *,
    user_id: int,
    definition: WorkflowDefinitionRequest,
) -> WorkflowRun:
    steps = canonical_steps(definition.steps)
    _validate_total_input(definition.prompt, steps)
    provider = normalize_provider(definition.provider)
    model = resolve_chat_model(db, provider, definition.model)
    return create_workflow_run_snapshot(
        db,
        user_id=user_id,
        workflow_id=definition.workflow_id,
        name=definition.name,
        prompt=definition.prompt,
        steps=steps,
        provider=provider,
        model=model,
        execution_mode=definition.execution_mode,
        approval_required=definition.approval_required,
        quality_gate=definition.quality_gate,
        target=definition.target,
    )


def create_workflow_run_snapshot(
    db: Session,
    *,
    user_id: int,
    workflow_id: str,
    name: str,
    prompt: str,
    steps: list[dict[str, Any]],
    provider: str,
    model: str,
    execution_mode: str,
    approval_required: bool,
    quality_gate: bool,
    target: str = "chat",
) -> WorkflowRun:
    canonical = canonical_steps(steps)
    _validate_total_input(prompt, canonical)
    workflow_id = workflow_id.strip()
    name = name.strip()
    target = str(target or "chat").strip().lower()
    raw_provider = str(provider or "").strip().lower()
    if raw_provider == "gork":
        raw_provider = "grok"
    model = model.strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,119}", workflow_id):
        raise ValueError("工作流 ID 格式无效。")
    if not name or len(name) > 160:
        raise ValueError("工作流名称无效。")
    if raw_provider not in {"openai", "grok"}:
        raise ValueError("工作流通道仅支持 openai 或 grok。")
    if not model or len(model) > 160 or any(character.isspace() for character in model):
        raise ValueError("工作流模型 ID 无效。")
    if execution_mode not in {"sequential", "parallel"}:
        raise ValueError("不支持的工作流执行模式。")
    if target not in {"chat", "image"}:
        raise ValueError("不支持的工作流目标类型。")
    status = "awaiting_approval" if approval_required else "pending"
    run = WorkflowRun(
        user_id=user_id,
        workflow_id=workflow_id,
        target=target,
        name=name,
        prompt=prompt.strip(),
        steps_json=json.dumps(canonical, ensure_ascii=False, separators=(",", ":")),
        provider=raw_provider,
        model=model,
        execution_mode=execution_mode,
        approval_required=approval_required,
        quality_gate=quality_gate,
        quality_status="pending" if quality_gate else "not_requested",
        status=status,
    )
    db.add(run)
    db.flush()
    for index, step in enumerate(canonical):
        db.add(
            WorkflowRunNode(
                run_id=run.id,
                user_id=user_id,
                node_key=step["id"],
                node_type="step",
                name=step["title"],
                instruction=step["description"],
                sort_order=index,
            )
        )
    db.flush()
    return run


def workflow_nodes(db: Session, run_id: int) -> list[WorkflowRunNode]:
    return (
        db.query(WorkflowRunNode)
        .filter(WorkflowRunNode.run_id == run_id)
        .order_by(WorkflowRunNode.sort_order.asc(), WorkflowRunNode.id.asc())
        .all()
    )


def step_nodes(db: Session, run_id: int) -> list[WorkflowRunNode]:
    return (
        db.query(WorkflowRunNode)
        .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.node_type == "step")
        .order_by(WorkflowRunNode.sort_order.asc(), WorkflowRunNode.id.asc())
        .all()
    )


def get_or_create_special_node(
    db: Session,
    run: WorkflowRun,
    *,
    node_key: str,
    node_type: str,
    name: str,
    instruction: str,
    sort_order: int,
) -> WorkflowRunNode:
    node = (
        db.query(WorkflowRunNode)
        .filter(WorkflowRunNode.run_id == run.id, WorkflowRunNode.node_key == node_key)
        .first()
    )
    if node is None:
        node = WorkflowRunNode(
            run_id=run.id,
            user_id=run.user_id,
            node_key=node_key,
            node_type=node_type,
            name=name,
            instruction=instruction,
            sort_order=sort_order,
        )
        db.add(node)
        db.flush()
    return node


def _checked_model_input(value: str) -> str:
    value = value.strip()
    if not value:
        raise WorkflowRuntimeError("节点输入不能为空。")
    if len(value) > MAX_MODEL_INPUT_CHARS:
        raise WorkflowRuntimeError(f"节点上下文超过 {MAX_MODEL_INPUT_CHARS} 个字符，请缩短输入或拆分工作流。")
    return value


def _sequential_input(run: WorkflowRun, node: WorkflowRunNode, previous_output: str) -> str:
    parts = [
        f"工作流：{run.name}",
        f"总目标：\n{run.prompt}",
        f"当前节点：{node.name}\n节点任务：{node.instruction}",
    ]
    if previous_output:
        parts.append(f"上一节点输出：\n{previous_output}")
    parts.append("请完成当前节点任务。输出应能直接交给下一个节点使用，不要虚构未提供的事实。")
    return _checked_model_input("\n\n".join(parts))


def _parallel_input(run: WorkflowRun, node: WorkflowRunNode) -> str:
    return _checked_model_input(
        f"工作流：{run.name}\n\n总目标：\n{run.prompt}\n\n"
        f"你负责并行分支「{node.name}」。\n分支任务：{node.instruction}\n\n"
        "请独立完成这个分支，给出具体、结构化且可供最终汇总的结果。"
    )


def _synthesis_input(run: WorkflowRun, nodes: list[WorkflowRunNode], feedback: str = "") -> str:
    branch_outputs = "\n\n".join(
        f"### {node.name}\n{node.output_text}" for node in nodes if node.output_text.strip()
    )
    parts = [
        f"请综合工作流「{run.name}」的所有并行分支。",
        f"总目标：\n{run.prompt}",
        f"分支结果：\n{branch_outputs}",
        "消除重复和矛盾，保留关键证据与不确定性，形成一个完整、可直接使用的最终结果。",
    ]
    if feedback:
        parts.append(f"上一次质量检查反馈：\n{feedback}\n请针对反馈修订结果。")
    return _checked_model_input("\n\n".join(parts))


def _quality_input(run: WorkflowRun, candidate: str) -> str:
    return _checked_model_input(
        f"你是工作流质量审查器。请检查候选结果是否完成目标、内部一致、具体可用，并且没有虚构事实。\n\n"
        f"工作流目标：\n{run.prompt}\n\n候选结果：\n{candidate}\n\n"
        "第一行必须只写 `VERDICT: PASS` 或 `VERDICT: FAIL`。之后用不超过 5 条要点说明判断；"
        "若失败，明确给出可执行的修订要求。"
    )


def _retry_input(run: WorkflowRun, node: WorkflowRunNode, previous_output: str, candidate: str, feedback: str) -> str:
    parts = [
        f"工作流：{run.name}",
        f"总目标：\n{run.prompt}",
        f"需要重做的节点：{node.name}\n节点任务：{node.instruction}",
    ]
    if previous_output:
        parts.append(f"上一节点输出：\n{previous_output}")
    parts.extend(
        [
            f"上一次候选结果：\n{candidate}",
            f"质量检查反馈：\n{feedback}",
            "请依据反馈完成一次修订，直接给出更完整、准确、可执行的结果。",
        ]
    )
    return _checked_model_input("\n\n".join(parts))


def _public_execution_error(exc: Exception) -> str:
    if isinstance(exc, WorkflowRuntimeError):
        return str(exc)[:300]
    if isinstance(exc, OpenAIServiceError) and "API key" in str(exc):
        return "模型服务尚未配置，请先在设置中配置通道。"
    return "工作流节点执行失败，请稍后重试。"


def _clean_model_text(value: str) -> str:
    answer = re.search(r"<ai_answer>\s*([\s\S]*?)\s*</ai_answer>", value, flags=re.IGNORECASE)
    if answer:
        return answer.group(1).strip()
    return re.sub(
        r"<ai_thought_summary>[\s\S]*?</ai_thought_summary>",
        "",
        value,
        flags=re.IGNORECASE,
    ).strip()


def _parse_result(result: Any) -> tuple[str, int, int, int]:
    if not isinstance(result, dict):
        raise WorkflowRuntimeError("模型返回格式无效。")
    text = _clean_model_text(str(result.get("text") or ""))
    if not text:
        raise WorkflowRuntimeError("模型返回了空结果。")
    if len(text) > MAX_NODE_OUTPUT_CHARS:
        raise WorkflowRuntimeError("模型输出超过工作流节点存储上限。")
    try:
        prompt_tokens = max(0, int(result.get("prompt_tokens") or 0))
        completion_tokens = max(0, int(result.get("completion_tokens") or 0))
        total_tokens = max(0, int(result.get("total_tokens") or 0))
    except (TypeError, ValueError) as exc:
        raise WorkflowRuntimeError("模型用量信息无效。") from exc
    if total_tokens <= 0:
        total_tokens = prompt_tokens + completion_tokens
    return text, prompt_tokens, completion_tokens, total_tokens


def _call_model(
    *,
    provider: str,
    model: str,
    input_text: str,
    service_factory: ServiceFactory,
) -> tuple[str, int, int, int, int]:
    started = time.perf_counter()
    service = service_factory(provider=provider, text_model=model)
    parsed = _parse_result(service.chat(input_text))
    duration_ms = max(1, round((time.perf_counter() - started) * 1000))
    return (*parsed, duration_ms)


def _save_usage(
    db: Session,
    run: WorkflowRun,
    *,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
) -> None:
    record_token_usage(
        db,
        user_id=run.user_id,
        source="workflow",
        provider=run.provider,
        model=run.model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
    )


def _mark_run_failed(db: Session, run_id: int, error: str) -> None:
    db.rollback()
    run = db.get(WorkflowRun, run_id)
    if run is None or run.status == "completed":
        return
    run.status = "failed"
    run.error = error[:300]
    run.completed_at = now_utc()
    run.updated_at = now_utc()
    db.commit()


def _execute_node(
    db: Session,
    run_id: int,
    node_id: int,
    input_text: str,
    service_factory: ServiceFactory,
) -> str:
    run = db.get(WorkflowRun, run_id)
    node = db.get(WorkflowRunNode, node_id)
    if run is None or node is None or run.status not in RUN_EXECUTABLE_STATUSES:
        raise WorkflowExecutionHalted()

    node.status = "running"
    node.input_text = input_text
    node.output_text = ""
    node.error = ""
    node.attempt += 1
    node.duration_ms = 0
    node.prompt_tokens = 0
    node.completion_tokens = 0
    node.total_tokens = 0
    node.started_at = now_utc()
    node.completed_at = None
    started_attempt = node.attempt
    run.updated_at = now_utc()
    db.commit()

    try:
        text, prompt_tokens, completion_tokens, total_tokens, duration_ms = _call_model(
            provider=run.provider,
            model=run.model,
            input_text=input_text,
            service_factory=service_factory,
        )
    except Exception as exc:
        logger.exception("Workflow run=%s node=%s failed", run_id, node_id)
        public_error = _public_execution_error(exc)
        db.rollback()
        run = db.get(WorkflowRun, run_id)
        node = db.get(WorkflowRunNode, node_id)
        if (
            run is not None
            and node is not None
            and run.status in {"pending", "running", "paused"}
            and node.status == "running"
            and node.attempt == started_attempt
        ):
            node.status = "failed"
            node.error = public_error
            node.completed_at = now_utc()
            run.status = "failed"
            run.error = public_error
            run.completed_at = now_utc()
            run.updated_at = now_utc()
            db.commit()
        raise WorkflowExecutionHalted() from exc

    db.expire_all()
    run = db.get(WorkflowRun, run_id)
    node = db.get(WorkflowRunNode, node_id)
    if run is None or node is None:
        raise WorkflowExecutionHalted()
    if run.status not in {"pending", "running", "paused"}:
        raise WorkflowExecutionHalted()
    if node.status != "running" or node.attempt != started_attempt:
        raise WorkflowExecutionHalted()

    node.status = "completed"
    node.output_text = text
    node.duration_ms = duration_ms
    node.prompt_tokens = prompt_tokens
    node.completion_tokens = completion_tokens
    node.total_tokens = total_tokens
    node.completed_at = now_utc()
    _save_usage(
        db,
        run,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
    )
    run.updated_at = now_utc()
    db.commit()
    return text


def _can_continue(db: Session, run_id: int) -> bool:
    db.expire_all()
    run = db.get(WorkflowRun, run_id)
    return run is not None and run.status == "running"


def _execute_sequential(
    db: Session,
    run: WorkflowRun,
    service_factory: ServiceFactory,
) -> str:
    nodes = step_nodes(db, run.id)
    previous_output = ""
    for index, node in enumerate(nodes):
        if node.status == "completed":
            previous_output = node.output_text
            run.current_node_index = index + 1
            continue
        if not _can_continue(db, run.id):
            raise WorkflowExecutionHalted()
        run = db.get(WorkflowRun, run.id)
        node = db.get(WorkflowRunNode, node.id)
        assert run is not None and node is not None
        previous_output = _execute_node(
            db,
            run.id,
            node.id,
            _sequential_input(run, node, previous_output),
            service_factory,
        )
        run = db.get(WorkflowRun, run.id)
        if run is None:
            raise WorkflowExecutionHalted()
        run.current_node_index = index + 1
        run.updated_at = now_utc()
        db.commit()
        if not _can_continue(db, run.id):
            raise WorkflowExecutionHalted()
    return previous_output


def _execute_parallel(
    db: Session,
    run: WorkflowRun,
    service_factory: ServiceFactory,
) -> str:
    nodes = step_nodes(db, run.id)
    pending = [node for node in nodes if node.status != "completed"]
    if pending:
        call_inputs: dict[int, str] = {}
        call_attempts: dict[int, int] = {}
        for node in pending:
            call_inputs[node.id] = _parallel_input(run, node)
            node.status = "running"
            node.input_text = call_inputs[node.id]
            node.output_text = ""
            node.error = ""
            node.attempt += 1
            node.started_at = now_utc()
            node.completed_at = None
            node.duration_ms = 0
            node.prompt_tokens = 0
            node.completion_tokens = 0
            node.total_tokens = 0
            call_attempts[node.id] = node.attempt
        db.commit()

        results: dict[int, tuple[str, int, int, int, int] | Exception] = {}
        with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL_NODES, len(pending)), thread_name_prefix="workflow-node") as pool:
            futures = {
                pool.submit(
                    _call_model,
                    provider=run.provider,
                    model=run.model,
                    input_text=call_inputs[node.id],
                    service_factory=service_factory,
                ): node.id
                for node in pending
            }
            for future in as_completed(futures):
                node_id = futures[future]
                try:
                    results[node_id] = future.result()
                except Exception as exc:
                    logger.exception("Parallel workflow run=%s node=%s failed", run.id, node_id)
                    results[node_id] = exc

        db.expire_all()
        run = db.get(WorkflowRun, run.id)
        if run is None or run.status not in {"pending", "running", "paused"}:
            raise WorkflowExecutionHalted()
        if any(
            (node := db.get(WorkflowRunNode, node_id)) is None
            or node.status != "running"
            or node.attempt != call_attempts[node_id]
            for node_id in results
        ):
            raise WorkflowExecutionHalted()
        first_error = ""
        for node_id, result in results.items():
            node = db.get(WorkflowRunNode, node_id)
            if node is None:
                continue
            node.completed_at = now_utc()
            if isinstance(result, Exception):
                node.status = "failed"
                node.error = _public_execution_error(result)
                first_error = first_error or node.error
                continue
            text, prompt_tokens, completion_tokens, total_tokens, duration_ms = result
            node.status = "completed"
            node.output_text = text
            node.error = ""
            node.duration_ms = duration_ms
            node.prompt_tokens = prompt_tokens
            node.completion_tokens = completion_tokens
            node.total_tokens = total_tokens
            _save_usage(
                db,
                run,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
            )
        if first_error:
            run.status = "failed"
            run.error = first_error
            run.completed_at = now_utc()
        else:
            run.current_node_index = len(nodes)
        run.updated_at = now_utc()
        db.commit()
        if first_error or not _can_continue(db, run.id):
            raise WorkflowExecutionHalted()

    run = db.get(WorkflowRun, run.id)
    assert run is not None
    nodes = step_nodes(db, run.id)
    synthesis = get_or_create_special_node(
        db,
        run,
        node_key="__synthesis__",
        node_type="synthesis",
        name="并行结果综合",
        instruction="综合所有并行分支，形成一个完整结果。",
        sort_order=SPECIAL_NODE_ORDER,
    )
    db.commit()
    if synthesis.status == "completed":
        return synthesis.output_text
    return _execute_node(db, run.id, synthesis.id, _synthesis_input(run, nodes), service_factory)


def _quality_passed(value: str) -> bool:
    verdict = re.search(r"VERDICT\s*:\s*(PASS|FAIL)", value, flags=re.IGNORECASE)
    return bool(verdict and verdict.group(1).upper() == "PASS")


def _run_quality_gate(
    db: Session,
    run: WorkflowRun,
    candidate: str,
    service_factory: ServiceFactory,
) -> str:
    gate = get_or_create_special_node(
        db,
        run,
        node_key="__quality_gate__",
        node_type="quality_gate",
        name="质量检查",
        instruction="验证结果是否完整、准确、一致且可执行。",
        sort_order=SPECIAL_NODE_ORDER + 1,
    )
    db.commit()
    if gate.status == "completed":
        feedback = gate.output_text
    else:
        feedback = _execute_node(db, run.id, gate.id, _quality_input(run, candidate), service_factory)

    run = db.get(WorkflowRun, run.id)
    if run is None:
        raise WorkflowExecutionHalted()
    run.quality_feedback = feedback
    if _quality_passed(feedback):
        run.quality_status = "passed"
        db.commit()
        return candidate

    nodes = step_nodes(db, run.id)
    if run.execution_mode == "parallel":
        retry_node = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run.id, WorkflowRunNode.node_key == "__synthesis__")
            .first()
        )
        if retry_node is None:
            raise WorkflowRuntimeError("工作流综合节点不存在。")
        previous_output = ""
    else:
        if not nodes:
            raise WorkflowRuntimeError("工作流没有可重试的节点。")
        retry_node = nodes[-1]
        previous_output = nodes[-2].output_text if len(nodes) > 1 else ""

    if run.quality_status == "retried":
        if not retry_node.output_text.strip():
            raise WorkflowRuntimeError("质量修订结果不存在。")
        return retry_node.output_text
    if run.quality_status == "retrying" and retry_node.status == "completed":
        if not retry_node.output_text.strip():
            raise WorkflowRuntimeError("质量修订结果不存在。")
        run.quality_status = "retried"
        db.commit()
        return retry_node.output_text

    retry_input = (
        _synthesis_input(run, nodes, feedback=feedback)
        if run.execution_mode == "parallel"
        else _retry_input(run, retry_node, previous_output, candidate, feedback)
    )
    run.quality_status = "retrying"
    db.commit()

    revised = _execute_node(db, run.id, retry_node.id, retry_input, service_factory)
    run = db.get(WorkflowRun, run.id)
    if run is None:
        raise WorkflowExecutionHalted()
    run.quality_status = "retried"
    run.quality_feedback = feedback
    db.commit()
    return revised


def _public_image_execution_error(exc: Exception) -> str:
    if isinstance(exc, WorkflowRuntimeError):
        return str(exc)[:300]
    if isinstance(exc, OpenAIServiceError) and "API key" in str(exc):
        return "图片模型服务尚未配置，请先在设置中配置通道。"
    return "工作流图片生成失败，请稍后重试。"


def _parse_image_result(result: Any) -> tuple[str, str, int, int, int]:
    if not isinstance(result, dict):
        raise WorkflowRuntimeError("图片模型返回格式无效。")
    image_base64 = str(result.get("image_base64") or "").strip()
    if not image_base64:
        raise WorkflowRuntimeError("图片模型返回了空结果。")
    model = str(result.get("model") or "").strip()
    try:
        prompt_tokens = max(0, int(result.get("prompt_tokens") or 0))
        completion_tokens = max(0, int(result.get("completion_tokens") or 0))
        total_tokens = max(0, int(result.get("total_tokens") or 0))
    except (TypeError, ValueError) as exc:
        raise WorkflowRuntimeError("图片模型用量信息无效。") from exc
    if total_tokens <= 0:
        total_tokens = prompt_tokens + completion_tokens
    return image_base64, model, prompt_tokens, completion_tokens, total_tokens


def _fail_image_attempt(
    db: Session,
    *,
    run_id: int,
    node_id: int,
    attempt: int,
    error: str,
    duration_ms: int,
) -> None:
    db.rollback()
    db.expire_all()
    run = db.get(WorkflowRun, run_id, populate_existing=True)
    node = db.get(WorkflowRunNode, node_id, populate_existing=True)
    if (
        run is None
        or node is None
        or run.status != "running"
        or node.status != "running"
        or node.attempt != attempt
    ):
        return
    node.status = "failed"
    node.error = error[:300]
    node.duration_ms = duration_ms
    node.completed_at = now_utc()
    run.status = "failed"
    run.error = error[:300]
    run.completed_at = now_utc()
    run.updated_at = now_utc()
    db.commit()


def _execute_image_target(
    db: Session,
    run: WorkflowRun,
    candidate: str,
    service_factory: ServiceFactory,
) -> int:
    node = get_or_create_special_node(
        db,
        run,
        node_key=IMAGE_NODE_KEY,
        node_type="image_generation",
        name="生成最终图片",
        instruction="将通过文本节点与质量门的候选提示词生成图片。",
        sort_order=SPECIAL_NODE_ORDER + 2,
    )
    db.commit()

    if node.status == "completed" and run.image_record_id is not None:
        record = db.get(ImageRecord, run.image_record_id)
        if record is not None and record.user_id == run.user_id:
            return record.id
        node.status = "pending"
        node.output_text = ""
        run.image_record_id = None
        db.commit()

    prompt = candidate.strip()
    node.status = "running"
    node.input_text = prompt
    node.output_text = ""
    node.error = ""
    node.attempt += 1
    node.duration_ms = 0
    node.prompt_tokens = 0
    node.completion_tokens = 0
    node.total_tokens = 0
    node.started_at = now_utc()
    node.completed_at = None
    started_attempt = node.attempt
    run.image_record_id = None
    run.updated_at = now_utc()
    db.commit()

    started = time.perf_counter()
    try:
        if not prompt:
            raise WorkflowRuntimeError("图片提示词不能为空。")
        if len(prompt) > MAX_IMAGE_PROMPT_CHARS:
            raise WorkflowRuntimeError(f"图片提示词不能超过 {MAX_IMAGE_PROMPT_CHARS} 个字符。")
        payload = ImageRequest(prompt=prompt, provider=run.provider)
        service = service_factory(provider=run.provider, text_model=run.model)
        result = service.generate_image(payload)
        image_base64, image_model, prompt_tokens, completion_tokens, total_tokens = _parse_image_result(result)
        resolved_model = image_model or str(getattr(service, "image_model", "") or "")
    except Exception as exc:
        logger.exception("Workflow image generation failed run=%s node=%s", run.id, node.id)
        duration_ms = max(1, round((time.perf_counter() - started) * 1000))
        _fail_image_attempt(
            db,
            run_id=run.id,
            node_id=node.id,
            attempt=started_attempt,
            error=_public_image_execution_error(exc),
            duration_ms=duration_ms,
        )
        raise WorkflowExecutionHalted() from exc

    duration_ms = max(1, round((time.perf_counter() - started) * 1000))
    db.expire_all()
    run = db.get(WorkflowRun, run.id)
    node = db.get(WorkflowRunNode, node.id)
    if (
        run is None
        or node is None
        or run.status != "running"
        or node.status != "running"
        or node.attempt != started_attempt
    ):
        raise WorkflowExecutionHalted()

    try:
        record = ImageRecord(
            user_id=run.user_id,
            prompt=prompt,
            style=payload.style,
            size=f"{payload.aspect_ratio} {payload.quality}" if run.provider == "grok" else payload.size,
            mode="text_to_image",
            reference_count=0,
            image_base64=image_base64,
        )
        db.add(record)
        db.flush()
        record_token_usage(
            db,
            user_id=run.user_id,
            source="image",
            provider=run.provider,
            model=resolved_model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )
        node.status = "completed"
        node.output_text = str(record.id)
        node.duration_ms = duration_ms
        node.prompt_tokens = prompt_tokens
        node.completion_tokens = completion_tokens
        node.total_tokens = total_tokens
        node.completed_at = now_utc()
        run.image_record_id = record.id
        run.final_output = prompt
        run.updated_at = now_utc()
        db.commit()
        return record.id
    except Exception as exc:
        logger.exception("Workflow image persistence failed run=%s node=%s", run.id, node.id)
        _fail_image_attempt(
            db,
            run_id=run.id,
            node_id=node.id,
            attempt=started_attempt,
            error=_public_image_execution_error(exc),
            duration_ms=duration_ms,
        )
        raise WorkflowExecutionHalted() from exc


def run_workflow_run(
    run_id: int,
    *,
    session_factory: Callable[[], Session] = SessionLocal,
    service_factory: ServiceFactory = OpenAIService,
) -> None:
    db = session_factory()
    try:
        run = db.get(WorkflowRun, run_id)
        if run is None or run.status not in RUN_EXECUTABLE_STATUSES:
            return
        if run.approval_required and run.approved_at is None:
            run.status = "awaiting_approval"
            run.updated_at = now_utc()
            db.commit()
            return

        run.status = "running"
        run.error = ""
        run.completed_at = None
        run.paused_at = None
        run.started_at = run.started_at or now_utc()
        run.updated_at = now_utc()
        db.commit()

        if run.execution_mode == "parallel":
            candidate = _execute_parallel(db, run, service_factory)
        else:
            candidate = _execute_sequential(db, run, service_factory)

        if not _can_continue(db, run.id):
            return
        run = db.get(WorkflowRun, run.id)
        assert run is not None
        if run.quality_gate:
            candidate = _run_quality_gate(db, run, candidate, service_factory)
        if not _can_continue(db, run.id):
            return

        run = db.get(WorkflowRun, run.id)
        if run is None:
            return
        if run.target == "image":
            _execute_image_target(db, run, candidate, service_factory)
            if not _can_continue(db, run.id):
                return
            run = db.get(WorkflowRun, run.id)
            if run is None:
                return
        run.final_output = candidate
        run.status = "completed"
        run.error = ""
        run.completed_at = now_utc()
        run.updated_at = now_utc()
        db.commit()
    except WorkflowExecutionHalted:
        db.rollback()
    except Exception as exc:
        logger.exception("Workflow run=%s failed unexpectedly", run_id)
        _mark_run_failed(db, run_id, _public_execution_error(exc))
    finally:
        db.close()


def pause_workflow_run(db: Session, run: WorkflowRun) -> WorkflowRun:
    if run.status not in {"pending", "running"}:
        raise ValueError("只有等待或运行中的工作流可以暂停。")
    run.status = "paused"
    run.paused_at = now_utc()
    run.updated_at = now_utc()
    db.commit()
    db.refresh(run)
    return run


def resume_workflow_run(db: Session, run: WorkflowRun) -> WorkflowRun:
    if run.status != "paused":
        raise ValueError("只有已暂停的工作流可以继续。")
    run.status = "pending"
    run.paused_at = None
    run.error = ""
    run.completed_at = None
    run.updated_at = now_utc()
    db.commit()
    db.refresh(run)
    return run


def approve_workflow_run(db: Session, run: WorkflowRun) -> WorkflowRun:
    if run.status != "awaiting_approval":
        raise ValueError("当前工作流不在待审批状态。")
    run.approved_at = now_utc()
    run.status = "pending"
    run.error = ""
    run.updated_at = now_utc()
    db.commit()
    db.refresh(run)
    return run


def retry_workflow_run(
    db: Session,
    run: WorkflowRun,
    *,
    node_key: str | None = None,
    node_index: int | None = None,
) -> WorkflowRun:
    if run.status == "running":
        raise ValueError("运行中的工作流不能重试，请先暂停并等待当前节点结束。")
    nodes = workflow_nodes(db, run.id)
    target: WorkflowRunNode | None = None
    if node_key is not None:
        target = next((node for node in nodes if node.node_key == node_key), None)
    elif node_index is not None:
        steps = [node for node in nodes if node.node_type == "step"]
        if 0 <= node_index < len(steps):
            target = steps[node_index]
    else:
        target = next((node for node in nodes if node.status == "failed"), None)
        if target is None:
            steps = [node for node in nodes if node.node_type == "step"]
            if steps:
                target = steps[min(max(run.current_node_index, 0), len(steps) - 1)]
    if target is None:
        raise ValueError("指定的工作流节点不存在。")

    retrying_image_only = target.node_type == "image_generation"
    for node in nodes:
        should_reset = node.id == target.id
        if run.execution_mode == "sequential" and node.sort_order >= target.sort_order:
            should_reset = True
        if (
            run.execution_mode == "parallel"
            and not retrying_image_only
            and node.node_type in {"synthesis", "quality_gate"}
        ):
            should_reset = True
        if node.node_type == "image_generation" and not retrying_image_only:
            should_reset = True
        if should_reset:
            node.status = "pending"
            node.input_text = ""
            node.output_text = ""
            node.error = ""
            node.duration_ms = 0
            node.prompt_tokens = 0
            node.completion_tokens = 0
            node.total_tokens = 0
            node.started_at = None
            node.completed_at = None

    run.status = "pending"
    run.current_node_index = target.sort_order if target.node_type == "step" else len(step_nodes(db, run.id))
    run.final_output = ""
    run.image_record_id = None
    run.error = ""
    run.completed_at = None
    run.paused_at = None
    if not retrying_image_only:
        run.quality_status = "pending" if run.quality_gate else "not_requested"
        run.quality_feedback = ""
    run.updated_at = now_utc()
    db.commit()
    db.refresh(run)
    return run


def next_schedule_occurrence(
    schedule_type: str,
    previous: datetime,
    *,
    now: datetime | None = None,
) -> datetime | None:
    if schedule_type == "once":
        return None
    if schedule_type not in {"daily", "weekly"}:
        raise ValueError("不支持的定时类型。")
    current = as_utc(previous)
    reference = as_utc(now or now_utc())
    assert current is not None and reference is not None
    interval = timedelta(days=1 if schedule_type == "daily" else 7)
    if current <= reference:
        missed = int((reference - current).total_seconds() // interval.total_seconds()) + 1
        current += interval * missed
    return current


def create_run_from_schedule(
    db: Session,
    schedule: WorkflowSchedule,
    *,
    advance_schedule: bool,
) -> WorkflowRun:
    steps = load_steps(schedule.steps_json)
    run = create_workflow_run_snapshot(
        db,
        user_id=schedule.user_id,
        workflow_id=schedule.workflow_id,
        name=schedule.name,
        prompt=schedule.prompt,
        steps=steps,
        provider=schedule.provider,
        model=schedule.model,
        execution_mode=schedule.execution_mode,
        approval_required=schedule.approval_required,
        quality_gate=schedule.quality_gate,
        target=schedule.target,
    )
    schedule.last_run_id = run.id
    schedule.last_run_at = now_utc()
    if advance_schedule:
        previous = schedule.next_run_at or now_utc()
        schedule.next_run_at = next_schedule_occurrence(schedule.schedule_type, previous)
        if schedule.schedule_type == "once":
            schedule.enabled = False
    schedule.updated_at = now_utc()
    db.flush()
    return run
