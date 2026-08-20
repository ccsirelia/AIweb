"""apply: replace text inside cloned slide shapes while keeping frames editable.

``_set_container_text`` is the shared text-writing primitive and is also reused
by ``table_fill`` for table-cell edits.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any
from xml.etree import ElementTree as ET

from .ooxml import NS, _qn, _shape_identity, _text_containers
from .selectors import _replacement_text


_XML_NS = "http://www.w3.org/XML/1998/namespace"
_A_P = _qn(NS["a"], "p")
_A_PPR = _qn(NS["a"], "pPr")
_A_END_P_RPR = _qn(NS["a"], "endParaRPr")
_A_EXT_LST = _qn(NS["a"], "extLst")
_A_R = _qn(NS["a"], "r")
_A_RPR = _qn(NS["a"], "rPr")
_A_T = _qn(NS["a"], "t")
_A_TAB = _qn(NS["a"], "tab")
_A_BR = _qn(NS["a"], "br")


def _tx_body(container: ET.Element) -> ET.Element | None:
    """Return the text body owned by a shape or table cell."""
    # Shape text bodies use ``p:txBody`` in PresentationML; table cells use
    # ``a:txBody``. Accept both forms because the shared writer handles them.
    body = container.find(".//p:txBody", NS)
    if body is not None:
        return body
    return container.find(".//a:txBody", NS)


def _copy_run_properties(paragraph: ET.Element) -> ET.Element | None:
    """Capture the first explicit run style before old runs are removed."""
    for node in paragraph.iter():
        if node.tag == _A_RPR:
            return deepcopy(node)
    return None


def _new_text_node(parent: ET.Element, text: str) -> ET.Element:
    node = ET.SubElement(parent, _A_T)
    # DrawingML trims leading/trailing whitespace unless xml:space is set.
    if text != text.strip(" "):
        node.set(f"{{{_XML_NS}}}space", "preserve")
    node.text = text
    return node


def _append_text_content(
    paragraph: ET.Element,
    text: str,
    run_properties: ET.Element | None,
    *,
    newline_as_break: bool = False,
) -> None:
    """Append valid DrawingML runs for text, tabs, and optional soft breaks."""
    # ``\v`` is an explicit soft-break escape for callers that need a line break
    # inside one paragraph. Ordinary ``\n`` is represented as a new paragraph by
    # ``_set_container_text``.
    separators = "\t\v" if not newline_as_break else "\t\v\n"
    chunks: list[str] = []
    current: list[str] = []

    def flush() -> None:
        if current:
            chunks.append("".join(current))
            current.clear()

    for char in text:
        if char in separators:
            flush()
            chunks.append(char)
        else:
            current.append(char)
    flush()

    # An empty paragraph still gets one editable text run. It must be inserted
    # before endParaRPr, otherwise PowerPoint may report a malformed text body.
    if not chunks:
        chunks = [""]

    wrote_text = False
    for chunk in chunks:
        if chunk == "\t":
            ET.SubElement(paragraph, _A_TAB)
            continue
        if chunk in {"\v", "\n"}:
            ET.SubElement(paragraph, _A_BR)
            continue
        run = ET.SubElement(paragraph, _A_R)
        if run_properties is not None:
            run.append(deepcopy(run_properties))
        _new_text_node(run, chunk)
        wrote_text = True

    # A paragraph made only of a tab/break should remain editable and carry a
    # text node so subsequent fills have a stable anchor.
    if not wrote_text:
        run = ET.SubElement(paragraph, _A_R)
        if run_properties is not None:
            run.append(deepcopy(run_properties))
        _new_text_node(run, "")


def _rewrite_paragraph(
    paragraph: ET.Element,
    text: str,
    *,
    newline_as_break: bool = False,
    run_properties: ET.Element | None = None,
) -> None:
    """Replace paragraph payload while preserving paragraph-level formatting."""
    if run_properties is None:
        run_properties = _copy_run_properties(paragraph)

    preserved: list[ET.Element] = []
    end_para_rpr: ET.Element | None = None
    ext_lst: ET.Element | None = None
    for child in list(paragraph):
        if child.tag == _A_PPR:
            preserved.append(child)
        elif child.tag == _A_END_P_RPR:
            end_para_rpr = child
        elif child.tag == _A_EXT_LST:
            ext_lst = child
        # All runs, fields, tabs, breaks, and unknown payload nodes are
        # deliberately discarded. They may contain stale visible text.
        paragraph.remove(child)

    for child in preserved:
        paragraph.append(child)
    _append_text_content(
        paragraph,
        text,
        run_properties,
        newline_as_break=newline_as_break,
    )
    if end_para_rpr is not None:
        paragraph.append(end_para_rpr)
    if ext_lst is not None:
        paragraph.append(ext_lst)


def _shape_key_maps(slide_root: ET.Element, source_slide: int) -> dict[str, ET.Element]:
    maps: dict[str, ET.Element] = {}
    for order, container in enumerate(_text_containers(slide_root), start=1):
        shape_id, shape_name = _shape_identity(container, order)
        maps[f"slot_id:s{source_slide:02d}_sh{shape_id}"] = container
        maps[f"shape_id:{shape_id}"] = container
        if shape_name:
            maps[f"shape_name:{shape_name}"] = container
    return maps


def _ensure_text_nodes(container: ET.Element) -> list[ET.Element]:
    text_nodes = container.findall(".//a:t", NS)
    if text_nodes:
        return text_nodes
    tx_body = _tx_body(container)
    if tx_body is None:
        return []
    paragraph = tx_body.find("a:p", NS)
    if paragraph is None:
        paragraph = ET.SubElement(tx_body, _qn(NS["a"], "p"))
    # Keep the run ahead of endParaRPr; appending blindly after the latter is
    # invalid DrawingML and is one of the common causes of PowerPoint repair
    # prompts after a template fill.
    run = paragraph.find("a:r", NS)
    if run is None:
        run = ET.Element(_A_R)
        end_para_rpr = paragraph.find("a:endParaRPr", NS)
        if end_para_rpr is None:
            paragraph.append(run)
        else:
            paragraph.insert(list(paragraph).index(end_para_rpr), run)
    text_node = run.find("a:t", NS)
    if text_node is None:
        text_node = ET.SubElement(run, _A_T)
    return [text_node]


def _ensure_paragraph_text_node(paragraph: ET.Element) -> list[ET.Element]:
    text_nodes = paragraph.findall(".//a:t", NS)
    if text_nodes:
        return text_nodes
    run = paragraph.find("a:r", NS)
    if run is None:
        run = ET.Element(_A_R)
        end_para_rpr = paragraph.find("a:endParaRPr", NS)
        if end_para_rpr is None:
            paragraph.append(run)
        else:
            paragraph.insert(list(paragraph).index(end_para_rpr), run)
    text_node = run.find("a:t", NS)
    if text_node is None:
        text_node = ET.SubElement(run, _A_T)
    return [text_node]


def _set_paragraph_text(paragraph: ET.Element, text: str) -> None:
    normalized = str(text).replace("\r\n", "\n").replace("\r", "\n")
    _rewrite_paragraph(paragraph, normalized, newline_as_break=True)


def _set_container_text(container: ET.Element, text: str) -> None:
    tx_body = _tx_body(container)
    if tx_body is None:
        raise RuntimeError("Matched shape does not contain a text body")

    normalized = str(text).replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    existing = list(tx_body.findall("a:p", NS))
    template = deepcopy(existing[-1]) if existing else ET.Element(_A_P)
    styles = [_copy_run_properties(paragraph) for paragraph in existing]

    output_paragraphs: list[ET.Element] = []
    for index, line in enumerate(lines):
        if index < len(existing):
            paragraph = existing[index]
        else:
            paragraph = deepcopy(template)
        style = styles[index] if index < len(styles) and styles[index] is not None else (
            styles[-1] if styles else None
        )
        _rewrite_paragraph(paragraph, line, run_properties=style)
        output_paragraphs.append(paragraph)

    # Keep bodyPr/lstStyle and any text-body extension list, but put all newly
    # generated paragraphs between them so the DrawingML child order is valid.
    non_paragraph = [child for child in list(tx_body) if child.tag != _A_P]
    for child in list(tx_body):
        tx_body.remove(child)
    extensions = [child for child in non_paragraph if child.tag == _A_EXT_LST]
    for child in non_paragraph:
        if child.tag != _A_EXT_LST:
            tx_body.append(child)
    for paragraph in output_paragraphs:
        tx_body.append(paragraph)
    for extension in extensions:
        tx_body.append(extension)


def _apply_replacements_to_slide(
    slide_root: ET.Element,
    *,
    source_slide: int,
    replacements: list[dict[str, Any]],
) -> None:
    maps = _shape_key_maps(slide_root, source_slide)
    errors: list[str] = []
    for replacement in replacements:
        selectors = []
        if replacement.get("slot_id"):
            selectors.append(f"slot_id:{replacement['slot_id']}")
        if replacement.get("shape_id"):
            selectors.append(f"shape_id:{replacement['shape_id']}")
        if replacement.get("shape_name"):
            selectors.append(f"shape_name:{replacement['shape_name']}")
        container = next((maps[key] for key in selectors if key in maps), None)
        if container is None:
            if replacement.get("optional"):
                continue
            errors.append(", ".join(selectors) or "<missing selector>")
            continue
        _set_container_text(container, _replacement_text(replacement))
    if errors:
        raise RuntimeError(f"Missing replacement target(s) on slide {source_slide}: {'; '.join(errors)}")
