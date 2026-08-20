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

from template_fill_pptx.chart_fill import (  # noqa: E402
    _apply_chart_edit_to_chart_xml,
    _apply_chart_edits_to_slide_package,
    _clone_and_update_chart_part,
    _rewrite_chart_workbook_with_sheet_name,
)
from template_fill_pptx.edit_safety import (  # noqa: E402
    _chart_edit_capability,
    _is_verified_category_capability,
)
from template_fill_pptx.ooxml import (  # noqa: E402
    CT_NS,
    CHART_CONTENT_TYPE,
    CHART_REL_TYPE,
    NS,
    PACKAGE_REL_TYPE,
    REL_NS,
    XLSX_CONTENT_TYPE,
    _normalize_part,
    _qn,
    _rels_name_for_part,
)


def _series(index: int) -> str:
    return f"""
      <c:ser><c:idx val="{index}"/><c:order val="{index}"/>
        <c:cat><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>A</c:v></c:pt></c:strCache></c:strRef></c:cat>
        <c:val><c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val>
      </c:ser>
    """


def _chart(plot_type: str = "barChart", series_count: int = 1) -> ET.Element:
    series = "".join(_series(index) for index in range(series_count))
    return ET.fromstring(
        f"""
        <c:chartSpace xmlns:c="{NS['c']}">
          <c:chart><c:plotArea><c:{plot_type}>{series}</c:{plot_type}></c:plotArea></c:chart>
        </c:chartSpace>
        """
    )


def _workbook(sheet_name: str) -> bytes:
    spreadsheet_ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    package_rels_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "xl/workbook.xml",
            f"""
            <workbook xmlns="{spreadsheet_ns}" xmlns:r="{NS['r']}">
              <sheets><sheet name="{sheet_name}" sheetId="1" r:id="rId7"/></sheets>
            </workbook>
            """,
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            f"""
            <Relationships xmlns="{package_rels_ns}">
              <Relationship Id="rId7" Type="worksheet" Target="worksheets/custom.xml"/>
            </Relationships>
            """,
        )
        archive.writestr(
            "xl/worksheets/custom.xml",
            f'<worksheet xmlns="{spreadsheet_ns}"><sheetData/></worksheet>',
        )
    return payload.getvalue()


def _slide_with_two_charts() -> ET.Element:
    return ET.fromstring(
        f"""
        <p:sld xmlns:p="{NS['p']}" xmlns:a="{NS['a']}"
               xmlns:c="{NS['c']}" xmlns:r="{NS['r']}">
          <p:cSld><p:spTree>
            <p:graphicFrame>
              <p:nvGraphicFramePr>
                <p:cNvPr id="11" name="主图表"/><p:cNvGraphicFramePr/><p:nvPr/>
              </p:nvGraphicFramePr>
              <a:graphic><a:graphicData uri="{NS['c']}">
                <c:chart r:id="rId1"/>
              </a:graphicData></a:graphic>
            </p:graphicFrame>
            <p:graphicFrame>
              <p:nvGraphicFramePr>
                <p:cNvPr id="22" name="辅助图表"/><p:cNvGraphicFramePr/><p:nvPr/>
              </p:nvGraphicFramePr>
              <a:graphic><a:graphicData uri="{NS['c']}">
                <c:chart r:id="rId2"/>
              </a:graphicData></a:graphic>
            </p:graphicFrame>
          </p:spTree></p:cSld>
        </p:sld>
        """
    )


def _slide_chart_relationships() -> ET.Element:
    image_rel_type = (
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    )
    return ET.fromstring(
        f"""
        <Relationships xmlns="{REL_NS}">
          <Relationship Id="rId1" Type="{CHART_REL_TYPE}" Target="../charts/chart1.xml"/>
          <Relationship Id="rId2" Type="{CHART_REL_TYPE}" Target="../charts/chart2.xml"/>
          <Relationship Id="rId9" Type="{image_rel_type}" Target="../media/image1.png"/>
        </Relationships>
        """
    )


def _chart_relationships(workbook_name: str) -> bytes:
    image_rel_type = (
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    )
    style_rel_type = (
        "http://schemas.microsoft.com/office/2011/relationships/chartStyle"
    )
    return (
        f"""
        <Relationships xmlns="{REL_NS}">
          <Relationship Id="rId1" Type="{PACKAGE_REL_TYPE}" Target="../embeddings/{workbook_name}"/>
          <Relationship Id="rId2" Type="{style_rel_type}" Target="style1.xml"/>
          <Relationship Id="rId3" Type="{image_rel_type}" Target="../media/image1.png"/>
        </Relationships>
        """.encode()
    )


def _chart_package_entries() -> dict[str, bytes]:
    return {
        "ppt/charts/chart1.xml": ET.tostring(_chart(), encoding="utf-8"),
        "ppt/charts/chart2.xml": ET.tostring(_chart(), encoding="utf-8"),
        "ppt/charts/_rels/chart1.xml.rels": _chart_relationships("source1.xlsx"),
        "ppt/charts/_rels/chart2.xml.rels": _chart_relationships("source2.xlsx"),
        "ppt/embeddings/source1.xlsx": _workbook("主图数据"),
        "ppt/embeddings/source2.xlsx": _workbook("辅助图数据"),
        "ppt/charts/style1.xml": b"<style/>",
        "ppt/media/image1.png": b"shared-image",
    }


