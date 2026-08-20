from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[2]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from template_fill_pptx.cli import _timestamped_pptx_path  # noqa: E402


class CliOutputPathTests(unittest.TestCase):
    def test_two_same_second_output_paths_are_unique(self) -> None:
        first = _timestamped_pptx_path(Path("filled.pptx"))
        second = _timestamped_pptx_path(Path("filled.pptx"))
        self.assertNotEqual(first, second)
        self.assertRegex(first.stem, r"^filled_\d{8}_\d{6}_[0-9a-f]{12}$")

    def test_timestamp_only_name_receives_unique_token(self) -> None:
        result = _timestamped_pptx_path(Path("filled_20260820_120000.pptx"))
        self.assertRegex(result.stem, r"^filled_20260820_120000_[0-9a-f]{12}$")

    def test_fully_unique_name_is_preserved(self) -> None:
        path = Path("filled_20260820_120000_123456abcdef.pptx")
        self.assertEqual(_timestamped_pptx_path(path), path)


if __name__ == "__main__":
    unittest.main()
