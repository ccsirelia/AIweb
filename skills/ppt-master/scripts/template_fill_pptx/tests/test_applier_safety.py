from __future__ import annotations

import sys
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET


SCRIPTS_DIR = Path(__file__).resolve().parents[2]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from template_fill_pptx.applier import (  # noqa: E402
    _drop_custom_shows,
    _validate_text_animation_ranges,
)
from template_fill_pptx.ooxml import NS, _qn  # noqa: E402


def _slide_with_range(range_name: str, *, end: int) -> ET.Element:
    return ET.fromstring(
        f"""
        <p:sld xmlns:p="{NS['p']}" xmlns:a="{NS['a']}">
          <p:cSld><p:spTree><p:sp>
            <p:nvSpPr><p:cNvPr id="5" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Only</a:t></a:r></a:p></p:txBody>
          </p:sp></p:spTree></p:cSld>
          <p:timing><p:tnLst><p:par><p:cTn><p:childTnLst><p:anim>
            <p:cBhvr><p:cTn/><p:tgtEl><p:spTgt spid="5"><p:txEl><p:{range_name} st="0" end="{end}"/></p:txEl></p:spTgt></p:tgtEl></p:cBhvr>
          </p:anim></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>
        </p:sld>
        """
    )


class ApplierSafetyTests(unittest.TestCase):
    def test_valid_paragraph_animation_range_is_preserved(self) -> None:
        _validate_text_animation_ranges(
            _slide_with_range("pRg", end=0),
            source_slide=1,
        )

    def test_out_of_bounds_paragraph_animation_range_is_rejected(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "pRg animation range"):
            _validate_text_animation_ranges(
                _slide_with_range("pRg", end=2),
                source_slide=1,
            )

    def test_out_of_bounds_character_animation_range_is_rejected(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "charRg animation range"):
            _validate_text_animation_ranges(
                _slide_with_range("charRg", end=20),
                source_slide=1,
            )

    def test_custom_shows_and_custom_show_playback_are_removed(self) -> None:
        root = ET.fromstring(
            f"""
            <p:presentation xmlns:p="{NS['p']}" xmlns:r="{NS['r']}">
              <p:custShowLst><p:custShow name="Subset" id="1"><p:sldLst><p:sld r:id="rId9"/></p:sldLst></p:custShow></p:custShowLst>
              <p:showPr><p:custShow id="1"/></p:showPr>
            </p:presentation>
            """
        )
        _drop_custom_shows(root)
        self.assertIsNone(root.find("p:custShowLst", NS))
        show_pr = root.find("p:showPr", NS)
        self.assertIsNotNone(show_pr)
        self.assertIsNone(show_pr.find("p:custShow", NS))
        self.assertIsNotNone(show_pr.find("p:sldAll", NS))


if __name__ == "__main__":
    unittest.main()
