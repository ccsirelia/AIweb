"""apply: edit native PowerPoint chart data on cloned slides.

Every classic chart part and embedded workbook is cloned for slide isolation.
For charts named in ``chart_edits``, the ``<c:ser>`` caches and cloned workbook
are then rewritten so PowerPoint's "Edit Data" view stays consistent. Chart
styling / axes / legend layout are left untouched.
"""

from __future__ import annotations

import io
import posixpath
import re
import sys
import zipfile
from typing import Any
from xml.etree import ElementTree as ET

from .archive_safety import (
    EMBEDDED_XLSX_ARCHIVE_LIMITS,
    validate_zip_members,
)
from .edit_safety import (
    _chart_frames,
    _chart_reference,
    _require_supported_chart_edit,
)
from .ooxml import (
    CHART_CONTENT_TYPE,
    CHART_REL_TYPE,
    CT_NS,
    NS,
    PACKAGE_REL_TYPE,
    REL_NS,
    XLSX_CONTENT_TYPE,
    _normalize_part,
    _qn,
    _rels_name_for_part,
    _shape_identity,
    _xml_bytes,
)
from .package import _add_content_type_override, _find_relationship, _relative_target
from .selectors import _chart_selectors


def _chart_key_maps(slide_root: ET.Element, source_slide: int) -> dict[str, dict[str, str]]:
    maps: dict[str, dict[str, str]] = {}
    for order, container in enumerate(_chart_frames(slide_root), start=1):
        shape_id, shape_name = _shape_identity(container, order)
        chart_kind, rel_id = _chart_reference(container)
        info = {
            "shape_id": shape_id,
            "shape_name": shape_name,
            "rel_id": rel_id,
            "chart_kind": chart_kind,
        }
        maps[f"chart_id:s{source_slide:02d}_ch{shape_id}"] = info
        maps[f"shape_id:{shape_id}"] = info
        if shape_name:
            maps[f"shape_name:{shape_name}"] = info
    return maps


def _max_chart_part_number(entries: dict[str, bytes]) -> int:
    max_number = 0
    pattern = re.compile(r"^ppt/charts/chart(\d+)\.xml$")
    for name in entries:
        match = pattern.match(name)
        if match:
            max_number = max(max_number, int(match.group(1)))
    return max_number


def _max_embedding_part_number(entries: dict[str, bytes]) -> int:
    max_number = 0
    pattern = re.compile(r"^ppt/embeddings/templateFillChart(\d+)(?:\.[^/]+)?$")
    for name in entries:
        match = pattern.match(name)
        if match:
            max_number = max(max_number, int(match.group(1)))
    return max_number


def _chart_part_from_relationship(slide_part: str, rel: ET.Element) -> str:
    target = rel.attrib.get("Target", "")
    if rel.attrib.get("Type") != CHART_REL_TYPE or not target:
        raise RuntimeError("Matched chart shape does not point to a chart relationship")
    return _normalize_part(target, slide_part)


def _chart_type_with_series(chart_root: ET.Element) -> ET.Element:
    plot_area = chart_root.find(".//c:plotArea", NS)
    if plot_area is None:
        raise RuntimeError("Chart XML has no plotArea")
    chart_types: list[ET.Element] = []
    for child in list(plot_area):
        if child.tag.endswith("Chart") and child.findall("c:ser", NS):
            chart_types.append(child)
    if len(chart_types) > 1:
        raise RuntimeError(
            "template-fill chart edits do not support multi-plot / combination charts; "
            "use beautify/main pipeline to redraw the chart, or leave the native chart untouched"
        )
    if chart_types:
        return chart_types[0]
    raise RuntimeError("Chart XML has no editable series")


def _ensure_child(parent: ET.Element, tag: str) -> ET.Element:
    child = parent.find(tag, NS)
    if child is not None:
        return child
    return ET.SubElement(parent, _qn(NS["c"], tag.split(":", 1)[1]))


