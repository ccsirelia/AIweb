from __future__ import annotations

import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from routes.presentations import (
    _parse_slide_count,
    _validate_pptx_archive,
    delete_presentation_job,
    get_presentation_job,
)


class PresentationJobRouteTests(unittest.TestCase):
    def test_slide_count_accepts_full_supported_range(self) -> None:
        self.assertEqual(_parse_slide_count("5"), 5)
        self.assertEqual(_parse_slide_count("100"), 100)

    def test_slide_count_rejects_out_of_range_or_non_numeric_values(self) -> None:
        for value in ("4", "101", "8.5", "abc"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                _parse_slide_count(value)

    @staticmethod
    def _write_minimal_pptx(path: Path, *, duplicate_slide: bool = False) -> None:
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("[Content_Types].xml", "<Types />")
            archive.writestr("ppt/presentation.xml", "<p:presentation xmlns:p='urn:p' />")
            archive.writestr("ppt/slides/slide1.xml", "<p:sld xmlns:p='urn:p' />")
            if duplicate_slide:
                archive.writestr("ppt/slides/slide1.xml", "<p:sld xmlns:p='urn:p'>duplicate</p:sld>")

    def test_pptx_upload_archive_accepts_minimal_structure(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "valid.pptx"
            self._write_minimal_pptx(path)
            _validate_pptx_archive(path)

    def test_pptx_upload_archive_rejects_duplicate_members(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "duplicate.pptx"
            self._write_minimal_pptx(path, duplicate_slide=True)
            with self.assertRaises(ValueError):
                _validate_pptx_archive(path)

    def test_running_job_can_be_polled(self) -> None:
        job = SimpleNamespace(id=7, user_id=3, status="running")
        db = SimpleNamespace(get=lambda _model, _job_id: job)
        user = SimpleNamespace(id=3)
        expected = SimpleNamespace(id=7, status="running")
        with patch("routes.presentations._job_to_out", return_value=expected):
            result = get_presentation_job(7, db, user)
        self.assertIs(result, expected)

    def test_running_job_still_cannot_be_deleted(self) -> None:
        job = SimpleNamespace(id=7, user_id=3, status="running")
        db = SimpleNamespace(get=lambda _model, _job_id: job)
        user = SimpleNamespace(id=3)
        with self.assertRaises(HTTPException) as raised:
            delete_presentation_job(7, db, user)
        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
