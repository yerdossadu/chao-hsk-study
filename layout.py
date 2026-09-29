"""Utilities for retaining page geometry while turning OCR into editable blocks."""

from statistics import median


def group_ocr_lines(blocks):
    """Group Tesseract word boxes into lines/columns with normalized page bounds."""
    words = [b for b in blocks if isinstance(b, dict) and isinstance(b.get("text"), str)
             and b["text"].strip() and all(isinstance(b.get(k), (int, float))
             for k in ("x", "y", "w", "h"))]
    if not words:
        return []
    rows = []
    for word in sorted(words, key=lambda b: (b["y"] + b["h"] / 2, b["x"])):
        center = word["y"] + word["h"] / 2
        candidates = [(abs(center - row["center"]), row) for row in rows
                      if abs(center - row["center"]) <= max(word["h"], row["height"]) * .6]
        if candidates:
            _, row = min(candidates, key=lambda item: item[0])
            row["words"].append(word)
            row["center"] = sum(w["y"] + w["h"] / 2 for w in row["words"]) / len(row["words"])
            row["height"] = median(w["h"] for w in row["words"])
        else:
            rows.append({"center": center, "height": word["h"], "words": [word]})

    lines = []
    for row in sorted(rows, key=lambda r: r["center"]):
        row_words = sorted(row["words"], key=lambda b: b["x"])
        segments, current = [], []
        for word in row_words:
            if current:
                gap = word["x"] - (current[-1]["x"] + current[-1]["w"])
                if gap > max(row["height"] * 3, .025):
                    segments.append(current)
                    current = []
            current.append(word)
        if current:
            segments.append(current)
        for segment in segments:
            text = "".join(w["text"] for w in segment) if any(
                any("\u3400" <= ch <= "\u9fff" for ch in w["text"]) for w in segment
            ) else " ".join(w["text"] for w in segment)
            x0, y0 = min(w["x"] for w in segment), min(w["y"] for w in segment)
            x1 = max(w["x"] + w["w"] for w in segment)
            y1 = max(w["y"] + w["h"] for w in segment)
            lines.append({"text": text, "x": x0, "y": y0, "w": x1-x0, "h": y1-y0})
    return [{"id": f"line-{i+1}", **line} for i, line in enumerate(lines)]
