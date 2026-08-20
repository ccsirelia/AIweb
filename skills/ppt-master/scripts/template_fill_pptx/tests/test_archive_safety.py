from __future__ import annotations

import io
import sys
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[2]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from template_fill_pptx.applier import apply_plan  # noqa: E402
from template_fill_pptx.archive_safety import (  # noqa: E402
    PPTX_ARCHIVE_LIMITS,
    UnsafeZipArchiveError,
    ZipArchiveLimits,
    _validate_member_name,
    validate_zip_members,
)
from template_fill_pptx.chart_fill import _rewrite_chart_workbook  # noqa: E402


def _limits(**overrides: int | float) -> ZipArchiveLimits:
    values: dict[str, int | float] = {
        "max_members": 10,
        "max_member_uncompressed_bytes": 1_000,
        "max_total_uncompressed_bytes": 2_000,
        "max_compression_ratio": 20.0,
        "compression_ratio_min_uncompressed_bytes": 1,
    }
    values.update(overrides)
    return ZipArchiveLimits(**values)  # type: ignore[arg-type]


def _zip_bytes(
    members: list[tuple[str, bytes]],
    *,
    compression: int = zipfile.ZIP_STORED,
) -> bytes:
    payload = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(payload, "w", compression=compression) as archive:
            for name, data in members:
                archive.writestr(name, data)
    return payload.getvalue()


def _validate(payload: bytes, limits: ZipArchiveLimits) -> None:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        validate_zip_members(archive, limits=limits, label="test archive")


class ArchiveSafetyTests(unittest.TestCase):
    def test_rejects_member_count(self) -> None:
        payload = _zip_bytes([("a", b"1"), ("b", b"2")])
        with self.assertRaisesRegex(
            UnsafeZipArchiveError,
            "zip_member_count_exceeded",
        ):
            _validate(payload, _limits(max_members=1))

    def test_rejects_duplicate_member_names(self) -> None:
        payload = _zip_bytes([("same.xml", b"first"), ("same.xml", b"second")])
        with self.assertRaisesRegex(UnsafeZipArchiveError, "zip_duplicate_member"):
            _validate(payload, _limits())

    def test_rejects_unsafe_member_paths(self) -> None:
        for member_name in (
            "../evil.xml",
            "/ppt/evil.xml",
            "C:/evil.xml",
            "%2e%2e/evil.xml",
        ):
            with self.subTest(member_name=member_name):
                payload = _zip_bytes([(member_name, b"payload")])
                with self.assertRaisesRegex(
                    UnsafeZipArchiveError,
                    "zip_invalid_member_path",
                ):
                    _validate(payload, PPTX_ARCHIVE_LIMITS)

        # Python's zipfile normalizes backslashes to slashes on Windows while
        # reading, so exercise the platform-independent name guard directly.
        with self.assertRaisesRegex(UnsafeZipArchiveError, "zip_invalid_member_path"):
            _validate_member_name("ppt\\evil.xml", label="test archive")

    def test_rejects_oversized_member(self) -> None:
        payload = _zip_bytes([("large.bin", b"1234")])
        with self.assertRaisesRegex(UnsafeZipArchiveError, "zip_member_size_exceeded"):
            _validate(payload, _limits(max_member_uncompressed_bytes=3))

    def test_rejects_oversized_total(self) -> None:
        payload = _zip_bytes([("a.bin", b"123"), ("b.bin", b"456")])
        with self.assertRaisesRegex(UnsafeZipArchiveError, "zip_total_size_exceeded"):
            _validate(
                payload,
                _limits(
                    max_member_uncompressed_bytes=10,
                    max_total_uncompressed_bytes=5,
                ),
            )

    def test_rejects_extreme_compression_ratio(self) -> None:
        payload = _zip_bytes(
            [("bomb.bin", b"0" * 4_096)],
            compression=zipfile.ZIP_DEFLATED,
        )
        with self.assertRaisesRegex(
            UnsafeZipArchiveError,
            "zip_compression_ratio_exceeded",
        ):
            _validate(
                payload,
                _limits(
                    max_member_uncompressed_bytes=10_000,
                    max_total_uncompressed_bytes=10_000,
                    max_compression_ratio=2,
                ),
            )

    def test_applier_rejects_unsafe_pptx_before_bulk_read(self) -> None:
        payload = _zip_bytes(
            [("duplicate.xml", b"first"), ("duplicate.xml", b"second")]
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "unsafe.pptx"
            source.write_bytes(payload)
            with self.assertRaisesRegex(UnsafeZipArchiveError, "zip_duplicate_member"):
                apply_plan(
                    source,
                    {"slides": [{"source_slide": 1}]},
                    Path(temp_dir) / "output.pptx",
                )

    def test_embedded_workbook_rejects_unsafe_zip_before_bulk_read(self) -> None:
        payload = _zip_bytes(
            [("duplicate.xml", b"first"), ("duplicate.xml", b"second")]
        )
        with self.assertRaisesRegex(UnsafeZipArchiveError, "zip_duplicate_member"):
            _rewrite_chart_workbook(payload, {"categories": ["A"], "series": []})


if __name__ == "__main__":
    unittest.main()
