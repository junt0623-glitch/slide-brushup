#!/usr/bin/env python3
"""
テスト用pptxフィクスチャ生成スクリプト（python-pptx使用）。
GitHub Actions上でNode.jsのpptx生成ライブラリに頼らず済むよう、
このスクリプトの「実行結果」であるバイナリ.pptxファイルをリポジトリに
そのままコミットする運用とする（CI側での再生成は不要）。

生成物:
  - basic.pptx     : bt01（テキスト抽出）/ bt03（rels経由のスライド順解決）用
  - image.pptx      : bt02（画像バイトハッシュ一致）用
  - preserve.pptx   : bt04（温存フラグ検出）用
  - expectations.json : 上記フィクスチャの「正解」をPlaywrightテストが参照する
"""
import hashlib
import json
import os
import re
import zipfile

from PIL import Image
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Emu, Inches, Pt

OUT = os.path.dirname(os.path.abspath(__file__))

SLIDE_W = 12192000  # 16:9, EMU
SLIDE_H = 6858000


def _parse_rels(rels_xml: str) -> dict:
    out = {}
    for tag in re.findall(r"<Relationship\b[^>]*/>", rels_xml):
        idm = re.search(r'Id="([^"]+)"', tag)
        tgtm = re.search(r'Target="([^"]+)"', tag)
        if idm and tgtm:
            out[idm.group(1)] = tgtm.group(1)
    return out


def _get_slide_order_filenames(path: str):
    """presentation.xml + presentation.xml.rels から、rels経由での論理スライド順を求める。
    JS側パーサーが行うのと同じ解決手順をPythonでも踏むことで、
    フィクスチャ自体の正しさを保証する。"""
    with zipfile.ZipFile(path) as z:
        pres_xml = z.read("ppt/presentation.xml").decode("utf-8")
        rels_xml = z.read("ppt/_rels/presentation.xml.rels").decode("utf-8")
    rid_to_target = _parse_rels(rels_xml)
    m = re.search(r"<p:sldIdLst>(.*?)</p:sldIdLst>", pres_xml, re.S)
    rids = re.findall(r'r:id="([^"]+)"', m.group(1))
    return [rid_to_target[r] for r in rids]


def _rewrite_zip(path: str, mutate):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        data = {n: z.read(n) for n in names}
    mutate(data)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, data[n])


def _reverse_first_last_slide_order(path: str):
    """sldIdLst内の r:id を並べ替え、『ファイル名の物理順』と『論理表示順』を
    意図的にズラす（bt03: rels経由の正しい解決を検証するため）。"""

    def mutate(data):
        xml_text = data["ppt/presentation.xml"].decode("utf-8")
        m = re.search(r"<p:sldIdLst>(.*?)</p:sldIdLst>", xml_text, re.S)
        block = m.group(1)
        rids = re.findall(r'r:id="([^"]+)"', block)
        assert len(rids) == 3, rids
        new_rids = [rids[2], rids[1], rids[0]]
        tags = re.findall(r"<p:sldId[^/]*/>", block)
        assert len(tags) == 3
        new_tags = [
            re.sub(r'r:id="[^"]+"', f'r:id="{nr}"', tag)
            for tag, nr in zip(tags, new_rids)
        ]
        new_block = "".join(new_tags)
        new_xml = xml_text[: m.start(1)] + new_block + xml_text[m.end(1) :]
        data["ppt/presentation.xml"] = new_xml.encode("utf-8")

    _rewrite_zip(path, mutate)


def _inject_fake_diagram(path: str, logical_index: int):
    """指定した論理スライド位置(0始まり)のXMLに、SmartArt(diagram)を模した
    graphicFrameを直接注入する（python-pptxはSmartArt生成に非対応のため）。
    参照先rIdは実在しないダミーだが、本アプリの検出ロジックは
    graphicData uri文字列の走査のみで判定するため実害はない。"""
    order = _get_slide_order_filenames(path)
    target_file = "ppt/" + order[logical_index]

    def mutate(data):
        xml_text = data[target_file].decode("utf-8")
        stub = (
            "<p:graphicFrame>"
            '<p:nvGraphicFramePr><p:cNvPr id="999" name="TestDiagram"/>'
            "<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>"
            '<p:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="3000000" cy="3000000"/></p:xfrm>'
            "<a:graphic><a:graphicData "
            'uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">'
            '<dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
            'r:dm="rIdFake1" r:lo="rIdFake2" r:qs="rIdFake3" r:cs="rIdFake4"/>'
            "</a:graphicData></a:graphic></p:graphicFrame>"
        )
        assert "</p:spTree>" in xml_text
        xml_text = xml_text.replace("</p:spTree>", stub + "</p:spTree>")
        data[target_file] = xml_text.encode("utf-8")

    _rewrite_zip(path, mutate)


def _new_prs():
    prs = Presentation()
    prs.slide_width = Emu(SLIDE_W)
    prs.slide_height = Emu(SLIDE_H)
    return prs


