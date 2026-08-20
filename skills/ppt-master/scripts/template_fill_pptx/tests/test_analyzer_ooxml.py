from __future__ import annotations

import io
import sys
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


SCRIPTS_DIR = Path(__file__).resolve().parents[2]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from template_fill_pptx.analyzer import (  # noqa: E402
    _analyze_charts,
    _analyze_pictures,
    _analyze_tables,
)
from template_fill_pptx.ooxml import (  # noqa: E402
    CHART_REL_TYPE,
    NS,
    SlideRef,
    _container_geometry,
    _element_parent_map,
    _group_path,
    _normalize_part,
    _paragraph_texts,
)


def _xml(value: str) -> ET.Element:
    return ET.fromstring(value)


def _grouped_slide() -> ET.Element:
    return _xml(
        f"""
        <p:sld xmlns:p="{NS['p']}" xmlns:a="{NS['a']}">
          <p:cSld>
            <p:spTree>
              <p:nvGrpSpPr><p:cNvPr id="1" name="Root"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
              <p:grpSpPr/>
              <p:grpSp>
                <p:nvGrpSpPr><p:cNvPr id="19" name="Outer group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
                <p:grpSpPr>
                  <a:xfrm>
                    <a:off x="914400" y="1828800"/><a:ext cx="7315200" cy="3657600"/>
                    <a:chOff x="0" y="0"/><a:chExt cx="3657600" cy="1828800"/>
                  </a:xfrm>
                </p:grpSpPr>
                <p:sp>
                  <p:nvSpPr><p:cNvPr id="21" name="Grouped title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
                  <p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="457200" cy="228600"/></a:xfrm></p:spPr>
                  <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody>
                </p:sp>
              </p:grpSp>
            </p:spTree>
          </p:cSld>
        </p:sld>
        """
    )


def _table_frame() -> ET.Element:
    return _xml(
        f"""
        <p:graphicFrame xmlns:p="{NS['p']}" xmlns:a="{NS['a']}">
          <p:nvGraphicFramePr><p:cNvPr id="42" name="Native table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
          <p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></p:xfrm>
          <a:graphic><a:graphicData>
            <a:tbl><a:tblGrid><a:gridCol w="457200"/><a:gridCol w="457200"/></a:tblGrid>
              <a:tr h="228600">
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
                <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>B</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
              </a:tr>
            </a:tbl>
          </a:graphicData></a:graphic>
        </p:graphicFrame>
        """
    )


def _picture_frame() -> ET.Element:
    return _xml(
        f"""
        <p:pic xmlns:p="{NS['p']}" xmlns:a="{NS['a']}" xmlns:r="{NS['r']}">
          <p:nvPicPr><p:cNvPr id="77" name="Reference image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
          <p:spPr><a:xfrm><a:off x="914400" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
        </p:pic>
        """
    )


class OoxmlGeometryTests(unittest.TestCase):
    def test_normalize_part_allows_parent_within_package(self) -> None:
        self.assertEqual(
            _normalize_part("../charts/chart1.xml", "ppt/slides/slide1.xml"),
            "ppt/charts/chart1.xml",
        )

    def test_normalize_part_rejects_package_root_escape(self) -> None:
        for target in ("../../../../evil.xml", "..%2f..%2f..%2f..%2fevil.xml", "..\\evil.xml"):
            with self.subTest(target=target), self.assertRaises(RuntimeError):
                _normalize_part(target, "ppt/slides/slide1.xml")

    def test_grouped_geometry_is_resolved_to_slide_coordinates(self) -> None:
        root = _grouped_slide()
        child = root.find(".//p:sp", NS)
        self.assertIsNotNone(child)
        assert child is not None
        parent_map = _element_parent_map(root)

        self.assertEqual(
            _container_geometry(child),
            {"x": 96, "y": 48, "width": 48, "height": 24},
        )
        self.assertEqual(
            _container_geometry(child, parent_map),
            {"x": 288, "y": 288, "width": 96, "height": 48},
        )
        self.assertEqual(
            _group_path(child, parent_map),
            [{"shape_id": "19", "shape_name": "Outer group"}],
        )

    def test_paragraph_reader_keeps_soft_breaks_and_tabs(self) -> None:
        paragraph = _xml(
            f"""
            <a:txBody xmlns:a="{NS['a']}">
              <a:p><a:r><a:t>A</a:t></a:r><a:tab/><a:r><a:t>B</a:t></a:r><a:br/><a:r><a:t>C</a:t></a:r></a:p>
            </a:txBody>
            """
        )
        self.assertEqual(_paragraph_texts(paragraph), ["A\tB\nC"])


