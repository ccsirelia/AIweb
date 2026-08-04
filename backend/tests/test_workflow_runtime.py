from __future__ import annotations

import threading
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database.models import (
    ImageRecord,
    TokenUsageRecord,
    UserAccount,
    WorkflowRun,
    WorkflowRunNode,
    WorkflowSchedule,
    now_utc,
)
from database.session import Base
from models.schemas import WorkflowRunCreate
from services.job_worker import JobWorker
from services.workflow_runtime_service import (
    approve_workflow_run,
    create_workflow_run_snapshot,
    next_schedule_occurrence,
    pause_workflow_run,
    resume_workflow_run,
    retry_workflow_run,
    run_workflow_run,
)


class FakeWorkflowService:
    calls: list[str] = []
    lock = threading.Lock()

    def __init__(self, **_kwargs: object) -> None:
        pass

    def chat(self, prompt: str) -> dict[str, object]:
        with self.lock:
            self.calls.append(prompt)
            call_number = len(self.calls)
        if "质量审查器" in prompt:
            text = "VERDICT: PASS\n- 目标已覆盖"
        else:
            text = (
                "<ai_thought_summary>\n- internal summary\n</ai_thought_summary>\n"
                f"<ai_answer>\nresult-{call_number}\n</ai_answer>"
            )
        return {
            "text": text,
            "prompt_tokens": 3,
            "completion_tokens": 2,
            "total_tokens": 5,
        }


