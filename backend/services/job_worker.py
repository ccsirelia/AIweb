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

from database.models import ChatJob, ImageJob, now_utc
from database.session import SessionLocal
from services.chat_job_service import run_chat_job
from services.image_job_service import run_image_job

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
        """On process start, any previous running job has no live executor → fail it.

        Pending jobs are left for the new worker to claim.
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

            if stale_chat or stale_image:
                db.commit()
                logger.warning(
                    "Recovered stale running jobs after restart: chat=%s image=%s",
                    len(stale_chat),
                    len(stale_image),
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
            if changed:
                db.commit()
        except Exception:
            logger.exception("Failed timeout sweep")
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
            runner = run_chat_job if kind == "chat" else run_image_job
            future = self._executor.submit(runner, job_id)
            with self._lock:
                self._inflight[(kind, job_id)] = future

    def _claim_next_job(self) -> tuple[str, int] | None:
        """Claim oldest pending chat or image job (chat preferred when equal age)."""
        db = SessionLocal()
        try:
            chat = (
                db.query(ChatJob)
                .filter(ChatJob.status == "pending")
                .order_by(ChatJob.created_at.asc(), ChatJob.id.asc())
                .first()
            )
            image = (
                db.query(ImageJob)
                .filter(ImageJob.status == "pending")
                .order_by(ImageJob.created_at.asc(), ImageJob.id.asc())
                .first()
            )

            kind: str | None = None
            job = None
            if chat and image:
                chat_ts = _as_utc(chat.created_at) or datetime.min.replace(tzinfo=timezone.utc)
                image_ts = _as_utc(image.created_at) or datetime.min.replace(tzinfo=timezone.utc)
                if chat_ts <= image_ts:
                    kind, job = "chat", chat
                else:
                    kind, job = "image", image
            elif chat:
                kind, job = "chat", chat
            elif image:
                kind, job = "image", image
            else:
                return None

            assert kind is not None and job is not None
            with self._lock:
                if (kind, job.id) in self._inflight and not self._inflight[(kind, job.id)].done():
                    return None

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