def _set_val_attr(element: ET.Element, value: str | int | float) -> None:
    element.set("val", str(value))


def _excel_col(index: int) -> str:
    result = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result or "A"


def _write_string_cache(cache: ET.Element, values: list[str]) -> None:
    for child in list(cache):
        cache.remove(child)
    pt_count = ET.SubElement(cache, _qn(NS["c"], "ptCount"))
    _set_val_attr(pt_count, len(values))
    for index, value in enumerate(values):
        pt = ET.SubElement(cache, _qn(NS["c"], "pt"), {"idx": str(index)})
        v = ET.SubElement(pt, _qn(NS["c"], "v"))
        v.text = str(value)


def _write_number_cache(cache: ET.Element, values: list[Any]) -> None:
    for child in list(cache):
        cache.remove(child)
    fmt = ET.SubElement(cache, _qn(NS["c"], "formatCode"))
    fmt.text = "General"
    pt_count = ET.SubElement(cache, _qn(NS["c"], "ptCount"))
    _set_val_attr(pt_count, len(values))
    for index, value in enumerate(values):
        pt = ET.SubElement(cache, _qn(NS["c"], "pt"), {"idx": str(index)})
        v = ET.SubElement(pt, _qn(NS["c"], "v"))
        v.text = str(value)


def _excel_sheet_reference(worksheet_name: str) -> str:
    """Return a formula-safe Excel worksheet reference."""
    worksheet_name = worksheet_name.strip() or "Sheet1"
    if re.fullmatch(r"[A-Za-z_\\][A-Za-z0-9_.]*", worksheet_name):
        return worksheet_name
    return f"'{worksheet_name.replace(chr(39), chr(39) * 2)}'"


def _set_series_name(
    series: ET.Element,
    name: str,
    column_index: int,
    worksheet_name: str = "Sheet1",
) -> None:
    tx = _ensure_child(series, "c:tx")
    for child in list(tx):
        tx.remove(child)
    str_ref = ET.SubElement(tx, _qn(NS["c"], "strRef"))
    formula = ET.SubElement(str_ref, _qn(NS["c"], "f"))
    formula.text = f"{_excel_sheet_reference(worksheet_name)}!${_excel_col(column_index)}$1"
    cache = ET.SubElement(str_ref, _qn(NS["c"], "strCache"))
    _write_string_cache(cache, [name])


def _set_category_cache(
    series: ET.Element,
    categories: list[str],
    worksheet_name: str = "Sheet1",
) -> None:
    cat = _ensure_child(series, "c:cat")
    for child in list(cat):
        cat.remove(child)
    str_ref = ET.SubElement(cat, _qn(NS["c"], "strRef"))
    formula = ET.SubElement(str_ref, _qn(NS["c"], "f"))
    formula.text = (
        f"{_excel_sheet_reference(worksheet_name)}!$A$2:$A${len(categories) + 1}"
    )
    cache = ET.SubElement(str_ref, _qn(NS["c"], "strCache"))
    _write_string_cache(cache, [str(item) for item in categories])


def _set_value_cache(
    series: ET.Element,
    values: list[Any],
    column_index: int,
    worksheet_name: str = "Sheet1",
) -> None:
    val = _ensure_child(series, "c:val")
    for child in list(val):
        val.remove(child)
    num_ref = ET.SubElement(val, _qn(NS["c"], "numRef"))
    formula = ET.SubElement(num_ref, _qn(NS["c"], "f"))
    column = _excel_col(column_index)
    formula.text = (
        f"{_excel_sheet_reference(worksheet_name)}!"
        f"${column}$2:${column}${len(values) + 1}"
    )
    cache = ET.SubElement(num_ref, _qn(NS["c"], "numCache"))
    _write_number_cache(cache, values)


