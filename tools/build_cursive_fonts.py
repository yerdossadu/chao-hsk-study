"""Build the handwritten fonts for the copybook steps of «Письмо»: only the characters the platform needs.

Sources: Liu Jian Mao Cao (草书) and Long Cang from Google Fonts, SIL Open Font License 1.1 (no Reserved
Font Name, so a subset keeps the name). The full fonts (~5 MB each) stay outside the repo.

    python tools/build_cursive_fonts.py <folder with LiuJianMaoCao-Regular.ttf and LongCang-Regular.ttf>

Characters: every glyph of hanzi/strokes.json (the published lessons). Re-run after
tools/build_hanzi_strokes.py, when new lessons are published. Needs fonttools (pip install fonttools).
"""
import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

HANZI = Path(__file__).resolve().parent.parent / "hanzi"
FONTS = {"LiuJianMaoCao-Regular.ttf": "cursive-liujianmaocao.woff", "LongCang-Regular.ttf": "cursive-longcang.woff"}


def wanted_characters() -> list[str]:
    return [c["glyph"] for c in json.loads((HANZI / "strokes.json").read_text(encoding="utf-8"))]


def main() -> None:
    source = Path(sys.argv[1])
    chars = wanted_characters()
    for name, out in FONTS.items():
        font = TTFont(source / name)
        cmap = font.getBestCmap()
        missing = "".join(c for c in chars if ord(c) not in cmap)
        options = subset.Options()
        options.flavor = "woff"
        options.layout_features = ["*"]
        subsetter = subset.Subsetter(options)
        subsetter.populate(text="".join(chars))
        subsetter.subset(font)
        font.flavor = "woff"
        font.save(HANZI / out)
        print(f"{out}: {len(chars)} characters, {(HANZI / out).stat().st_size // 1024} KB; not in the font: {missing or 'none'}")


if __name__ == "__main__":
    main()