def build_basic():
    prs = _new_prs()
    layout = prs.slide_layouts[6]  # 白紙
    contents = [
        ("フィクスチャA", "これはスライドAの本文です。改行テスト。\n二行目のテキスト。"),
        ("フィクスチャB", "スライドBの本文、太字ランを含みます。"),
        ("フィクスチャC", "スライドCの本文、これが最後のスライドです。"),
    ]
    for title, body in contents:
        slide = prs.slides.add_slide(layout)
        tb = slide.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(9), Inches(1))
        r = tb.text_frame.paragraphs[0].add_run()
        r.text = title
        r.font.size = Pt(32)
        r.font.bold = True
        bb = slide.shapes.add_textbox(Inches(0.5), Inches(1.5), Inches(9), Inches(2))
        bb.text_frame.text = body
    path = os.path.join(OUT, "basic.pptx")
    prs.save(path)
    _reverse_first_last_slide_order(path)
    return path


def build_image():
    prs = _new_prs()
    layout = prs.slide_layouts[6]
    img_path = os.path.join(OUT, "_tmp_pixel.png")
    Image.new("RGB", (60, 40), (91, 152, 133)).save(img_path, "PNG")
    with open(img_path, "rb") as f:
        img_bytes = f.read()
    img_hash = hashlib.sha256(img_bytes).hexdigest()

    slide1 = prs.slides.add_slide(layout)
    slide1.shapes.add_textbox(
        Inches(0.5), Inches(0.3), Inches(6), Inches(0.8)
    ).text_frame.text = "画像フィクスチャ"
    slide1.shapes.add_picture(
        img_path, Inches(1), Inches(1.5), width=Inches(2), height=Inches(1.333)
    )

    slide2 = prs.slides.add_slide(layout)
    slide2.shapes.add_textbox(
        Inches(0.5), Inches(0.3), Inches(6), Inches(0.8)
    ).text_frame.text = "画像フィクスチャ（同一画像の再利用）"
    slide2.shapes.add_picture(
        img_path, Inches(3), Inches(2), width=Inches(2), height=Inches(1.333)
    )

    path = os.path.join(OUT, "image.pptx")
    prs.save(path)
    os.remove(img_path)
    return path, img_hash


def build_preserve():
    prs = _new_prs()
    layout = prs.slide_layouts[6]

    s1 = prs.slides.add_slide(layout)
    s1.shapes.add_textbox(
        Inches(0.5), Inches(0.2), Inches(6), Inches(0.6)
    ).text_frame.text = "グラフを含むスライド"
    cd = CategoryChartData()
    cd.categories = ["一月", "二月", "三月"]
    cd.add_series("売上", (10, 20, 30))
    s1.shapes.add_chart(
        XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1.2), Inches(6), Inches(4), cd
    )

    s2 = prs.slides.add_slide(layout)
    s2.shapes.add_textbox(
        Inches(0.5), Inches(0.2), Inches(6), Inches(0.6)
    ).text_frame.text = "表を含むスライド"
    tbl = s2.shapes.add_table(2, 2, Inches(1), Inches(1.2), Inches(6), Inches(1.5)).table
    tbl.cell(0, 0).text = "項目"
    tbl.cell(0, 1).text = "値"
    tbl.cell(1, 0).text = "テスト行"
    tbl.cell(1, 1).text = "123"

    s3 = prs.slides.add_slide(layout)
    s3.shapes.add_textbox(
        Inches(0.5), Inches(0.2), Inches(6), Inches(0.6)
    ).text_frame.text = "通常のテキストのみ（対照群）"

    s4 = prs.slides.add_slide(layout)
    s4.shapes.add_textbox(
        Inches(0.5), Inches(0.2), Inches(6), Inches(0.6)
    ).text_frame.text = "SmartArt想定スライド"

    path = os.path.join(OUT, "preserve.pptx")
    prs.save(path)
    _inject_fake_diagram(path, logical_index=3)
    return path


def main():
    build_basic()
    _img_path, img_hash = build_image()
    build_preserve()

    expectations = {
        "basic.pptx": {
            "slideCount": 3,
            "titlesInOrder": ["フィクスチャC", "フィクスチャB", "フィクスチャA"],
            "note": "ファイル名(slide1/2/3.xml)は元のA,B,C順のままだが、"
            "sldIdLstの並びをC,B,Aに変更してある。rels経由で解決すればC,B,A、"
            "ファイル名ソートで誤解決するとA,B,Cになる。",
        },
        "image.pptx": {
            "slideCount": 2,
            "imageSha256": img_hash,
            "note": "2枚のスライドが同一画像を参照する（重複排除の確認にも使える）。",
        },
        "preserve.pptx": {
            "slideCount": 4,
            "expectedPreserve": [
                {"index": 0, "preserve": True, "reason": "chart"},
                {"index": 1, "preserve": False, "reason": None, "note": "表は再構築対象のため温存不要"},
                {"index": 2, "preserve": False, "reason": None},
                {"index": 3, "preserve": True, "reason": "smartart"},
            ],
        },
    }
    with open(os.path.join(OUT, "expectations.json"), "w", encoding="utf-8") as f:
        json.dump(expectations, f, ensure_ascii=False, indent=2)

    for name in ("basic.pptx", "image.pptx", "preserve.pptx", "expectations.json"):
        p = os.path.join(OUT, name)
        print(f"{name}: {os.path.getsize(p)} bytes")


if __name__ == "__main__":
    main()