def _apply_chart_edit_to_chart_xml(
    chart_root: ET.Element,
    chart_edit: dict[str, Any],
    *,
    worksheet_name: str = "Sheet1",
) -> None:
    capability = _require_supported_chart_edit(chart_root)
    for warning in capability.get("warnings", []):
        if not isinstance(warning, dict):
            continue
        code = warning.get("code") or "chart_edit_category_flattened"
        message = warning.get("message") or "chart categories will be flattened"
        print(f"  Warning: {message} [{code}]", file=sys.stderr)
    categories, series_payload = _validated_chart_edit_payload(chart_edit)
    chart_type = _chart_type_with_series(chart_root)
    series_nodes = chart_type.findall("c:ser", NS)
    if not series_nodes:
        raise RuntimeError("Chart XML has no editable series")
    template_series = series_nodes[-1]
    while len(series_nodes) < len(series_payload):
        clone = ET.fromstring(ET.tostring(template_series, encoding="utf-8"))
        chart_type.append(clone)
        series_nodes.append(clone)
    for extra in series_nodes[len(series_payload) :]:
        chart_type.remove(extra)
    series_nodes = chart_type.findall("c:ser", NS)
    for index, (series, payload) in enumerate(zip(series_nodes, series_payload), start=0):
        values = payload.get("values", [])
        if len(values) != len(categories):
            raise RuntimeError("Chart series values must match categories length")
        idx = _ensure_child(series, "c:idx")
        order = _ensure_child(series, "c:order")
        _set_val_attr(idx, index)
        _set_val_attr(order, index)
        _set_series_name(
            series,
            str(payload.get("name", f"系列{index + 1}")),
            index + 2,
            worksheet_name,
        )
        _set_category_cache(series, categories, worksheet_name)
        _set_value_cache(series, values, index + 2, worksheet_name)


def _validated_chart_edit_payload(
    chart_edit: dict[str, Any],
) -> tuple[list[str], list[dict[str, Any]]]:
    """Normalize one chart edit and reject malformed series before mutation."""
    categories_payload = chart_edit.get("categories", [])
    series_payload = chart_edit.get("series", [])
    if (
        not isinstance(categories_payload, list)
        or not categories_payload
        or not isinstance(series_payload, list)
        or not series_payload
    ):
        raise RuntimeError("Chart edit requires non-empty categories and series")
    for series in series_payload:
        if not isinstance(series, dict) or not isinstance(series.get("values"), list):
            raise RuntimeError("Chart edit series must contain a values list")
        if len(series["values"]) != len(categories_payload):
            raise RuntimeError("Chart series values must match categories length")
    return [str(item) for item in categories_payload], series_payload


def _spreadsheet_relationships(xlsx_entries: dict[str, bytes], part_name: str) -> dict[str, str]:
    rels_name = _rels_name_for_part(part_name)
    if rels_name not in xlsx_entries:
        return {}
    root = ET.fromstring(xlsx_entries[rels_name])
    rels: dict[str, str] = {}
    for rel in root.findall(_qn(REL_NS, "Relationship")):
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        if rel_id and target:
            rels[rel_id] = _normalize_part(target, part_name)
    return rels


def _first_workbook_sheet_info(
    xlsx_entries: dict[str, bytes],
) -> tuple[str, str] | None:
    workbook_part = "xl/workbook.xml"
    if workbook_part not in xlsx_entries:
        return None
    root = ET.fromstring(xlsx_entries[workbook_part])
    sheets = root.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheets")
    if sheets is None:
        return None
    first = next(iter(list(sheets)), None)
    if first is None:
        return None
    rel_id = first.attrib.get(_qn(NS["r"], "id"))
    if not rel_id:
        return None
    sheet_part = _spreadsheet_relationships(xlsx_entries, workbook_part).get(rel_id)
    if not sheet_part:
        return None
    sheet_name = (first.attrib.get("name") or "Sheet1").strip() or "Sheet1"
    return sheet_name, sheet_part


def _first_workbook_sheet(xlsx_entries: dict[str, bytes]) -> str | None:
    """Compatibility helper returning the first worksheet part path."""
    sheet_info = _first_workbook_sheet_info(xlsx_entries)
    return sheet_info[1] if sheet_info else None


