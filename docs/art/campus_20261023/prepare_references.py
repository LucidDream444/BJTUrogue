"""Prepare photo reference boards and exposure-dependent crop measurements.

This script only crops and lays out supplied photographs. It does not generate
pixel-art game assets. Suggested material colors are editorial estimates, not
calibrated measurements of material reflectance.

Usage:
    python prepare_references.py --source-dir <folder-containing-the-23-JPEGs>
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageStat


FILE_PATTERN = "20261023-220619.789-{number}.jpg"

# All rectangles use normalized (left, top, right, bottom) source coordinates.
# Context rectangles show construction; median rectangles isolate one surface.
SAMPLES = [
    dict(id="wood_yellow_day", label="Yellow desk / brighter exposure", source=15,
         context=(.46, .61, .68, .88), sample=(.51, .65, .64, .68),
         material="wood_honey_yellow", note="Yellow laminate over wood; open shelf is structural, not a pull-out drawer."),
    dict(id="wood_yellow_shade", label="Yellow desk / room shade", source=3,
         context=(.17, .78, .49, .94), sample=(.20, .80, .44, .825),
         material="wood_honey_yellow", note="The same yellow family appears brownish in underexposed foreground."),
    dict(id="chair_blue_day", label="Blue flip-up seat / brighter exposure", source=14,
         context=(.267, .48, .337, .77), sample=(.286, .605, .296, .650),
         material="chair_blue", note="Blue-coated curved wood with a thin yellow plywood edge; fixed dark steel frame."),
    dict(id="chair_blue_shade", label="Blue chair back / room shade", source=9,
         context=(.335, .715, .44, .92), sample=(.35, .77, .42, .86),
         material="chair_blue", note="Low exposure shifts apparent blue toward dark navy; do not treat this as a second material."),
    dict(id="curtain_blue_gray", label="Pleated blue-gray curtain", source=12,
         context=(.582, .20, .645, .392), sample=(.59, .235, .625, .335),
         material="curtain_blue_gray", note="Heavy matte cloth, broad vertical folds; less saturated than the chair coating."),
    dict(id="classroom_concrete", label="Lecture-hall aisle / worn concrete", source=21,
         context=(.445, .54, .50, .94), sample=(.466, .78, .485, .84),
         material="classroom_concrete", note="Tiered lecture-room aisle shows mottled worn gray flooring; distinguish from glazed tile in the flat classroom."),
    dict(id="corridor_glazed_tile", label="Corridor / gray-beige glazed tile", source=6,
         context=(.345, .69, .65, .955), sample=(.39, .79, .57, .865),
         material="glazed_tile_warm_gray", note="Large square tiles with thin dark joints; light dots are reflections, not white speckles in the material."),
    dict(id="stair_gray_tile", label="Stair tread / gray ceramic tile", source=8,
         context=(.21, .54, .88, .80), sample=(.38, .618, .62, .623),
         material="stair_tile_light_gray", note="Gray tile stair tread, darker riser, parallel anti-slip grooves near nosing."),
    dict(id="brick_red_day", label="Red brick / stairwell daylight", source=17,
         context=(.29, .28, .79, .49), sample=(.41, .35, .60, .43),
         material="brick_terracotta", note="Terracotta brick with pale gray mortar; daylight and white bloom lighten the brick surface."),
    dict(id="brick_red_shade", label="Red brick / indoor shade", source=18,
         context=(.36, .28, .68, .65), sample=(.42, .37, .59, .56),
         material="brick_terracotta", note="Indoor brick looks browner and darker; preserve the same terracotta material identity."),
    dict(id="lobby_dark_stone", label="Lobby / dark polished stone", source=7,
         context=(.25, .34, .60, .70), sample=(.32, .40, .48, .57),
         material="polished_stone_dark_gray", note="Fine-grained dark gray stone, large slabs; reflections vary with the viewing angle."),
    dict(id="steel_charcoal", label="Desk support / charcoal steel", source=14,
         context=(.278, .60, .344, .87), sample=(.290, .795, .295, .818),
         material="steel_charcoal", note="Painted steel pedestal and hinge hardware; do not replace the fixed seat with a portable folding chair."),
    dict(id="stainless_rail", label="Stair rail / brushed stainless steel", source=5,
         context=(.03, .42, .20, .68), sample=(.069, .58, .074, .61),
         material="stainless_steel", note="Narrow bright highlights and charcoal reflections coexist on the stainless tubes; raw median does not describe the whole metal."),
    dict(id="plaster_offwhite", label="Wall / off-white painted plaster", source=12,
         context=(.08, .19, .28, .42), sample=(.15, .23, .245, .36),
         material="plaster_offwhite", note="Neutral off-white paint with subtle wear; window light and camera white balance affect the cast."),
    dict(id="chalkboard_green", label="Chalkboard / dark muted green", source=3,
         context=(.41, .24, .51, .44), sample=(.425, .265, .49, .32),
         material="chalkboard_green", note="Dark green matte board in an aged warm metal frame; screen light is separate."),
    dict(id="black_skirt", label="Wall skirting / dark gray trim", source=6,
         context=(.84, .57, .99, .69), sample=(.925, .627, .935, .633),
         material="steel_charcoal", note="Dark wall base trim; sample may include light/shadow transitions due to the viewing angle."),
]

MATERIALS = {
    "wood_honey_yellow": dict(label="黄色木板桌 / 蜂蜜黄覆面", base="#C9AB68", light="#E1CB92", shadow="#917143",
                              explanation="以桌板较中性的黄色与断面为依据；偏白桌面含反光，棕色桌面含欠曝。"),
    "chair_blue": dict(label="蓝色翻板座椅覆面", base="#4386B6", light="#77A7C9", shadow="#28516F",
                       explanation="取中等饱和度校园座椅蓝；亮处不涂成白色，暗处不另设藏蓝材质。"),
    "curtain_blue_gray": dict(label="蓝灰色厚布窗帘", base="#465E78", light="#71849A", shadow="#2C3E51",
                             explanation="布料比座椅更灰、更暗；用宽竖褶区分材质。"),
    "classroom_concrete": dict(label="阶梯教室磨损灰色地面", base="#7D807A", light="#A1A49C", shadow="#595E5B",
                               explanation="阶梯教室过道有不规则磨痕，与平层教室的光滑地砖分开。"),
    "glazed_tile_warm_gray": dict(label="走廊灰米色釉面地砖", base="#B6B3A8", light="#D8D7CB", shadow="#8C8E87",
                                 explanation="灰米色大方砖；灯点和镜面反光不能作为固有纹理烘焙。"),
    "stair_tile_light_gray": dict(label="楼梯浅灰瓷砖", base="#BFC1BA", light="#E0E0D6", shadow="#939992",
                                 explanation="踏面偏浅灰，立面较暗；防滑细槽单独画。"),
    "brick_terracotta": dict(label="红陶砖与灰白砂浆", base="#A96149", light="#C4866C", shadow="#754432", mortar="#B2A698",
                             explanation="日光下偏粉红、室内偏棕红仍属同一红陶材质；砂浆低饱和。"),
    "polished_stone_dark_gray": dict(label="门厅深灰抛光石材", base="#444B48", light="#6E7770", shadow="#2D3432",
                                     explanation="细颗粒深灰石，反射明暗与视角有关；避免误画成纯黑。"),
    "steel_charcoal": dict(label="深灰喷涂钢架与踢脚线", base="#303638", light="#515A5D", shadow="#1E2529",
                           explanation="固定桌椅钢架为深灰近黑色，少量硬边高光。"),
    "stainless_steel": dict(label="银灰不锈钢栏杆", base="#A9B2AF", light="#E6E8DC", shadow="#626F70",
                           explanation="不锈钢无单一可从照片中还原的颜色；用冷暖窄高光与深反射条表现。"),
    "plaster_offwhite": dict(label="米白乳胶漆墙面", base="#D4D2C6", light="#E8E6DD", shadow="#AAAFA6",
                            explanation="墙面接近中性米白，照片局部偏黄或偏蓝主要来自光照与白平衡。"),
    "chalkboard_green": dict(label="深绿色磨砂黑板", base="#284B43", light="#486D5E", shadow="#1C3533",
                             explanation="比座椅更暗、更低饱和；粉笔痕作为局部纹理。"),
}


def font(size: int):
    for candidate in ("C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if Path(candidate).is_file():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size=size)


def box_px(normalized, size):
    width, height = size
    return tuple(round(value * (width if index % 2 == 0 else height))
                 for index, value in enumerate(normalized))


def rgb_hex(rgb):
    return "#" + "".join(f"{int(channel):02X}" for channel in rgb)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    destination = args.output_dir
    references = destination / "references"
    references.mkdir(parents=True, exist_ok=True)
    originals = {}
    source_records = []
    for number in range(1, 24):
        name = FILE_PATTERN.format(number=number)
        path = args.source_dir / name
        with Image.open(path) as opened:
            originals[number] = ImageOps.exif_transpose(opened).convert("RGB")
        source_records.append(dict(number=number, filename=name, width=originals[number].width,
                                   height=originals[number].height))

    contact = Image.new("RGB", (1920, 1150), "#E8E5DD")
    draw = ImageDraw.Draw(contact)
    draw.text((24, 14), "CAMPUS PHOTOGRAPH REFERENCES / 23 supplied photographs", font=font(28), fill="#26343C")
    draw.text((24, 50), "Numbers refer to filename suffixes, not chat attachment order. Photographic reference only; no generated art.",
              font=font(18), fill="#4A5659")
    for index, record in enumerate(source_records):
        number = record["number"]
        x, y = (index % 6) * 320 + 8, (index // 6) * 264 + 86
        photo = ImageOps.contain(originals[number], (304, 224), Image.Resampling.LANCZOS)
        contact.paste(photo, (x + (304 - photo.width) // 2, y))
        draw.text((x + 6, y + 229), f"{number:02d}  /  filename -{number}.jpg", font=font(16), fill="#26343C")
    contact.save(references / "reference_contact_sheet.jpg", quality=90, subsampling=0)

    study = Image.new("RGB", (1680, 1400), "#E8E5DD")
    draw = ImageDraw.Draw(study)
    draw.text((20, 16), "MATERIAL STUDY / photographed crops, raw medians, editorial intrinsic-color estimates", font=font(25), fill="#26343C")
    draw.text((20, 51), "Raw photo samples are exposure-dependent. Suggested material colors are visual estimates, not measured reflectance.",
              font=font(19), fill="#4A5659")
    draw.text((20, 79), "Green rectangle = exact median measurement region. Photographs are crops only: no pixel-art output is shown here.",
              font=font(19), fill="#4A5659")
    readings = []
    for index, spec in enumerate(SAMPLES):
        original = originals[spec["source"]]
        context_box = box_px(spec["context"], original.size)
        sample_box = box_px(spec["sample"], original.size)
        crop = original.crop(context_box)
        median = [round(channel) for channel in ImageStat.Stat(original.crop(sample_box)).median]
        readings.append(dict(id=spec["id"], label=spec["label"],
                             filename=FILE_PATTERN.format(number=spec["source"]), sourceSize=list(original.size),
                             contextRectNormalized=list(spec["context"]), contextRectPixels=list(context_box),
                             medianRectNormalized=list(spec["sample"]), medianRectPixels=list(sample_box),
                             rawMedianRgb=median, rawMedianHex=rgb_hex(median),
                             interpretation="raw_photograph_exposure_dependent_not_intrinsic_material_color",
                             suggestedMaterial=spec["material"], note=spec["note"]))
        x, y = (index % 4) * 420 + 12, (index // 4) * 316 + 126
        draw.rectangle((x, y, x + 396, y + 300), fill="#F5F2EB")
        draw.text((x + 8, y + 6), spec["label"], font=font(17), fill="#26343C")
        thumb = ImageOps.contain(crop, (380, 200), Image.Resampling.LANCZOS)
        px, py = x + 8 + (380 - thumb.width) // 2, y + 31
        study.paste(thumb, (px, py))
        sx, sy = thumb.width / crop.width, thumb.height / crop.height
        marker = (px + round((sample_box[0] - context_box[0]) * sx),
                  py + round((sample_box[1] - context_box[1]) * sy),
                  px + round((sample_box[2] - context_box[0]) * sx),
                  py + round((sample_box[3] - context_box[1]) * sy))
        draw.rectangle(marker, outline="#80FF66", width=2)
        draw.text((x + 8, y + 237), f"Photo {spec['source']:02d} / raw median {rgb_hex(median)}", font=font(15), fill="#4A5659")
        draw.rectangle((x + 8, y + 262, x + 44, y + 285), fill=tuple(median))
        draw.text((x + 50, y + 264), "raw", font=font(15), fill="#4A5659")
        suggested = MATERIALS[spec["material"]]["base"]
        draw.rectangle((x + 101, y + 262, x + 137, y + 285), fill=suggested)
        draw.text((x + 144, y + 264), f"suggested {suggested}", font=font(15), fill="#4A5659")
    study.save(references / "material_study.png")

    palette = dict(schemaVersion=1, packId="campus_20261023", artifactType="photographic_reference_analysis",
                   sourceImageCount=23, referenceNumberMeaning="Original filename suffix, not chat attachment order.",
                   colorMethod=dict(raw="Per-channel median of precisely recorded source-image crop pixels after EXIF orientation; no white-balance or exposure correction.",
                                    normalized="Editorial visual estimates of intrinsic material colors from comparison across the photographs. Not colorimetry, calibration, or exact measurements.",
                                    limitation="No color chart or capture calibration is available. Illumination, exposure, white balance, reflections, and image compression affect all raw readings."),
                   constructionNotes=["Desk storage is an open wooden cubby, without a sliding drawer front or handle.",
                                      "Seats are fixed university flip-up seats; the blue sitting panel folds upward toward its blue backrest.",
                                      "Keep the yellow wooden tabletop, visible plywood edges, and charcoal steel supports.",
                                      "Separate the worn lecture-hall aisle, glazed flat-classroom/corridor tiles, stair tiles, and polished lobby stone.",
                                      "Photographs are references only. These boards and measurements are not generated pixel art or runtime assets."],
                   materials=MATERIALS, rawCropReadings=readings, sourceImages=source_records)
    (destination / "palette.json").write_text(json.dumps(palette, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(source_records)} photographs and {len(readings)} material crop measurements.")
    print(f"Reference boards: {references}")
    print(f"Palette analysis: {destination / 'palette.json'}")


if __name__ == "__main__":
    main()
