"""Build hanzi/strokes.json for the «Письмо» exercise: only the characters the platform's lessons use.

Source: Make Me a Hanzi (https://github.com/skishore/makemeahanzi) — graphics.txt (strokes and medians,
Arphic Public License) and dictionary.txt (pinyin, LGPL). The full files (~32 MB) stay outside the repo.

    python tools/build_hanzi_strokes.py <folder with graphics.txt and dictionary.txt> [CHAO_DATA_DIR]

Characters are taken from every lesson in the data folder's library.sqlite3: vocabulary words, titles
and the text of Forma pages, plus the theme sets of «Прописные» (hanzi/hanzi-cursive.js), whose first
step shows the stroke order. Russian translations already in strokes.json are kept. Re-run after new
lessons are published.
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

HAN = re.compile(r"[㐀-鿿]")


def lesson_characters(db_path: Path) -> list[str]:
    seen: dict[str, None] = {}
    with sqlite3.connect(db_path) as db:
        for (payload,) in db.execute("SELECT payload FROM lessons ORDER BY sort_key, id"):
            text = json.loads(payload)
            for ch in HAN.findall(json.dumps(text, ensure_ascii=False)):
                seen.setdefault(ch, None)
    return list(seen)


def main() -> None:
    source = Path(sys.argv[1])
    data = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "data"
    out = Path(__file__).resolve().parent.parent / "hanzi" / "strokes.json"
    wanted = lesson_characters(data / "library.sqlite3")
    themes = (out.parent / "hanzi-cursive.js").read_text(encoding="utf-8")
    wanted += [ch for ch in re.findall(r"glyph: '(.)'", themes) if ch not in wanted]
    keep = {c["glyph"]: c for c in json.loads(out.read_text(encoding="utf-8"))} if out.is_file() else {}
    pinyin = {}
    for line in (source / "dictionary.txt").read_text(encoding="utf-8").splitlines():
        entry = json.loads(line)
        if entry.get("pinyin"):
            pinyin[entry["character"]] = entry["pinyin"][0]
    graphics = {}
    for line in (source / "graphics.txt").read_text(encoding="utf-8").splitlines():
        entry = json.loads(line)
        if entry["character"] in wanted or entry["character"] in keep:
            graphics[entry["character"]] = entry
    result, missing = [], []
    for ch in dict.fromkeys(list(keep) + wanted):
        g = graphics.get(ch)
        if not g:
            missing.append(ch)
            continue
        old = keep.get(ch, {})
        result.append({"glyph": ch, "pinyin": old.get("pinyin") or pinyin.get(ch, ""), "translation": old.get("translation", ""),
                       "medians": g["medians"], "paths": g["strokes"]})
    out.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"characters in lessons: {len(wanted)}; written: {len(result)} ({out.stat().st_size // 1024} KB); without stroke data: {''.join(missing) or 'none'}")


if __name__ == "__main__":
    main()
