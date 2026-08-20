"""Bound ZIP archive reads used by the native PPTX fill runtime.

OOXML files are ZIP containers.  Validate their central-directory metadata
before any code materializes every member in memory so an uploaded template or
embedded workbook cannot expand without a predictable upper bound.
"""

from __future__ import annotations

import zipfile
from dataclasses import dataclass
from urllib.parse import unquote


_MIB = 1024 * 1024


@dataclass(frozen=True)
class ZipArchiveLimits:
    """Resource limits for one ZIP-backed OOXML package."""

    max_members: int
    max_member_uncompressed_bytes: int
    max_total_uncompressed_bytes: int
    max_compression_ratio: float
    compression_ratio_min_uncompressed_bytes: int = _MIB

    def __post_init__(self) -> None:
        for field_name in (
            "max_members",
            "max_member_uncompressed_bytes",
            "max_total_uncompressed_bytes",
            "compression_ratio_min_uncompressed_bytes",
        ):
            if getattr(self, field_name) < 0:
                raise ValueError(f"{field_name} must not be negative")
        if self.max_compression_ratio <= 0:
            raise ValueError("max_compression_ratio must be positive")


PPTX_ARCHIVE_LIMITS = ZipArchiveLimits(
    max_members=10_000,
    max_member_uncompressed_bytes=128 * _MIB,
    max_total_uncompressed_bytes=256 * _MIB,
    max_compression_ratio=200.0,
)

EMBEDDED_XLSX_ARCHIVE_LIMITS = ZipArchiveLimits(
    max_members=4_096,
    max_member_uncompressed_bytes=32 * _MIB,
    max_total_uncompressed_bytes=64 * _MIB,
    max_compression_ratio=200.0,
)


class UnsafeZipArchiveError(RuntimeError):
    """Raised when an OOXML ZIP package exceeds a safety boundary."""


def _reject(label: str, code: str, detail: str) -> None:
    raise UnsafeZipArchiveError(f"Unsafe {label}: {detail} [{code}]")


def _validate_member_name(name: str, *, label: str) -> None:
    """Reject ZIP names that are not safe OPC part names."""
    decoded = unquote(name)
    for candidate in (name, decoded):
        stripped = candidate.rstrip("/")
        parts = stripped.split("/") if stripped else []
        if (
            not stripped
            or candidate.startswith("/")
            or "\\" in candidate
            or any(part in {"", ".", ".."} for part in parts)
            or (parts and len(parts[0]) == 2 and parts[0][0].isalpha() and parts[0][1] == ":")
        ):
            _reject(
                label,
                "zip_invalid_member_path",
                f"member {name!r} is not a package-root-relative OPC part name",
            )


def validate_zip_members(
    archive: zipfile.ZipFile,
    *,
    limits: ZipArchiveLimits,
    label: str,
) -> tuple[zipfile.ZipInfo, ...]:
    """Validate ZIP members before callers read their uncompressed payloads.

    The returned immutable roster is the exact set the caller should read.  A
    duplicate filename is rejected because name-based reads and dictionaries
    otherwise resolve the same archive ambiguously.
    """
    members = tuple(archive.infolist())
    if len(members) > limits.max_members:
        _reject(
            label,
            "zip_member_count_exceeded",
            f"{len(members)} members exceed the limit of {limits.max_members}",
        )

    seen_names: set[str] = set()
    total_uncompressed = 0
    for member in members:
        name = member.filename
        _validate_member_name(name, label=label)
        if name in seen_names:
            _reject(
                label,
                "zip_duplicate_member",
                f"duplicate member name {name!r}",
            )
        seen_names.add(name)

        uncompressed_size = member.file_size
        compressed_size = member.compress_size
        if uncompressed_size < 0 or compressed_size < 0:
            _reject(
                label,
                "zip_invalid_member_size",
                f"member {name!r} has an invalid size",
            )
        if uncompressed_size > limits.max_member_uncompressed_bytes:
            _reject(
                label,
                "zip_member_size_exceeded",
                (
                    f"member {name!r} expands to {uncompressed_size} bytes; "
                    f"limit is {limits.max_member_uncompressed_bytes}"
                ),
            )

        total_uncompressed += uncompressed_size
        if total_uncompressed > limits.max_total_uncompressed_bytes:
            _reject(
                label,
                "zip_total_size_exceeded",
                (
                    f"members expand to more than "
                    f"{limits.max_total_uncompressed_bytes} bytes"
                ),
            )

        if (
            uncompressed_size >= limits.compression_ratio_min_uncompressed_bytes
            and uncompressed_size > 0
        ):
            if compressed_size == 0:
                _reject(
                    label,
                    "zip_compression_ratio_exceeded",
                    f"member {name!r} has a zero-byte compressed payload",
                )
            compression_ratio = uncompressed_size / compressed_size
            if compression_ratio > limits.max_compression_ratio:
                _reject(
                    label,
                    "zip_compression_ratio_exceeded",
                    (
                        f"member {name!r} has compression ratio "
                        f"{compression_ratio:.1f}; limit is "
                        f"{limits.max_compression_ratio:g}"
                    ),
                )

    return members
