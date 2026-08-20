from __future__ import annotations

import sys
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET


SCRIPTS_DIR = Path(__file__).resolve().parents[2]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from template_fill_pptx.ooxml import NS  # noqa: E402
from template_fill_pptx.text_fill import (  # noqa: E402
    _set_container_text,
    _set_paragraph_text,
)


def _xml(value: str) -> ET.Element:
    return ET.fromstring(value)


class TextFillTests(unittest.TestCase):
    def test_rewrite_removes_stale_payload_and_preserves_valid_order(self) -> None:
        root = _xml(
            f"""
            <p:sp xmlns:p="{NS['p']}" xmlns:a="{NS['a']}">
              <a:txBody>
                <a:bodyPr/><a:lstStyle/>
                <a:p>
                  <a:pPr lvl="1"/>
                  <a:r><a:rPr b="1"/><a:t>OLD</a:t></a:r>
                  <a:fld id="field"><a:r><a:t>FIELD</a:t></a:r></a:fld>
                  <a:br/><a:tab/>
                  <a:endParaRPr lang="zh-CN"/>
                </a:p>
              </a:txBody>
            </p:sp>
            """
        )

        _set_container_text(root, "第一段\n第二\t段")

        paragraphs = root.findall(".//a:txBody/a:p", NS)
        self.assertEqual(len(paragraphs), 2)
        self.assertNotIn("OLD", ET.tostring(root, encoding="unicode"))
        self.assertNotIn("FIELD", ET.tostring(root, encoding="unicode"))
        self.assertIsNone(root.find(".//a:fld", NS))
        self.assertEqual(
            [node.tag.rsplit("}", 1)[-1] for node in paragraphs[0]],
            ["pPr", "r", "endParaRPr"],
        )
        self.assertEqual(
            [node.tag.rsplit("}", 1)[-1] for node in paragraphs[1]],
            ["pPr", "r", "tab", "r", "endParaRPr"],
        )
        self.assertEqual(
            "".join(node.text or "" for node in root.findall(".//a:t", NS)),
            "第一段第二段",
        )

    def test_empty_paragraph_inserts_run_before_end_para_rpr(self) -> None:
        root = _xml(
            f"""
            <p:sp xmlns:p="{NS['p']}" xmlns:a="{NS['a']}">
              <a:txBody><a:bodyPr/><a:lstStyle/>
                <a:p><a:pPr/><a:endParaRPr lang="zh-CN"/></a:p>
              </a:txBody>
            </p:sp>
            """
        )

        _set_container_text(root, "")

        paragraph = root.find(".//a:txBody/a:p", NS)
        self.assertIsNotNone(paragraph)
        assert paragraph is not None
        self.assertEqual(
            [node.tag.rsplit("}", 1)[-1] for node in paragraph],
            ["pPr", "r", "endParaRPr"],
        )
        self.assertEqual(paragraph.findtext("a:r/a:t", default=None, namespaces=NS), "")

    def test_set_paragraph_text_uses_soft_break_elements(self) -> None:
        paragraph = _xml(
            f"""
            <a:p xmlns:a="{NS['a']}">
              <a:pPr/><a:r><a:rPr i="1"/><a:t>old</a:t></a:r>
              <a:endParaRPr/>
            </a:p>
            """
        )

        _set_paragraph_text(paragraph, "上\n下")

        self.assertEqual(
            [node.tag.rsplit("}", 1)[-1] for node in paragraph],
            ["pPr", "r", "br", "r", "endParaRPr"],
        )
        self.assertEqual(
            [node.text or "" for node in paragraph.findall("a:r/a:t", NS)],
            ["上", "下"],
        )
        self.assertEqual(
            [node.find("a:rPr", NS).attrib for node in paragraph.findall("a:r", NS)],
            [{"i": "1"}, {"i": "1"}],
        )

    def test_presentation_shape_text_body_namespace_is_supported(self) -> None:
        # PresentationML shapes use p:txBody, while table cells use a:txBody.
        root = _xml(
            f"""
            <p:sp xmlns:p="{NS['p']}" xmlns:a="{NS['a']}">
              <p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p><a:r><a:t>旧文本</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
            """
        )

        _set_container_text(root, "新文本")

        self.assertEqual(root.findtext(".//a:t", default=None, namespaces=NS), "新文本")


if __name__ == "__main__":
    unittest.main()