def _content_types() -> ET.Element:
    root = ET.Element(_qn(CT_NS, "Types"))
    for part in ("ppt/charts/chart1.xml", "ppt/charts/chart2.xml"):
        ET.SubElement(
            root,
            _qn(CT_NS, "Override"),
            {"PartName": f"/{part}", "ContentType": CHART_CONTENT_TYPE},
        )
    for part in ("ppt/embeddings/source1.xlsx", "ppt/embeddings/source2.xlsx"):
        ET.SubElement(
            root,
            _qn(CT_NS, "Override"),
            {"PartName": f"/{part}", "ContentType": XLSX_CONTENT_TYPE},
        )
    return root


def _relationship_target(root: ET.Element, rel_id: str) -> str:
    for rel in root.findall(_qn(REL_NS, "Relationship")):
        if rel.attrib.get("Id") == rel_id:
            return rel.attrib["Target"]
    raise AssertionError(f"Missing relationship: {rel_id}")


def _workbook_part_for_chart(entries: dict[str, bytes], chart_part: str) -> str:
    rels_root = ET.fromstring(entries[_rels_name_for_part(chart_part)])
    target = _relationship_target(rels_root, "rId1")
    return _normalize_part(target, chart_part)


class ChartFillSafetyTests(unittest.TestCase):
    def test_stock_chart_is_not_generic_category_editable(self) -> None:
        chart_root = _chart("stockChart", series_count=3)

        capability = _chart_edit_capability(chart_root)

        self.assertFalse(capability["supported"])
        self.assertEqual(capability["code"], "chart_edit_stock_unsupported")
        self.assertFalse(
            _is_verified_category_capability(
                {
                    "supported": True,
                    "code": "chart_edit_category_single_plot",
                    "data_model": "category",
                    "plot_count": 1,
                    "plot_type": "stockChart",
                }
            )
        )
        with self.assertRaisesRegex(RuntimeError, "chart_edit_stock_unsupported"):
            _apply_chart_edit_to_chart_xml(
                chart_root,
                {
                    "categories": ["一月"],
                    "series": [{"name": "收盘", "values": [1]}],
                },
            )

    def test_chart_formulas_use_the_embedded_workbook_sheet_name(self) -> None:
        chart_edit = {
            "categories": ["一月", "二月"],
            "series": [{"name": "完成量", "values": [12, 18]}],
        }
        rewritten_workbook, worksheet_name = _rewrite_chart_workbook_with_sheet_name(
            _workbook("运营 数据"),
            chart_edit,
        )
        chart_root = _chart()

        _apply_chart_edit_to_chart_xml(
            chart_root,
            chart_edit,
            worksheet_name=worksheet_name,
        )

        self.assertEqual(worksheet_name, "运营 数据")
        formulas = [node.text for node in chart_root.findall(".//c:f", NS)]
        self.assertCountEqual(
            formulas,
            [
                "'运营 数据'!$B$1",
                "'运营 数据'!$A$2:$A$3",
                "'运营 数据'!$B$2:$B$3",
            ],
        )
        with zipfile.ZipFile(io.BytesIO(rewritten_workbook)) as archive:
            worksheet = ET.fromstring(archive.read("xl/worksheets/custom.xml"))
        sheet_ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        self.assertEqual(
            [cell.attrib["r"] for cell in worksheet.findall(".//s:c", sheet_ns)],
            ["A1", "B1", "A2", "B2", "A3", "B3"],
        )

    def test_chart_clone_carries_workbook_sheet_name_into_formulas(self) -> None:
        chart_edit = {
            "categories": ["一月"],
            "series": [{"name": "完成量", "values": [12]}],
        }
        entries = {
            "ppt/charts/chart1.xml": ET.tostring(_chart(), encoding="utf-8"),
            "ppt/charts/_rels/chart1.xml.rels": (
                f"""
                <Relationships xmlns="{REL_NS}">
                  <Relationship Id="rId1" Type="{PACKAGE_REL_TYPE}" Target="../embeddings/source.xlsx"/>
                </Relationships>
                """.encode()
            ),
            "ppt/embeddings/source.xlsx": _workbook("运营 数据"),
        }
        content_root = ET.Element(f"{{{CT_NS}}}Types")

        next_embedding_number, worksheet_name = _clone_and_update_chart_part(
            entries,
            content_root,
            source_chart_part="ppt/charts/chart1.xml",
            new_chart_part="ppt/charts/chart2.xml",
            chart_edit=chart_edit,
            next_embedding_number=0,
        )

        self.assertEqual((next_embedding_number, worksheet_name), (1, "运营 数据"))
        cloned_chart = ET.fromstring(entries["ppt/charts/chart2.xml"])
        self.assertTrue(
            all(
                (formula.text or "").startswith("'运营 数据'!")
                for formula in cloned_chart.findall(".//c:f", NS)
            )
        )
        self.assertIn("ppt/embeddings/templateFillChart1.xlsx", entries)

    def test_unedited_charts_and_workbooks_are_private_per_slide_clone(self) -> None:
        entries = _chart_package_entries()
        content_root = _content_types()

        first_rels = _slide_chart_relationships()
        counters = _apply_chart_edits_to_slide_package(
            _slide_with_two_charts(),
            first_rels,
            entries,
            content_root,
            source_slide=1,
            new_slide_part="ppt/slides/slide10.xml",
            chart_edits=[],
            next_chart_number=2,
            next_embedding_number=0,
        )
        second_rels = _slide_chart_relationships()
        counters = _apply_chart_edits_to_slide_package(
            _slide_with_two_charts(),
            second_rels,
            entries,
            content_root,
            source_slide=1,
            new_slide_part="ppt/slides/slide11.xml",
            chart_edits=[],
            next_chart_number=counters[0],
            next_embedding_number=counters[1],
        )

        self.assertEqual(counters, (6, 4))
        first_chart_parts = [
            _normalize_part(_relationship_target(first_rels, rel_id), "ppt/slides/slide10.xml")
            for rel_id in ("rId1", "rId2")
        ]
        second_chart_parts = [
            _normalize_part(_relationship_target(second_rels, rel_id), "ppt/slides/slide11.xml")
            for rel_id in ("rId1", "rId2")
        ]
        self.assertEqual(first_chart_parts, ["ppt/charts/chart3.xml", "ppt/charts/chart4.xml"])
        self.assertEqual(second_chart_parts, ["ppt/charts/chart5.xml", "ppt/charts/chart6.xml"])
        self.assertEqual(len(set(first_chart_parts + second_chart_parts)), 4)

        workbook_parts = [
            _workbook_part_for_chart(entries, chart_part)
            for chart_part in first_chart_parts + second_chart_parts
        ]
        self.assertEqual(len(set(workbook_parts)), 4)
        self.assertEqual(
            workbook_parts,
            [
                "ppt/embeddings/templateFillChart1.xlsx",
                "ppt/embeddings/templateFillChart2.xlsx",
                "ppt/embeddings/templateFillChart3.xlsx",
                "ppt/embeddings/templateFillChart4.xlsx",
            ],
        )
        self.assertEqual(entries[workbook_parts[0]], entries["ppt/embeddings/source1.xlsx"])
        self.assertEqual(entries[workbook_parts[1]], entries["ppt/embeddings/source2.xlsx"])
        self.assertEqual(entries[workbook_parts[2]], entries["ppt/embeddings/source1.xlsx"])
        self.assertEqual(entries[workbook_parts[3]], entries["ppt/embeddings/source2.xlsx"])
        self.assertEqual(_relationship_target(first_rels, "rId9"), "../media/image1.png")
        self.assertEqual(
            [name for name in entries if name.startswith("ppt/media/")],
            ["ppt/media/image1.png"],
        )

    def test_selective_edit_still_clones_every_chart_and_only_rewrites_target(self) -> None:
        entries = _chart_package_entries()
        original_chart2 = entries["ppt/charts/chart2.xml"]
        original_workbook1 = entries["ppt/embeddings/source1.xlsx"]
        original_workbook2 = entries["ppt/embeddings/source2.xlsx"]
        rels_root = _slide_chart_relationships()

        counters = _apply_chart_edits_to_slide_package(
            _slide_with_two_charts(),
            rels_root,
            entries,
            _content_types(),
            source_slide=1,
            new_slide_part="ppt/slides/slide10.xml",
            chart_edits=[
                {
                    "chart_id": "s01_ch11",
                    "categories": ["一月", "二月"],
                    "series": [{"name": "完成量", "values": [12, 18]}],
                }
            ],
            next_chart_number=2,
            next_embedding_number=0,
        )

        self.assertEqual(counters, (4, 2))
        edited_chart = "ppt/charts/chart3.xml"
        untouched_chart = "ppt/charts/chart4.xml"
        self.assertEqual(
            _normalize_part(_relationship_target(rels_root, "rId1"), "ppt/slides/slide10.xml"),
            edited_chart,
        )
        self.assertEqual(
            _normalize_part(_relationship_target(rels_root, "rId2"), "ppt/slides/slide10.xml"),
            untouched_chart,
        )
        self.assertNotEqual(entries[edited_chart], entries["ppt/charts/chart1.xml"])
        self.assertEqual(entries[untouched_chart], original_chart2)

        edited_workbook = _workbook_part_for_chart(entries, edited_chart)
        untouched_workbook = _workbook_part_for_chart(entries, untouched_chart)
        self.assertNotEqual(entries[edited_workbook], original_workbook1)
        self.assertEqual(entries[untouched_workbook], original_workbook2)
        self.assertEqual(entries["ppt/embeddings/source1.xlsx"], original_workbook1)
        self.assertEqual(entries["ppt/embeddings/source2.xlsx"], original_workbook2)
        self.assertEqual(
            _relationship_target(
                ET.fromstring(entries[_rels_name_for_part(untouched_chart)]),
                "rId3",
            ),
            "../media/image1.png",
        )


if __name__ == "__main__":
    unittest.main()
