from __future__ import annotations

import sys
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET


SCRIPTS_DIR = Path(__file__).resolve().parents[2]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from template_fill_pptx.applier import (  # noqa: E402
    _rewrite_section_slide_ids,
    _source_slide_ids,
)
from template_fill_pptx.ooxml import NS, P14_NS  # noqa: E402


class SectionIdTests(unittest.TestCase):
    def test_section_ids_follow_rebuilt_slides_and_drop_omitted_members(self) -> None:
        root = ET.fromstring(
            f"""
            <p:presentation xmlns:p="{NS['p']}" xmlns:r="{NS['r']}"
                xmlns:p14="{P14_NS}">
              <p:sldIdLst>
                <p:sldId id="1823" r:id="rId1"/>
                <p:sldId id="1824" r:id="rId2"/>
                <p:sldId id="1843" r:id="rId3"/>
              </p:sldIdLst>
              <p:extLst><p:ext uri="section">
                <p14:sectionLst>
                  <p14:section name="A" id="a"><p14:sldIdLst>
                    <p14:sldId id="1823"/><p14:sldId id="1843"/>
                  </p14:sldIdLst></p14:section>
                  <p14:section name="B" id="b"><p14:sldIdLst>
                    <p14:sldId id="1824"/>
                  </p14:sldIdLst></p14:section>
                </p14:sectionLst>
              </p:ext></p:extLst>
            </p:presentation>
            """
        )

        self.assertEqual(_source_slide_ids(root), {1: "1823", 2: "1824", 3: "1843"})
        _rewrite_section_slide_ids(
            root,
            source_slide_ids={1: "1823", 2: "1824", 3: "1843"},
            # Source slide 1 is omitted; source slide 3 is reused twice.
            output_source_pairs=[(3, "256"), (2, "257"), (3, "258")],
        )

        sections = root.findall(".//p14:section", {"p14": P14_NS})
        self.assertEqual([section.attrib["name"] for section in sections], ["A", "B"])
        self.assertEqual(
            [node.attrib["id"] for node in sections[0].findall("p14:sldIdLst/p14:sldId", {"p14": P14_NS})],
            ["256", "258"],
        )
        self.assertEqual(
            [node.attrib["id"] for node in sections[1].findall("p14:sldIdLst/p14:sldId", {"p14": P14_NS})],
            ["257"],
        )

    def test_empty_section_list_is_removed_when_every_slide_is_omitted(self) -> None:
        root = ET.fromstring(
            f"""
            <p:presentation xmlns:p="{NS['p']}" xmlns:p14="{P14_NS}">
              <p:sldIdLst><p:sldId id="100"/></p:sldIdLst>
              <p:extLst><p:ext uri="section"><p14:sectionLst>
                <p14:section name="A" id="a"><p14:sldIdLst><p14:sldId id="100"/></p14:sldIdLst></p14:section>
              </p14:sectionLst></p:ext></p:extLst>
            </p:presentation>
            """
        )

        _rewrite_section_slide_ids(
            root,
            source_slide_ids={1: "100"},
            output_source_pairs=[],
        )

        self.assertIsNone(root.find(".//p14:sectionLst", {"p14": P14_NS}))


if __name__ == "__main__":
    unittest.main()
