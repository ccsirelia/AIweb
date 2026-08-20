from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[2]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from template_fill_pptx.applier import apply_plan  # noqa: E402
from template_fill_pptx.checker import check_plan  # noqa: E402
from template_fill_pptx.limits import MAX_PLAN_SLIDES  # noqa: E402


class PlanLimitTests(unittest.TestCase):
    @staticmethod
    def _plan(count: int) -> dict:
        return {"slides": [{"source_slide": 1} for _ in range(count)]}

    def test_checker_accepts_limit(self) -> None:
        report = check_plan({"slides": []}, self._plan(MAX_PLAN_SLIDES))
        self.assertFalse(
            any(item.get("code") == "plan_slide_limit_exceeded" for item in report["results"])
        )

    def test_checker_rejects_above_limit(self) -> None:
        report = check_plan({"slides": []}, self._plan(MAX_PLAN_SLIDES + 1))
        self.assertEqual(report["summary"]["error"], 1)
        self.assertEqual(report["results"][0]["code"], "plan_slide_limit_exceeded")

    def test_applier_rejects_above_limit_before_reading_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaisesRegex(RuntimeError, "maximum is 100"):
                apply_plan(
                    Path(temp_dir) / "missing.pptx",
                    self._plan(MAX_PLAN_SLIDES + 1),
                    Path(temp_dir) / "output.pptx",
                )


if __name__ == "__main__":
    unittest.main()
