from __future__ import annotations

import unittest
from concurrent.futures import Future
from datetime import timedelta
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database.models import ImageJob, UserAccount, now_utc
from database.session import Base
from services import job_worker as worker_module
from services.job_worker import JobWorker


class JobWorkerClaimTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.Session = sessionmaker(bind=engine, expire_on_commit=False)

    def test_oldest_pending_inflight_does_not_block_next_job(self) -> None:
        db = self.Session()
        user = UserAccount(
            username="worker-user",
            name="Worker User",
            email="worker@example.com",
            password_hash="test",
        )
        db.add(user)
        db.flush()
        oldest = ImageJob(
            user_id=user.id,
            prompt="oldest",
            style="写实",
            size="1024x1024",
            provider="openai",
            status="pending",
            created_at=now_utc() - timedelta(minutes=2),
        )
        next_job = ImageJob(
            user_id=user.id,
            prompt="next",
            style="写实",
            size="1024x1024",
            provider="openai",
            status="pending",
            created_at=now_utc() - timedelta(minutes=1),
        )
        db.add_all([oldest, next_job])
        db.commit()
        oldest_id = oldest.id
        next_id = next_job.id
        db.close()

        worker = JobWorker()
        active_future: Future[None] = Future()
        worker._inflight[("image", oldest_id)] = active_future
        try:
            with patch.object(worker_module, "SessionLocal", self.Session):
                claimed = worker._claim_next_job()
        finally:
            active_future.cancel()

        self.assertEqual(claimed, ("image", next_id))
        db = self.Session()
        self.assertEqual(db.get(ImageJob, oldest_id).status, "pending")
        self.assertEqual(db.get(ImageJob, next_id).status, "running")
        db.close()


if __name__ == "__main__":
    unittest.main()
