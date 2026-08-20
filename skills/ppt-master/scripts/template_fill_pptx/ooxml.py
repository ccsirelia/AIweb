"""Shared OOXML primitives for the template-fill pipeline.

Read-side helpers only: namespaces and content-type constants, part /
relationship resolution, EMU unit conversion, slide-shape discovery, and small
JSON readers / writers. Write-side package plumbing lives in ``package.py``.
"""

from __future__ import annotations

import json
import math
import posixpath
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import unquote
from xml.etree import ElementTree as ET


NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
P14_NS = "http://schemas.microsoft.com/office/powerpoint/2010/main"
MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"
C14_NS = "http://schemas.microsoft.com/office/drawing/2007/8/2/chart"
C16_NS = "http://schemas.microsoft.com/office/drawing/2014/chart"
C16R2_NS = "http://schemas.microsoft.com/office/drawing/2015/06/chart"

SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
NOTES_SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"
CHART_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart"
PACKAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package"
SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
NOTES_SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"
CHART_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"
XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
EMU_PER_INCH = 914400
PX_PER_INCH = 96


for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)
ET.register_namespace("", REL_NS)
ET.register_namespace("mc", MC_NS)
ET.register_namespace("c14", C14_NS)
ET.register_namespace("c16", C16_NS)
ET.register_namespace("c16r2", C16R2_NS)
ET.register_namespace("p14", P14_NS)


@dataclass(frozen=True)
class SlideRef:
    """Presentation slide reference resolved from presentation.xml.rels."""

    index: int
    rel_id: str
    target: str
    part_name: str
    rels_name: str


def _qn(namespace: str, tag: str) -> str:
    return f"{{{namespace}}}{tag}"


def _read_xml(zf: zipfile.ZipFile, name: str) -> ET.Element:
    try:
        return ET.fromstring(zf.read(name))
    except KeyError as exc:
        raise RuntimeError(f"Missing required PPTX part: {name}") from exc


def _xml_bytes(root: ET.Element) -> bytes:
    root_namespace = root.tag[1:].split("}", 1)[0] if root.tag.startswith("{") else ""
    if root_namespace in {REL_NS, CT_NS}:
        # OPC relationship/content-type roots conventionally use the default
        # namespace. ElementTree's global prefix registry can be changed while
        # parsing source parts; restore the package-root form before writing so
        # strict consumers such as LibreOffice accept the generated package.
        ET.register_namespace("", root_namespace)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _normalize_part(target: str, base: str = "ppt/presentation.xml") -> str:
    """Resolve an internal relationship target without escaping package root."""
    if not target:
        raise RuntimeError("OPC relationship target must not be empty")

    def normalized_candidate(value: str) -> str:
        if "\\" in value or value.startswith("//"):
            raise RuntimeError(f"Unsafe OPC relationship target: {target!r}")
        if value.startswith("/"):
            resolved = posixpath.normpath(value.lstrip("/"))
        else:
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(base), value))
        if resolved in {"", ".", ".."} or resolved.startswith("../") or resolved.startswith("/"):
            raise RuntimeError(f"OPC relationship target escapes package root: {target!r}")
        return resolved

    normalized = normalized_candidate(target)
    # Validate the decoded URI as well so encoded dot segments or separators
    # cannot evade the package-root check.
    normalized_candidate(unquote(target))
    return normalized


def _rels_name_for_part(part_name: str) -> str:
    parent = posixpath.dirname(part_name)
    basename = posixpath.basename(part_name)
    return posixpath.join(parent, "_rels", f"{basename}.rels")


