"""In-process SQLite-backed job worker for chat and image tasks.

Designed for single-process deployments. Pending rows live in SQLite;
a background scheduler claims them into a bounded thread pool.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from database.models import ChatJob, ImageJob, PresentationJob, WorkflowRun, WorkflowRunNode, WorkflowSchedule, now_utc
from database.session import SessionLocal
from services.chat_job_service import run_chat_job
from services.image_job_service import run_image_job
from services.presentation_service import generate_presentation
from services.workflow_runtime_service import create_run_from_schedule, run_workflow_run

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return max(0.1, float(raw))
    except ValueError:
        return default


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class JobWorker:
    def __init__(self) -> None:
        self.concurrency = _env_int("JOB_WORKER_CONCURRENCY", 2)
        self.timeout_seconds = _env_int("JOB_TIMEOUT_SECONDS", 300)
        self.workflow_timeout_seconds = _env_int("WORKFLOW_TIMEOUT_SECONDS", 900)
        self.presentation_timeout_seconds = _env_int("PRESENTATION_TIMEOUT_SECONDS", 900)
        self.poll_interval = _env_float("JOB_POLL_INTERVAL_SECONDS", 0.5)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._executor: ThreadPoolExecutor | None = None
        self._inflight: dict[tuple[str, int], Future] = {}
        self._lock = threading.Lock()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._executor = ThreadPoolExecutor(max_workers=self.concurrency, thread_name_prefix="aiweb-job")
        self.recover_stale_jobs()
        self._thread = threading.Thread(target=self._loop, name="aiweb-job-scheduler", daemon=True)
        self._thread.start()
        logger.info(
            "Job worker started (concurrency=%s, timeout=%ss, poll=%ss)",
            self.concurrency,
            self.timeout_seconds,
            self.poll_interval,
        )

    def stop(self, wait: bool = True) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        if self._executor is not None:
            self._executor.shutdown(wait=wait, cancel_futures=False)
            self._executor = None
        with self._lock:
            self._inflight.clear()
        logger.info("Job worker stopped")

    def recover_stale_jobs(self) -> None:
        """Recover jobs whose executor disappeared during a process restart.

        Chat/image requests are atomic and fail safely. Workflows are resumable,
        so their interrupted node is returned to pending and execution continues
        from the last completed node.
        """
        db = SessionLocal()
        try:
            stale_chat = db.query(ChatJob).filter(ChatJob.status == "running").all()
            for job in stale_chat:
                job.status = "failed"
                job.error = "服务重启导致任务中断，请重新发送。"
                job.completed_at = now_utc()

            stale_image = db.query(ImageJob).filter(ImageJob.status == "running").all()
            for job in stale_image:
                job.status = "failed"
                job.error = "服务重启导致任务中断，请重新生成。"
                job.completed_at = now_utc()

            stale_presentations = db.query(PresentationJob).filter(PresentationJob.status == "running").all()
            for job in stale_presentations:
                job.status = "failed"
                job.stage = "failed"
                job.error = "服务重启导致 PPT 任务中断，请重新生成。"
                job.completed_at = now_utc()

            stale_workflows = db.query(WorkflowRun).filter(WorkflowRun.status == "running").all()
            for run in stale_workflows:
                run.status = "pending"
                run.error = ""
                run.updated_at = now_utc()
                interrupted_nodes = (
                    db.query(WorkflowRunNode)
                    .filter(WorkflowRunNode.run_id == run.id, WorkflowRunNode.status == "running")
                    .all()
                )
                for node in interrupted_nodes:
                    node.status = "pending"
                    node.error = ""
                    node.started_at = None
                    node.completed_at = None

            if stale_chat or stale_image or stale_presentations or stale_workflows:
                db.commit()
                logger.warning(
                    "Recovered stale running jobs after restart: chat=%s image=%s presentation=%s workflow=%s",
                    len(stale_chat),
                    len(stale_image),
                    len(stale_presentations),
                    len(stale_workflows),
                )
        except Exception:
            logger.exception("Failed to recover stale jobs")
            db.rollback()
        finally:
            db.close()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._prune_inflight()
                self._fail_timed_out_running()
                self._enqueue_due_schedules()
                self._dispatch_available()
            except Exception:
                logger.exception("Job worker loop error")
            self._stop.wait(self.poll_interval)

    def _prune_inflight(self) -> None:
        with self._lock:
            done = [key for key, future in self._inflight.items() if future.done()]
            for key in done:
                self._inflight.pop(key, None)

    def _active_count(self) -> int:
        with self._lock:
            return sum(1 for future in self._inflight.values() if not future.done())

    def _fail_timed_out_running(self) -> None:
        cutoff = now_utc() - timedelta(seconds=self.timeout_seconds)
        db = SessionLocal()
        try:
            changed = False
            for model, label in ((ChatJob, "chat"), (ImageJob, "image")):
                jobs = (
                    db.query(model)
                    .filter(model.status == "running")
                    .filter(model.started_at.isnot(None))
                    .filter(model.started_at < cutoff)
                    .all()
                )
                for job in jobs:
                    # Only fail if not still actively tracked (worker may still be running slightly over)
                    key = (label, job.id)
                    with self._lock:
                        future = self._inflight.get(key)
                        still_running = future is not None and not future.done()
                    if still_running:
                        continue
                    job.status = "failed"
                    job.error = "任务执行超时，请重试。"
                    job.completed_at = now_utc()
                    changed = True

            workflow_cutoff = now_utc() - timedelta(seconds=self.workflow_timeout_seconds)
            workflows = (
                db.query(WorkflowRun)
                .filter(WorkflowRun.status == "running")
                .filter(WorkflowRun.started_at.isnot(None))
                .filter(WorkflowRun.started_at < workflow_cutoff)
                .all()
            )
            for run in workflows:
                run.status = "failed"
                run.error = "工作流执行超时，请从失败节点重试。"
                run.completed_at = now_utc()
                run.updated_at = now_utc()
                running_nodes = (
                    db.query(WorkflowRunNode)
                    .filter(WorkflowRunNode.run_id == run.id, WorkflowRunNode.status == "running")
                    .all()
                )
                for node in running_nodes:
                    node.status = "failed"
                    node.error = run.error
                    node.completed_at = now_utc()
                changed = True
            presentation_cutoff = now_utc() - timedelta(seconds=self.presentation_timeout_seconds)
            presentations = (
                db.query(PresentationJob)
                .filter(PresentationJob.status == "running")
                .filter(PresentationJob.started_at.isnot(None))
                .filter(PresentationJob.started_at < presentation_cutoff)
                .all()
            )
            for job in presentations:
                key = ("presentation", job.id)
                with self._lock:
                    future = self._inflight.get(key)
                    still_running = future is not None and not future.done()
                if still_running:
                    continue
                job.status = "failed"
                job.stage = "failed"
                job.error = "PPT 生成超时，请重试。"
                job.completed_at = now_utc()
                changed = True
            if changed:
                db.commit()
        except Exception:
            logger.exception("Failed timeout sweep")
            db.rollback()
        finally:
            db.close()

    def _enqueue_due_schedules(self) -> None:
        db = SessionLocal()
        try:
            due = (
                db.query(WorkflowSchedule)
                .filter(WorkflowSchedule.enabled.is_(True))
                .filter(WorkflowSchedule.next_run_at.isnot(None))
                .filter(WorkflowSchedule.next_run_at <= now_utc())
                .order_by(WorkflowSchedule.next_run_at.asc(), WorkflowSchedule.id.asc())
                .limit(20)
                .all()
            )
            for schedule in due:
                schedule_id = schedule.id
                try:
                    run = create_run_from_schedule(db, schedule, advance_schedule=True)
                    db.commit()
                    logger.info("Scheduled workflow enqueued schedule=%s run=%s", schedule_id, run.id)
                except Exception:
                    logger.exception("Failed to enqueue workflow schedule=%s; disabling it", schedule_id)
                    db.rollback()
                    broken = db.get(WorkflowSchedule, schedule_id)
                    if broken is not None:
                        broken.enabled = False
                        broken.updated_at = now_utc()
                        db.commit()
        except Exception:
            logger.exception("Failed schedule sweep")
            db.rollback()
        finally:
            db.close()

    def _dispatch_available(self) -> None:
        if self._executor is None:
            return
        free_slots = self.concurrency - self._active_count()
        if free_slots <= 0:
            return

        for _ in range(free_slots):
            claimed = self._claim_next_job()
            if claimed is None:
                return
            kind, job_id = claimed
            runners = {
                "chat": run_chat_job,
                "image": run_image_job,
                "presentation": generate_presentation,
                "workflow": run_workflow_run,
            }
            runner = runners[kind]
            future = self._executor.submit(runner, job_id)
            with self._lock:
                self._inflight[(kind, job_id)] = future

    def _claim_next_job(self) -> tuple[str, int] | None:
        """Claim the oldest pending chat, image, or workflow job."""
        db = SessionLocal()
        try:
            with self._lock:
                active_ids: dict[str, list[int]] = {"chat": [], "image": [], "presentation": [], "workflow": []}
                for (kind, job_id), future in self._inflight.items():
                    if not future.done():
                        active_ids[kind].append(job_id)

            chat_query = db.query(ChatJob).filter(ChatJob.status == "pending")
            if active_ids["chat"]:
                chat_query = chat_query.filter(ChatJob.id.notin_(active_ids["chat"]))
            chat = chat_query.order_by(ChatJob.created_at.asc(), ChatJob.id.asc()).first()

            image_query = db.query(ImageJob).filter(ImageJob.status == "pending")
            if active_ids["image"]:
                image_query = image_query.filter(ImageJob.id.notin_(active_ids["image"]))
            image = image_query.order_by(ImageJob.created_at.asc(), ImageJob.id.asc()).first()

            presentation_query = db.query(PresentationJob).filter(PresentationJob.status == "pending")
            if active_ids["presentation"]:
                presentation_query = presentation_query.filter(PresentationJob.id.notin_(active_ids["presentation"]))
            presentation = presentation_query.order_by(PresentationJob.created_at.asc(), PresentationJob.id.asc()).first()

            workflow_query = db.query(WorkflowRun).filter(WorkflowRun.status == "pending")
            if active_ids["workflow"]:
                workflow_query = workflow_query.filter(WorkflowRun.id.notin_(active_ids["workflow"]))
            workflow = workflow_query.order_by(WorkflowRun.created_at.asc(), WorkflowRun.id.asc()).first()

            candidates = [("chat", chat), ("image", image), ("presentation", presentation), ("workflow", workflow)]
            available = [(kind, job) for kind, job in candidates if job is not None]
            if not available:
                return None

            priority = {"chat": 0, "image": 1, "presentation": 2, "workflow": 3}
            kind, job = min(
                available,
                key=lambda item: (
                    _as_utc(item[1].created_at) or datetime.min.replace(tzinfo=timezone.utc),
                    priority[item[0]],
                    item[1].id,
                ),
            )

            job.status = "running"
            job.started_at = now_utc()
            job.error = ""
            db.commit()
            return kind, job.id
        except Exception:
            logger.exception("Failed to claim job")
            db.rollback()
            return None
        finally:
            db.close()


job_worker = JobWorker()