def _spreadsheet_cell_ref(row: int, col: int) -> str:
    return f"{_excel_col(col)}{row}"


def _spreadsheet_cell(value: Any, row: int, col: int) -> ET.Element:
    cell = ET.Element(
        "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c",
        {"r": _spreadsheet_cell_ref(row, col)},
    )
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        v = ET.SubElement(cell, "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
        v.text = str(value)
        return cell
    cell.set("t", "inlineStr")
    inline = ET.SubElement(cell, "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}is")
    text = ET.SubElement(inline, "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
    text.text = str(value)
    return cell


def _rewrite_chart_workbook_with_sheet_name(
    xlsx_bytes: bytes,
    chart_edit: dict[str, Any],
) -> tuple[bytes, str]:
    categories = chart_edit.get("categories", [])
    series_payload = chart_edit.get("series", [])
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes)) as zin:
        members = validate_zip_members(
            zin,
            limits=EMBEDDED_XLSX_ARCHIVE_LIMITS,
            label="embedded chart workbook",
        )
        xlsx_entries = {
            info.filename: zin.read(info)
            for info in members
            if not info.is_dir()
        }
    sheet_info = _first_workbook_sheet_info(xlsx_entries)
    worksheet_name, sheet_part = sheet_info or (
        "Sheet1",
        "xl/worksheets/sheet1.xml",
    )
    if sheet_part not in xlsx_entries:
        return xlsx_bytes, worksheet_name
    sheet_root = ET.fromstring(xlsx_entries[sheet_part])
    sheet_ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    sheet_data = sheet_root.find(_qn(sheet_ns, "sheetData"))
    if sheet_data is None:
        sheet_data = ET.SubElement(sheet_root, _qn(sheet_ns, "sheetData"))
    for child in list(sheet_data):
        sheet_data.remove(child)

    rows = [["Category"] + [str(item.get("name", f"系列{idx + 1}")) for idx, item in enumerate(series_payload)]]
    for row_index, category in enumerate(categories):
        rows.append([category] + [item.get("values", [])[row_index] for item in series_payload])
    for row_index, values in enumerate(rows, start=1):
        row = ET.SubElement(sheet_data, _qn(sheet_ns, "row"), {"r": str(row_index)})
        for col_index, value in enumerate(values, start=1):
            row.append(_spreadsheet_cell(value, row_index, col_index))
    xlsx_entries[sheet_part] = _xml_bytes(sheet_root)

    out_buffer = io.BytesIO()
    with zipfile.ZipFile(out_buffer, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in xlsx_entries.items():
            zout.writestr(name, data)
    return out_buffer.getvalue(), worksheet_name


def _rewrite_chart_workbook(xlsx_bytes: bytes, chart_edit: dict[str, Any]) -> bytes:
    """Rewrite an embedded workbook while preserving the legacy bytes API."""
    rewritten, _ = _rewrite_chart_workbook_with_sheet_name(xlsx_bytes, chart_edit)
    return rewritten


def _content_type_override(content_root: ET.Element, part_name: str) -> str | None:
    normalized = "/" + part_name.lstrip("/")
    for override in content_root.findall(_qn(CT_NS, "Override")):
        if override.attrib.get("PartName") == normalized:
            return override.attrib.get("ContentType")
    return None


def _chart_workbook_rels(chart_rels_root: ET.Element) -> list[ET.Element]:
    workbook_rels: list[ET.Element] = []
    for rel in chart_rels_root.findall(_qn(REL_NS, "Relationship")):
        if rel.attrib.get("TargetMode") == "External":
            continue
        target = rel.attrib.get("Target", "")
        if rel.attrib.get("Type") == PACKAGE_REL_TYPE or target.lower().endswith(".xlsx"):
            workbook_rels.append(rel)
    return workbook_rels


def _find_chart_workbook_rel(chart_rels_root: ET.Element) -> ET.Element | None:
    """Compatibility helper returning the first embedded workbook relation."""
    return next(iter(_chart_workbook_rels(chart_rels_root)), None)


def _clone_chart_part(
    entries: dict[str, bytes],
    content_root: ET.Element,
    *,
    source_chart_part: str,
    new_chart_part: str,
    chart_edit: dict[str, Any] | None,
    next_embedding_number: int,
) -> tuple[int, str]:
    """Clone one chart and every embedded workbook it owns.

    ``chart_edit`` is optional because chart/workbook isolation is required for
    every output slide, including slides whose chart data is left unchanged.
    Other chart dependencies (styles, colors, and media) remain shared.
    """
    if source_chart_part not in entries:
        raise RuntimeError(f"Missing chart part: {source_chart_part}")
    source_chart_bytes = entries[source_chart_part]
    chart_root: ET.Element | None = None
    if chart_edit is not None:
        chart_root = ET.fromstring(source_chart_bytes)
        _require_supported_chart_edit(chart_root)
        _validated_chart_edit_payload(chart_edit)
    source_chart_rels = _rels_name_for_part(source_chart_part)
    worksheet_name = "Sheet1"
    if source_chart_rels in entries:
        new_chart_rels = _rels_name_for_part(new_chart_part)
        chart_rels_root = ET.fromstring(entries[source_chart_rels])
        workbook_rels = _chart_workbook_rels(chart_rels_root)
        for workbook_index, workbook_rel in enumerate(workbook_rels):
            workbook_target = workbook_rel.attrib.get("Target", "")
            workbook_part = _normalize_part(workbook_target, source_chart_part)
            if workbook_part not in entries:
                raise RuntimeError(
                    f"Missing embedded chart workbook: {workbook_part}"
                )
            next_embedding_number += 1
            extension = posixpath.splitext(workbook_part)[1] or ".xlsx"
            new_workbook_part = (
                "ppt/embeddings/"
                f"templateFillChart{next_embedding_number}{extension}"
            )
            workbook_bytes = entries[workbook_part]
            if chart_edit is not None and workbook_index == 0:
                workbook_bytes, worksheet_name = (
                    _rewrite_chart_workbook_with_sheet_name(
                        workbook_bytes,
                        chart_edit,
                    )
                )
            entries[new_workbook_part] = workbook_bytes
            workbook_rel.set(
                "Target",
                _relative_target(new_chart_part, new_workbook_part),
            )
            content_type = _content_type_override(content_root, workbook_part)
            if content_type is None and extension.lower() == ".xlsx":
                content_type = XLSX_CONTENT_TYPE
            if content_type:
                _add_content_type_override(
                    content_root,
                    new_workbook_part,
                    content_type,
                )
        entries[new_chart_rels] = _xml_bytes(chart_rels_root)

    if chart_root is not None and chart_edit is not None:
        _apply_chart_edit_to_chart_xml(
            chart_root,
            chart_edit,
            worksheet_name=worksheet_name,
        )
        entries[new_chart_part] = _xml_bytes(chart_root)
    else:
        entries[new_chart_part] = source_chart_bytes
    _add_content_type_override(content_root, new_chart_part, CHART_CONTENT_TYPE)
    return next_embedding_number, worksheet_name


def _clone_and_update_chart_part(
    entries: dict[str, bytes],
    content_root: ET.Element,
    *,
    source_chart_part: str,
    new_chart_part: str,
    chart_edit: dict[str, Any],
    next_embedding_number: int,
) -> tuple[int, str]:
    """Compatibility wrapper for callers that clone and edit in one step."""
    return _clone_chart_part(
        entries,
        content_root,
        source_chart_part=source_chart_part,
        new_chart_part=new_chart_part,
        chart_edit=chart_edit,
        next_embedding_number=next_embedding_number,
    )


def _apply_chart_edits_to_slide_package(
    slide_root: ET.Element,
    rels_root: ET.Element,
    entries: dict[str, bytes],
    content_root: ET.Element,
    *,
    source_slide: int,
    new_slide_part: str,
    chart_edits: list[dict[str, Any]],
    next_chart_number: int,
    next_embedding_number: int,
) -> tuple[int, int]:
    maps = _chart_key_maps(slide_root, source_slide)
    edits_by_rel_id: dict[str, list[dict[str, Any]]] = {}
    cloned_by_rel_id: dict[str, str] = {}
    worksheet_by_rel_id: dict[str, str] = {}
    errors: list[str] = []
    for chart_edit in chart_edits:
        selectors = _chart_selectors(chart_edit)
        chart_info = next((maps[key] for key in selectors if key in maps), None)
        if chart_info is None:
            if chart_edit.get("optional"):
                continue
            errors.append(", ".join(selectors) or "<missing selector>")
            continue
        chart_kind = chart_info.get("chart_kind", "")
        if chart_kind != "classic":
            code = (
                "chart_edit_chartex_unsupported"
                if chart_kind == "chartex"
                else "chart_edit_plot_type_unsupported"
            )
            raise RuntimeError(
                "template-fill chart edits require a supported classic chart "
                f"[{code}]"
            )
        rel_id = chart_info.get("rel_id", "")
        rel = _find_relationship(rels_root, rel_id)
        if rel is None:
            errors.append(f"{selectors[0] if selectors else '<chart>'} relationship={rel_id}")
            continue
        edits_by_rel_id.setdefault(rel_id, []).append(chart_edit)
    if errors:
        raise RuntimeError(
            f"Missing chart edit target(s) on slide {source_slide}: "
            f"{'; '.join(errors)}"
        )

    # Clone every classic chart relationship before applying selective edits.
    # This makes repeated source slides independent even when chart_edits is
    # empty, and prevents an untouched chart on a multi-chart page from sharing
    # data with a sibling output slide.
    for rel in rels_root.findall(_qn(REL_NS, "Relationship")):
        if (
            rel.attrib.get("Type") != CHART_REL_TYPE
            or rel.attrib.get("TargetMode") == "External"
        ):
            continue
        rel_id = rel.attrib.get("Id", "")
        next_chart_number += 1
        source_chart_part = _chart_part_from_relationship(new_slide_part, rel)
        new_chart_part = f"ppt/charts/chart{next_chart_number}.xml"
        rel_edits = edits_by_rel_id.get(rel_id, [])
        next_embedding_number, worksheet_name = _clone_chart_part(
            entries,
            content_root,
            source_chart_part=source_chart_part,
            new_chart_part=new_chart_part,
            chart_edit=rel_edits[0] if rel_edits else None,
            next_embedding_number=next_embedding_number,
        )
        rel.set("Target", _relative_target(new_slide_part, new_chart_part))
        cloned_by_rel_id[rel_id] = new_chart_part
        worksheet_by_rel_id[rel_id] = worksheet_name

    uncloned_edit_rels = [rel_id for rel_id in edits_by_rel_id if rel_id not in cloned_by_rel_id]
    if uncloned_edit_rels:
        raise RuntimeError(
            "Chart edit relationship(s) could not be cloned on slide "
            f"{source_slide}: {', '.join(uncloned_edit_rels)}"
        )

    # Multiple edits resolving to one relationship retain the established
    # last-edit-wins chart-cache behavior. The first edit already rebuilt the
    # cloned workbook and established its real worksheet name.
    for rel_id, rel_edits in edits_by_rel_id.items():
        for chart_edit in rel_edits[1:]:
            chart_root = ET.fromstring(entries[cloned_by_rel_id[rel_id]])
            _apply_chart_edit_to_chart_xml(
                chart_root,
                chart_edit,
                worksheet_name=worksheet_by_rel_id.get(rel_id, "Sheet1"),
            )
            entries[cloned_by_rel_id[rel_id]] = _xml_bytes(chart_root)
    return next_chart_number, next_embedding_number