class AnalyzerIdentityTests(unittest.TestCase):
    def test_table_and_picture_payloads_include_identity_and_geometry(self) -> None:
        table = _table_frame()
        picture = _picture_frame()
        root = _xml(
            f"""
            <p:sld xmlns:p="{NS['p']}" xmlns:a="{NS['a']}" xmlns:r="{NS['r']}">
              <p:cSld><p:spTree>{ET.tostring(table, encoding='unicode')}{ET.tostring(picture, encoding='unicode')}</p:spTree></p:cSld>
            </p:sld>
            """
        )
        parent_map = _element_parent_map(root)
        tables = _analyze_tables(root, 4, parent_map=parent_map)
        pictures = _analyze_pictures(root, 4, parent_map=parent_map)

        self.assertEqual(tables[0]["table_id"], "s04_tbl42")
        self.assertEqual(tables[0]["shape_id"], "42")
        self.assertEqual(tables[0]["shape_name"], "Native table")
        self.assertEqual(tables[0]["container_kind"], "table")
        self.assertEqual(tables[0]["geometry"], {"x": 0, "y": 0, "width": 96, "height": 48})
        self.assertEqual(pictures[0]["picture_id"], "s04_pic77")
        self.assertEqual(pictures[0]["shape_id"], "77")
        self.assertEqual(pictures[0]["shape_name"], "Reference image")
        self.assertEqual(pictures[0]["image_rel_id"], "rId9")
        self.assertEqual(pictures[0]["geometry"], {"x": 96, "y": 0, "width": 192, "height": 96})

    def test_chart_payload_includes_identity(self) -> None:
        slide_root = _xml(
            f"""
            <p:sld xmlns:p="{NS['p']}" xmlns:a="{NS['a']}" xmlns:c="{NS['c']}" xmlns:r="{NS['r']}">
              <p:cSld><p:spTree>
                <p:graphicFrame>
                  <p:nvGraphicFramePr><p:cNvPr id="55" name="Native chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
                  <p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></p:xfrm>
                  <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
                    <c:chart r:id="rId1"/>
                  </a:graphicData></a:graphic>
                </p:graphicFrame>
              </p:spTree></p:cSld>
            </p:sld>
            """
        )
        rels = f"""
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="{CHART_REL_TYPE}" Target="../charts/chart1.xml"/>
        </Relationships>
        """
        chart = f"""
        <c:chartSpace xmlns:c="{NS['c']}" xmlns:a="{NS['a']}">
          <c:chart><c:plotArea><c:barChart><c:barDir val="col"/>
            <c:ser><c:idx val="0"/><c:order val="0"/>
              <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
              <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val>
            </c:ser>
          </c:barChart></c:plotArea></c:chart>
        </c:chartSpace>
        """
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as package:
            package.writestr("ppt/slides/_rels/slide1.xml.rels", rels)
            package.writestr("ppt/charts/chart1.xml", chart)
        with zipfile.ZipFile(io.BytesIO(payload.getvalue())) as package:
            result = _analyze_charts(
                package,
                slide_root,
                SlideRef(1, "rId1", "slides/slide1.xml", "ppt/slides/slide1.xml", "ppt/slides/_rels/slide1.xml.rels"),
            )
        self.assertEqual(result[0]["chart_id"], "s01_ch55")
        self.assertEqual(result[0]["shape_id"], "55")
        self.assertEqual(result[0]["shape_name"], "Native chart")
        self.assertEqual(result[0]["container_kind"], "chart")
        self.assertEqual(result[0]["geometry"], {"x": 0, "y": 0, "width": 96, "height": 48})


if __name__ == "__main__":
    unittest.main()