class RetryQualityService(FakeWorkflowService):
    def chat(self, prompt: str) -> dict[str, object]:
        with self.lock:
            self.calls.append(prompt)
        if "质量审查器" in prompt:
            text = "VERDICT: FAIL\n- 补充明确结论"
        elif "上一次质量检查反馈" in prompt:
            text = "revised-synthesis"
        elif "综合工作流" in prompt:
            text = "initial-synthesis"
        else:
            text = "branch-result"
        return {"text": text, "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}


class FailingWorkflowService(FakeWorkflowService):
    def chat(self, _prompt: str) -> dict[str, object]:
        raise RuntimeError("secret upstream detail https://internal.example.test")


class BlockingWorkflowService(FakeWorkflowService):
    entered = threading.Event()
    release = threading.Event()

    def chat(self, _prompt: str) -> dict[str, object]:
        self.entered.set()
        self.release.wait(timeout=5)
        return {"text": "late-result", "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}


class PausingQualityService(FakeWorkflowService):
    retry_entered = threading.Event()
    retry_release = threading.Event()
    retry_calls = 0

    def chat(self, prompt: str) -> dict[str, object]:
        if "质量审查器" in prompt:
            text = "VERDICT: FAIL\n- revise once"
        elif "上一次质量检查反馈" in prompt:
            type(self).retry_calls += 1
            self.retry_entered.set()
            self.retry_release.wait(timeout=5)
            text = "paused-revision"
        elif "综合工作流" in prompt:
            text = "initial-synthesis"
        else:
            text = "branch"
        return {"text": text, "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}


class ImageWorkflowService(FakeWorkflowService):
    image_prompts: list[str] = []

    def __init__(self, **_kwargs: object) -> None:
        self.image_model = "fake-image-model"

    def generate_image(self, payload: object) -> dict[str, object]:
        prompt = str(getattr(payload, "prompt", ""))
        type(self).image_prompts.append(prompt)
        return {
            "image_base64": "ZmFrZS1pbWFnZQ==",
            "model": self.image_model,
            "prompt_tokens": 7,
            "completion_tokens": 11,
            "total_tokens": 18,
        }


class FailingImageWorkflowService(ImageWorkflowService):
    def generate_image(self, _payload: object) -> dict[str, object]:
        raise RuntimeError("secret image upstream https://internal.example.test")


class BlockingImageWorkflowService(ImageWorkflowService):
    entered = threading.Event()
    release = threading.Event()

    def generate_image(self, payload: object) -> dict[str, object]:
        self.entered.set()
        self.release.wait(timeout=5)
        return super().generate_image(payload)


class BlockingFailingImageWorkflowService(ImageWorkflowService):
    entered = threading.Event()
    release = threading.Event()

    def generate_image(self, _payload: object) -> dict[str, object]:
        self.entered.set()
        self.release.wait(timeout=5)
        raise RuntimeError("late secret image failure https://internal.example.test")


class WorkflowRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.Session = sessionmaker(bind=engine, expire_on_commit=False)
        db = self.Session()
        self.user = UserAccount(
            username="workflow-user",
            name="Workflow User",
            email="workflow@example.com",
            password_hash="test",
        )
        db.add(self.user)
        db.commit()
        db.close()
        FakeWorkflowService.calls = []
        RetryQualityService.calls = []
        BlockingWorkflowService.entered.clear()
        BlockingWorkflowService.release.clear()
        PausingQualityService.retry_entered.clear()
        PausingQualityService.retry_release.clear()
        PausingQualityService.retry_calls = 0
        ImageWorkflowService.image_prompts = []
        BlockingImageWorkflowService.image_prompts = []
        BlockingImageWorkflowService.entered.clear()
        BlockingImageWorkflowService.release.clear()
        BlockingFailingImageWorkflowService.entered.clear()
        BlockingFailingImageWorkflowService.release.clear()

    def create_run(
        self,
        *,
        mode: str = "sequential",
        approval: bool = False,
        quality: bool = False,
        target: str = "chat",
    ) -> int:
        db = self.Session()
        run = create_workflow_run_snapshot(
            db,
            user_id=self.user.id,
            workflow_id="test-flow",
            name="Test Flow",
            prompt="Produce a useful result.",
            steps=[
                {"id": "research", "title": "Research", "description": "Find the key facts."},
                {"id": "draft", "title": "Draft", "description": "Write the final draft."},
            ],
            provider="openai",
            model="fake-model",
            execution_mode=mode,
            approval_required=approval,
            quality_gate=quality,
            target=target,
        )
        db.commit()
        run_id = run.id
        db.close()
        return run_id

    def test_schema_rejects_duplicate_or_excessive_steps(self) -> None:
        base = {
            "workflow_id": "flow",
            "name": "Flow",
            "prompt": "Goal",
            "steps": [
                {"id": "same", "title": "One", "description": "First"},
                {"id": "same", "title": "Two", "description": "Second"},
            ],
        }
        with self.assertRaises(ValueError):
            WorkflowRunCreate.model_validate(base)

        base["steps"] = [{"id": "valid", "title": "Valid", "description": "Do it"}]
        base["provider"] = "unsupported-provider"
        with self.assertRaises(ValueError):
            WorkflowRunCreate.model_validate(base)

        base["steps"] = [
            {"id": f"step-{index}", "title": f"Step {index}", "description": "Do it"}
            for index in range(17)
        ]
        base["provider"] = "openai"
        with self.assertRaises(ValueError):
            WorkflowRunCreate.model_validate(base)

        base["steps"] = [{"id": "valid", "title": "Valid", "description": "Do it"}]
        base["target"] = "video"
        with self.assertRaises(ValueError):
            WorkflowRunCreate.model_validate(base)

    def test_image_target_generates_record_usage_and_detail_only_payload(self) -> None:
        run_id = self.create_run(target="image", quality=True)
        run_workflow_run(run_id, session_factory=self.Session, service_factory=ImageWorkflowService)

        from routes.workflow_runtime import run_to_out, run_to_summary

        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        record = db.get(ImageRecord, run.image_record_id)
        image_node = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.node_type == "image_generation")
            .one()
        )
        self.assertEqual(run.target, "image")
        self.assertEqual(run.status, "completed")
        self.assertEqual(run.final_output, "result-2")
        self.assertIsNotNone(record)
        self.assertEqual(record.prompt, "result-2")
        self.assertEqual(record.image_base64, "ZmFrZS1pbWFnZQ==")
        self.assertEqual(ImageWorkflowService.image_prompts, ["result-2"])
        self.assertEqual(image_node.status, "completed")
        self.assertEqual(image_node.output_text, str(record.id))
        self.assertEqual(image_node.total_tokens, 18)
        image_usage = (
            db.query(TokenUsageRecord)
            .filter(TokenUsageRecord.user_id == self.user.id, TokenUsageRecord.source == "image")
            .one()
        )
        self.assertEqual(image_usage.model, "fake-image-model")
        self.assertEqual(image_usage.total_tokens, 18)

        detail = run_to_out(db, run).model_dump()
        summary = run_to_summary(run).model_dump()
        self.assertEqual(detail["image_record_id"], record.id)
        self.assertEqual(detail["image_base64"], record.image_base64)
        self.assertTrue(detail["nodes"])
        self.assertNotIn("image_base64", summary)
        self.assertNotIn("nodes", summary)
        db.close()

    def test_image_failure_is_sanitized_and_retryable_from_image_node(self) -> None:
        run_id = self.create_run(target="image")
        with self.assertLogs("services.workflow_runtime_service", level="ERROR"):
            run_workflow_run(run_id, session_factory=self.Session, service_factory=FailingImageWorkflowService)

        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        image_node = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.node_type == "image_generation")
            .one()
        )
        self.assertEqual(run.status, "failed")
        self.assertEqual(run.error, "工作流图片生成失败，请稍后重试。")
        self.assertNotIn("internal.example", run.error)
        self.assertEqual(image_node.status, "failed")
        retry_workflow_run(db, run)
        self.assertEqual(run.status, "pending")
        self.assertEqual(image_node.status, "pending")
        steps = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.node_type == "step")
            .all()
        )
        self.assertTrue(all(node.status == "completed" for node in steps))
        db.close()

    def test_late_image_result_cannot_overwrite_retry_state(self) -> None:
        run_id = self.create_run(target="image")
        runner = threading.Thread(
            target=run_workflow_run,
            kwargs={
                "run_id": run_id,
                "session_factory": self.Session,
                "service_factory": BlockingImageWorkflowService,
            },
        )
        runner.start()
        self.assertTrue(BlockingImageWorkflowService.entered.wait(timeout=2))

        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        image_node = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.node_type == "image_generation")
            .one()
        )
        run.status = "failed"
        run.error = "工作流执行超时，请从失败节点重试。"
        image_node.status = "failed"
        db.commit()
        retry_workflow_run(db, run, node_key=image_node.node_key)
        db.close()

        BlockingImageWorkflowService.release.set()
        runner.join(timeout=3)
        self.assertFalse(runner.is_alive())
        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        image_node = db.get(WorkflowRunNode, image_node.id)
        self.assertEqual(run.status, "pending")
        self.assertIsNone(run.image_record_id)
        self.assertEqual(image_node.status, "pending")
        self.assertEqual(db.query(ImageRecord).filter(ImageRecord.user_id == self.user.id).count(), 0)
        self.assertEqual(
            db.query(TokenUsageRecord)
            .filter(TokenUsageRecord.user_id == self.user.id, TokenUsageRecord.source == "image")
            .count(),
            0,
        )
        db.close()

    def test_late_image_failure_cannot_overwrite_resumed_state(self) -> None:
        run_id = self.create_run(target="image")
        runner = threading.Thread(
            target=run_workflow_run,
            kwargs={
                "run_id": run_id,
                "session_factory": self.Session,
                "service_factory": BlockingFailingImageWorkflowService,
            },
        )
        runner.start()
        self.assertTrue(BlockingFailingImageWorkflowService.entered.wait(timeout=2))

        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        pause_workflow_run(db, run)
        resume_workflow_run(db, run)
        db.close()
        with self.assertLogs("services.workflow_runtime_service", level="ERROR"):
            BlockingFailingImageWorkflowService.release.set()
            runner.join(timeout=3)
        self.assertFalse(runner.is_alive())

        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        image_node = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.node_type == "image_generation")
            .one()
        )
        self.assertEqual(run.status, "pending", run.error)
        self.assertEqual(run.error, "")
        self.assertEqual(image_node.status, "running")
        db.close()

        run_workflow_run(run_id, session_factory=self.Session, service_factory=ImageWorkflowService)
        db = self.Session()
        self.assertEqual(db.get(WorkflowRun, run_id).status, "completed")
        self.assertEqual(db.get(WorkflowRunNode, image_node.id).attempt, 2)
        db.close()

    def test_sequential_run_persists_nodes_usage_and_context(self) -> None:
        run_id = self.create_run()
        run_workflow_run(run_id, session_factory=self.Session, service_factory=FakeWorkflowService)

        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        nodes = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id)
            .order_by(WorkflowRunNode.sort_order)
            .all()
        )
        self.assertIsNotNone(run)
        self.assertEqual(run.status, "completed")
        self.assertEqual(run.current_node_index, 2)
        self.assertEqual(run.final_output, "result-2")
        self.assertEqual([node.status for node in nodes], ["completed", "completed"])
        self.assertEqual([node.attempt for node in nodes], [1, 1])
        self.assertIn("result-1", nodes[1].input_text)
        self.assertEqual(db.query(TokenUsageRecord).filter(TokenUsageRecord.user_id == self.user.id).count(), 2)
        db.close()

    def test_parallel_quality_gate_retries_synthesis_once(self) -> None:
        run_id = self.create_run(mode="parallel", quality=True)
        run_workflow_run(run_id, session_factory=self.Session, service_factory=RetryQualityService)

        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        synthesis = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.node_key == "__synthesis__")
            .one()
        )
        gate = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.node_key == "__quality_gate__")
            .one()
        )
        self.assertEqual(run.status, "completed")
        self.assertEqual(run.quality_status, "retried")
        self.assertEqual(run.final_output, "revised-synthesis")
        self.assertEqual(synthesis.attempt, 2)
        self.assertEqual(gate.attempt, 1)
        db.close()

    def test_approval_and_retry_state_machine(self) -> None:
        run_id = self.create_run(approval=True)
        run_workflow_run(run_id, session_factory=self.Session, service_factory=FakeWorkflowService)
        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        self.assertEqual(run.status, "awaiting_approval")
        approve_workflow_run(db, run)
        db.close()

        run_workflow_run(run_id, session_factory=self.Session, service_factory=FakeWorkflowService)
        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        self.assertEqual(run.status, "completed")
        retry_workflow_run(db, run, node_index=1)
        nodes = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.node_type == "step")
            .order_by(WorkflowRunNode.sort_order)
            .all()
        )
        self.assertEqual(run.status, "pending")
        self.assertEqual(nodes[0].status, "completed")
        self.assertEqual(nodes[1].status, "pending")
        db.close()

        run_workflow_run(run_id, session_factory=self.Session, service_factory=FakeWorkflowService)
        db = self.Session()
        retried = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.node_key == "draft")
            .one()
        )
        self.assertEqual(retried.attempt, 2)
        self.assertEqual(db.get(WorkflowRun, run_id).status, "completed")
        db.close()

    def test_pause_resume_and_default_retry_target(self) -> None:
        run_id = self.create_run()
        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        pause_workflow_run(db, run)
        self.assertEqual(run.status, "paused")
        resume_workflow_run(db, run)
        self.assertEqual(run.status, "pending")
        db.close()

        run_workflow_run(run_id, session_factory=self.Session, service_factory=FakeWorkflowService)
        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        retry_workflow_run(db, run)
        nodes = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.node_type == "step")
            .order_by(WorkflowRunNode.sort_order)
            .all()
        )
        self.assertEqual(nodes[0].status, "completed")
        self.assertEqual(nodes[1].status, "pending")
        db.close()

    def test_internal_model_error_is_not_exposed(self) -> None:
        run_id = self.create_run()
        with self.assertLogs("services.workflow_runtime_service", level="ERROR"):
            run_workflow_run(run_id, session_factory=self.Session, service_factory=FailingWorkflowService)
        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        self.assertEqual(run.status, "failed")
        self.assertNotIn("internal.example", run.error)
        self.assertEqual(run.error, "工作流节点执行失败，请稍后重试。")
        db.close()

    def test_late_result_cannot_overwrite_a_retried_node(self) -> None:
        run_id = self.create_run()
        runner = threading.Thread(
            target=run_workflow_run,
            kwargs={
                "run_id": run_id,
                "session_factory": self.Session,
                "service_factory": BlockingWorkflowService,
            },
        )
        runner.start()
        self.assertTrue(BlockingWorkflowService.entered.wait(timeout=2))

        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        active = (
            db.query(WorkflowRunNode)
            .filter(WorkflowRunNode.run_id == run_id, WorkflowRunNode.status == "running")
            .one()
        )
        run.status = "failed"
        run.error = "工作流执行超时，请从失败节点重试。"
        active.status = "failed"
        db.commit()
        retry_workflow_run(db, run, node_key=active.node_key)
        db.close()

        BlockingWorkflowService.release.set()
        runner.join(timeout=3)
        self.assertFalse(runner.is_alive())
        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        active = db.get(WorkflowRunNode, active.id)
        self.assertEqual(run.status, "pending")
        self.assertEqual(active.status, "pending")
        self.assertEqual(active.output_text, "")
        db.close()

    def test_quality_retry_is_not_repeated_after_pause_and_resume(self) -> None:
        run_id = self.create_run(mode="parallel", quality=True)
        runner = threading.Thread(
            target=run_workflow_run,
            kwargs={
                "run_id": run_id,
                "session_factory": self.Session,
                "service_factory": PausingQualityService,
            },
        )
        runner.start()
        self.assertTrue(PausingQualityService.retry_entered.wait(timeout=2))
        db = self.Session()
        pause_workflow_run(db, db.get(WorkflowRun, run_id))
        db.close()
        PausingQualityService.retry_release.set()
        runner.join(timeout=3)
        self.assertFalse(runner.is_alive())

        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        self.assertEqual(run.status, "paused")
        self.assertEqual(run.quality_status, "retried")
        self.assertEqual(run.final_output, "")
        resume_workflow_run(db, run)
        db.close()

        run_workflow_run(run_id, session_factory=self.Session, service_factory=PausingQualityService)
        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        self.assertEqual(run.status, "completed")
        self.assertEqual(run.final_output, "paused-revision")
        self.assertEqual(PausingQualityService.retry_calls, 1)
        db.close()

    def test_owned_run_lookup_hides_other_accounts(self) -> None:
        from routes.workflow_runtime import owned_run

        run_id = self.create_run()
        db = self.Session()
        other = UserAccount(
            username="other-user",
            name="Other User",
            email="other@example.com",
            password_hash="test",
        )
        db.add(other)
        db.commit()
        with self.assertRaises(HTTPException) as raised:
            owned_run(db, other.id, run_id)
        self.assertEqual(raised.exception.status_code, 404)
        db.close()

    def test_worker_recovers_and_times_out_workflow_runs(self) -> None:
        run_id = self.create_run()
        db = self.Session()
        run = db.get(WorkflowRun, run_id)
        node = db.query(WorkflowRunNode).filter(WorkflowRunNode.run_id == run_id).first()
        run.status = "running"
        node.status = "running"
        db.commit()
        db.close()

        worker = JobWorker()
        import services.job_worker as worker_module

        original_factory = worker_module.SessionLocal
        worker_module.SessionLocal = self.Session
        try:
            with self.assertLogs("services.job_worker", level="WARNING"):
                worker.recover_stale_jobs()
            db = self.Session()
            self.assertEqual(db.get(WorkflowRun, run_id).status, "pending")
            self.assertEqual(db.get(WorkflowRunNode, node.id).status, "pending")
            run = db.get(WorkflowRun, run_id)
            run.status = "running"
            run.started_at = now_utc() - timedelta(seconds=5)
            db.get(WorkflowRunNode, node.id).status = "running"
            db.commit()
            db.close()

            worker.workflow_timeout_seconds = 1
            worker._fail_timed_out_running()
            db = self.Session()
            self.assertEqual(db.get(WorkflowRun, run_id).status, "failed")
            self.assertEqual(db.get(WorkflowRunNode, node.id).status, "failed")
            db.close()
        finally:
            worker_module.SessionLocal = original_factory

    def test_once_schedule_is_enqueued_and_disabled(self) -> None:
        db = self.Session()
        schedule = WorkflowSchedule(
            user_id=self.user.id,
            workflow_id="scheduled-flow",
            target="image",
            name="Scheduled Flow",
            prompt="Scheduled goal",
            steps_json='[{"id":"step","title":"Step","description":"Do it"}]',
            provider="openai",
            model="fake-model",
            execution_mode="sequential",
            approval_required=False,
            quality_gate=False,
            schedule_type="once",
            enabled=True,
            next_run_at=now_utc() - timedelta(minutes=1),
        )
        db.add(schedule)
        db.commit()
        schedule_id = schedule.id
        db.close()

        worker = JobWorker()
        import services.job_worker as worker_module

        original_factory = worker_module.SessionLocal
        worker_module.SessionLocal = self.Session
        try:
            worker._enqueue_due_schedules()
        finally:
            worker_module.SessionLocal = original_factory

        db = self.Session()
        schedule = db.get(WorkflowSchedule, schedule_id)
        self.assertFalse(schedule.enabled)
        self.assertIsNone(schedule.next_run_at)
        self.assertIsNotNone(schedule.last_run_id)
        scheduled_run = db.get(WorkflowRun, schedule.last_run_id)
        self.assertEqual(scheduled_run.status, "pending")
        self.assertEqual(scheduled_run.target, "image")
        db.close()

    def test_schedule_math_skips_missed_intervals(self) -> None:
        now = now_utc()
        daily = next_schedule_occurrence("daily", now - timedelta(days=3, hours=1), now=now)
        weekly = next_schedule_occurrence("weekly", now - timedelta(days=15), now=now)
        self.assertGreater(daily, now)
        self.assertGreater(weekly, now)
        self.assertLessEqual(daily - now, timedelta(days=1))
        self.assertLessEqual(weekly - now, timedelta(days=7))

    def test_sqlite_migration_adds_workflow_target_columns_idempotently(self) -> None:
        import database.init_db as init_module

        temporary = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        temporary.close()
        database_path = Path(temporary.name)
        migration_engine = create_engine(f"sqlite:///{database_path.as_posix()}")
        original_engine = init_module.engine
        try:
            with migration_engine.begin() as connection:
                connection.exec_driver_sql("CREATE TABLE workflow_runs (id INTEGER PRIMARY KEY)")
                connection.exec_driver_sql("CREATE TABLE workflow_schedules (id INTEGER PRIMARY KEY)")
                connection.exec_driver_sql("INSERT INTO workflow_runs (id) VALUES (1)")
                connection.exec_driver_sql("INSERT INTO workflow_schedules (id) VALUES (1)")
            init_module.engine = migration_engine
            init_module.migrate_sqlite_schema()
            init_module.migrate_sqlite_schema()

            run_columns = init_module._columns("workflow_runs")
            schedule_columns = init_module._columns("workflow_schedules")
            self.assertIn("target", run_columns)
            self.assertIn("image_record_id", run_columns)
            self.assertIn("target", schedule_columns)
            with migration_engine.connect() as connection:
                self.assertEqual(connection.exec_driver_sql("SELECT target FROM workflow_runs").scalar_one(), "chat")
                self.assertEqual(
                    connection.exec_driver_sql("SELECT target FROM workflow_schedules").scalar_one(),
                    "chat",
                )
        finally:
            init_module.engine = original_engine
            migration_engine.dispose()
            database_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