def _emu_to_px(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return round(int(value) / EMU_PER_INCH * PX_PER_INCH)
    except ValueError:
        return None


def _parse_relationships(zf: zipfile.ZipFile) -> dict[str, dict[str, str]]:
    rels_root = _read_xml(zf, "ppt/_rels/presentation.xml.rels")
    relationships: dict[str, dict[str, str]] = {}
    for rel in rels_root.findall(_qn(REL_NS, "Relationship")):
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        rel_type = rel.attrib.get("Type")
        if rel_id and target and rel_type:
            relationships[rel_id] = {"target": target, "type": rel_type}
    return relationships


def _parse_slide_refs(zf: zipfile.ZipFile) -> list[SlideRef]:
    pres_root = _read_xml(zf, "ppt/presentation.xml")
    relationships = _parse_relationships(zf)
    sld_id_lst = pres_root.find("p:sldIdLst", NS)
    if sld_id_lst is None:
        return []

    slides: list[SlideRef] = []
    for index, sld_id in enumerate(sld_id_lst.findall("p:sldId", NS), start=1):
        rel_id = sld_id.attrib.get(_qn(NS["r"], "id"))
        if not rel_id or rel_id not in relationships:
            continue
        rel = relationships[rel_id]
        if rel["type"] != SLIDE_REL_TYPE:
            continue
        part_name = _normalize_part(rel["target"])
        slides.append(
            SlideRef(
                index=index,
                rel_id=rel_id,
                target=rel["target"],
                part_name=part_name,
                rels_name=_rels_name_for_part(part_name),
            )
        )
    return slides


def _slide_relationships(zf: zipfile.ZipFile, rels_name: str) -> dict[str, dict[str, str]]:
    try:
        rels_root = _read_xml(zf, rels_name)
    except RuntimeError:
        return {}
    relationships: dict[str, dict[str, str]] = {}
    for rel in rels_root.findall(_qn(REL_NS, "Relationship")):
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        rel_type = rel.attrib.get("Type")
        if rel_id and target and rel_type:
            relationships[rel_id] = {"target": target, "type": rel_type}
    return relationships


def _paragraph_texts(container: ET.Element) -> list[str]:
    def paragraph_text(paragraph: ET.Element) -> str:
        parts: list[str] = []
        # Iterate in document order so soft breaks/tabs in table cells are not
        # silently dropped from the intake summary. Field text is represented
        # by the same a:t nodes and therefore remains readable as well.
        for node in paragraph.iter():
            local_name = node.tag.rsplit("}", 1)[-1] if isinstance(node.tag, str) else ""
            if local_name == "t":
                parts.append(node.text or "")
            elif local_name == "br":
                parts.append("\n")
            elif local_name == "tab":
                parts.append("\t")
        return "".join(parts).strip()

    paragraphs: list[str] = []
    for paragraph in container.findall(".//a:p", NS):
        text = paragraph_text(paragraph)
        if text:
            paragraphs.append(text)
    if paragraphs:
        return paragraphs
    text = "".join(paragraph_text(paragraph) for paragraph in container.findall(".//a:p", NS)).strip()
    return [text] if text else []


def _element_parent_map(root: ET.Element) -> dict[ET.Element, ET.Element]:
    """Return a parent lookup for one XML subtree.

    ``xml.etree`` deliberately does not expose parent pointers.  The analyzer
    needs them to resolve text frames nested inside ``p:grpSp`` containers,
    whose local coordinates are otherwise meaningless on the slide canvas.
    """
    return {
        child: parent
        for parent in root.iter()
        for child in list(parent)
    }


def _xfrm_geometry_emu(container: ET.Element) -> tuple[float, float, float, float, ET.Element] | None:
    """Read a shape/frame transform in EMUs without rounding to pixels."""
    xfrm = container.find("p:spPr/a:xfrm", NS)
    if xfrm is None:
        xfrm = container.find("p:xfrm", NS)
    if xfrm is None:
        xfrm = container.find(".//a:xfrm", NS)
    if xfrm is None:
        return None
    off = xfrm.find("a:off", NS)
    ext = xfrm.find("a:ext", NS)
    if off is None or ext is None:
        return None
    try:
        return (
            float(int(off.attrib.get("x", "0"))),
            float(int(off.attrib.get("y", "0"))),
            float(int(ext.attrib.get("cx", "0"))),
            float(int(ext.attrib.get("cy", "0"))),
            xfrm,
        )
    except (TypeError, ValueError):
        return None


def _rotation_degrees(xfrm: ET.Element | None) -> float:
    """Decode DrawingML's 1/60000-degree clockwise rotation attribute."""
    if xfrm is None:
        return 0.0
    try:
        return float(int(xfrm.attrib.get("rot", "0"))) / 60000.0
    except (TypeError, ValueError):
        return 0.0


def _rotated_bbox(
    x: float,
    y: float,
    width: float,
    height: float,
    degrees: float,
    *,
    center_x: float | None = None,
    center_y: float | None = None,
) -> tuple[float, float, float, float]:
    """Return an axis-aligned bounding box after a rectangular rotation."""
    if not degrees:
        return x, y, width, height
    center_x = x + width / 2 if center_x is None else center_x
    center_y = y + height / 2 if center_y is None else center_y
    radians = math.radians(degrees)
    cosine = math.cos(radians)
    sine = math.sin(radians)
    corners = ((x, y), (x + width, y), (x, y + height), (x + width, y + height))
    transformed = []
    for point_x, point_y in corners:
        dx = point_x - center_x
        dy = point_y - center_y
        transformed.append(
            (
                center_x + dx * cosine - dy * sine,
                center_y + dx * sine + dy * cosine,
            )
        )
    min_x = min(point[0] for point in transformed)
    max_x = max(point[0] for point in transformed)
    min_y = min(point[1] for point in transformed)
    max_y = max(point[1] for point in transformed)
    return min_x, min_y, max_x - min_x, max_y - min_y


def _group_transform(
    geometry: tuple[float, float, float, float],
    group: ET.Element,
) -> tuple[float, float, float, float]:
    """Map child geometry through one ``p:grpSp`` transform.

    Group transforms use ``off/ext`` for the group's slide-space frame and
    ``chOff/chExt`` for the child coordinate space.  Most templates use an
    axis-aligned group; rotation is handled as a bounding-box transform so
    callers still receive useful capacity geometry for rotated groups.
    """
    xfrm = group.find("./p:grpSpPr/a:xfrm", NS)
    if xfrm is None:
        return geometry
    off = xfrm.find("a:off", NS)
    ext = xfrm.find("a:ext", NS)
    if off is None or ext is None:
        return geometry
    try:
        off_x = float(int(off.attrib.get("x", "0")))
        off_y = float(int(off.attrib.get("y", "0")))
        ext_x = float(int(ext.attrib.get("cx", "0")))
        ext_y = float(int(ext.attrib.get("cy", "0")))
    except (TypeError, ValueError):
        return geometry

    child_off = xfrm.find("a:chOff", NS)
    child_ext = xfrm.find("a:chExt", NS)
    try:
        child_off_x = float(int(child_off.attrib.get("x", "0"))) if child_off is not None else 0.0
        child_off_y = float(int(child_off.attrib.get("y", "0"))) if child_off is not None else 0.0
        child_ext_x = float(int(child_ext.attrib.get("cx", "0"))) if child_ext is not None else ext_x
        child_ext_y = float(int(child_ext.attrib.get("cy", "0"))) if child_ext is not None else ext_y
    except (TypeError, ValueError):
        return geometry
    if not child_ext_x or not child_ext_y:
        return geometry

    x, y, width, height = geometry
    scale_x = ext_x / child_ext_x
    scale_y = ext_y / child_ext_y
    mapped = (
        off_x + (x - child_off_x) * scale_x,
        off_y + (y - child_off_y) * scale_y,
        abs(width * scale_x),
        abs(height * scale_y),
    )
    # Horizontal/vertical flips preserve the axis-aligned rectangle bounds;
    # rotation does not, so include it around the group's visual center.
    rotation = _rotation_degrees(xfrm)
    if rotation:
        mapped = _rotated_bbox(
            *mapped,
            rotation,
            center_x=off_x + ext_x / 2,
            center_y=off_y + ext_y / 2,
        )
    return mapped


def _group_ancestors(
    container: ET.Element,
    parent_map: Mapping[ET.Element, ET.Element],
) -> list[ET.Element]:
    """Return containing groups from nearest to furthest ancestor."""
    groups: list[ET.Element] = []
    current = parent_map.get(container)
    group_tag = _qn(NS["p"], "grpSp")
    while current is not None:
        if current.tag == group_tag:
            groups.append(current)
        current = parent_map.get(current)
    return groups


def _group_path(
    container: ET.Element,
    parent_map: Mapping[ET.Element, ET.Element],
) -> list[dict[str, str]]:
    """Return stable identity records for containing groups, outermost first."""
    path: list[dict[str, str]] = []
    for order, group in enumerate(reversed(_group_ancestors(container, parent_map)), start=1):
        shape_id, shape_name = _shape_identity(group, order)
        path.append({"shape_id": shape_id, "shape_name": shape_name})
    return path


def _container_geometry(
    container: ET.Element,
    parent_map: Mapping[ET.Element, ET.Element] | None = None,
) -> dict[str, int | None]:
    raw = _xfrm_geometry_emu(container)
    if raw is None:
        return {"x": None, "y": None, "width": None, "height": None}
    x, y, width, height, xfrm = raw
    # Shape-level rotation is part of the visible frame even without a group.
    x, y, width, height = _rotated_bbox(x, y, width, height, _rotation_degrees(xfrm))
    if parent_map is not None:
        for group in _group_ancestors(container, parent_map):
            x, y, width, height = _group_transform((x, y, width, height), group)
    return {
        "x": _emu_to_px(str(round(x))),
        "y": _emu_to_px(str(round(y))),
        "width": _emu_to_px(str(round(width))),
        "height": _emu_to_px(str(round(height))),
    }
    xfrm = container.find("p:spPr/a:xfrm", NS)
    if xfrm is None:
        xfrm = container.find("p:xfrm", NS)
    if xfrm is None:
        xfrm = container.find(".//a:xfrm", NS)
    if xfrm is None:
        return {"x": None, "y": None, "width": None, "height": None}
    off = xfrm.find("a:off", NS)
    ext = xfrm.find("a:ext", NS)
    return {
        "x": _emu_to_px(off.attrib.get("x")) if off is not None else None,
        "y": _emu_to_px(off.attrib.get("y")) if off is not None else None,
        "width": _emu_to_px(ext.attrib.get("cx")) if ext is not None else None,
        "height": _emu_to_px(ext.attrib.get("cy")) if ext is not None else None,
    }


def _text_containers(slide_root: ET.Element) -> list[ET.Element]:
    containers: list[ET.Element] = []
    for tag in ("p:sp", "p:graphicFrame"):
        for element in slide_root.findall(f".//{tag}", NS):
            if tag == "p:graphicFrame":
                # Tables, charts, and SmartArt have their own edit/read paths.
                # Exposing their txBody as a generic text slot lets a normal
                # replacement wipe the whole graphic frame before table/chart
                # edits run.
                if element.find(".//a:tbl", NS) is not None or element.find(".//c:chart", NS) is not None:
                    continue
                if any(str(node.tag).rsplit("}", 1)[-1] in {"relIds", "relId"} for node in element.iter()):
                    continue
            if element.find(".//p:txBody", NS) is not None or element.findall(".//a:t", NS):
                containers.append(element)
    return containers


def _table_containers(slide_root: ET.Element) -> list[ET.Element]:
    return [
        frame
        for frame in slide_root.findall(".//p:graphicFrame", NS)
        if frame.find(".//a:tbl", NS) is not None
    ]


def _chart_containers(slide_root: ET.Element) -> list[ET.Element]:
    return [
        frame
        for frame in slide_root.findall(".//p:graphicFrame", NS)
        if frame.find(".//c:chart", NS) is not None
    ]


def _picture_containers(slide_root: ET.Element) -> list[ET.Element]:
    """Return native picture shapes, including pictures nested in groups."""
    return list(slide_root.findall(".//p:pic", NS))


def _shape_identity(container: ET.Element, order: int) -> tuple[str, str]:
    c_nv_pr = container.find(".//p:cNvPr", NS)
    shape_id = c_nv_pr.attrib.get("id") if c_nv_pr is not None else str(order)
    shape_name = c_nv_pr.attrib.get("name") if c_nv_pr is not None else ""
    return shape_id, shape_name


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON: {path}: {exc}") from exc


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
