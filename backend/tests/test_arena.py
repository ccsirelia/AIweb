import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from pydantic import ValidationError

from routes.arena import (
    ArenaCompareRequest,
    ArenaContestant,
    ArenaResult,
    ArenaTokenUsage,
    _run_contestant,
    compare_models,
)


class _FakeService:
    text_model = "model-a"

    def __init__(self, provider: str, text_model: str) -> None:
        self.provider = provider
        self.text_model = text_model

    def chat(self, prompt: str, history=None):
        self.prompt = prompt
        self.history = history
        return {
            "text": "真实候选结果",
            "model": self.text_model,
            "prompt_tokens": 12,
            "completion_tokens": 8,
            "total_tokens": 20,
        }


class ArenaTests(unittest.TestCase):
    def test_request_enforces_prompt_and_contestant_bounds(self) -> None:
        payload = ArenaCompareRequest(
            prompt="  同题比较  ",
            contestants=[ArenaContestant(), ArenaContestant(provider="grok")],
        )
        self.assertEqual(payload.prompt, "同题比较")

        with self.assertRaises(ValidationError):
            ArenaCompareRequest(prompt="x", contestants=[ArenaContestant()])
        with self.assertRaises(ValidationError):
            ArenaCompareRequest(
                prompt="x" * 4001,
                contestants=[ArenaContestant(), ArenaContestant()],
            )

    @patch("routes.arena.OpenAIService", _FakeService)
    def test_contestant_returns_real_text_and_usage(self) -> None:
        result = _run_contestant(
            1,
            "制定发布计划",
            ArenaContestant(provider="openai", role="务实交付负责人"),
            "model-a",
        )
        self.assertIsNone(result.error)
        self.assertEqual(result.text, "真实候选结果")
        self.assertEqual(result.contestant_index, 1)
        self.assertEqual(result.tokens.total_tokens, 20)

    @patch("routes.arena.OpenAIService", side_effect=RuntimeError("secret upstream https://internal.test"))
    def test_contestant_does_not_expose_internal_errors(self, _service: MagicMock) -> None:
        result = _run_contestant(0, "任务", ArenaContestant(), "model-a")
        self.assertEqual(result.error, "候选模型执行失败，请稍后重试。")
        self.assertNotIn("internal.test", result.error or "")

    @patch("routes.arena.record_token_usage")
    @patch("routes.arena.resolve_chat_model", side_effect=["model-a", "model-b"])
    @patch("routes.arena._run_contestant")
    def test_compare_records_each_success_without_saving_chat_history(
        self,
        run_contestant: MagicMock,
        _resolve_model: MagicMock,
        record_usage: MagicMock,
    ) -> None:
        generated = {
            0: ArenaResult(
                contestant_index=0,
                text="A",
                model="model-a",
                provider="openai",
                latency_ms=20,
                tokens=ArenaTokenUsage(prompt_tokens=3, completion_tokens=2, total_tokens=5),
            ),
            1: ArenaResult(
                contestant_index=1,
                text="B",
                model="model-b",
                provider="grok",
                latency_ms=25,
                tokens=ArenaTokenUsage(prompt_tokens=4, completion_tokens=3, total_tokens=7),
            ),
        }
        run_contestant.side_effect = lambda index, *_args: generated[index]
        db = MagicMock()
        payload = ArenaCompareRequest(
            prompt="比较任务",
            contestants=[
                ArenaContestant(provider="openai", model="model-a"),
                ArenaContestant(provider="grok", model="model-b"),
            ],
        )

        response = compare_models(payload, db=db, user=SimpleNamespace(id=7))

        self.assertEqual([item.text for item in response.results], ["A", "B"])
        self.assertEqual(record_usage.call_count, 2)
        db.commit.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
