"""Validate AI drafts and edited lessons before they reach the reader or database."""

import math
import re


def object_at(value, path):
    if not isinstance(value, dict):
        raise ValueError(f"{path}: ожидается объект")
    return value


def text_at(value, path, *, allow_empty=False):
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise ValueError(f"{path}: ожидается {'строка' if allow_empty else 'непустая строка'}")


def list_at(value, path, *, minimum=0, maximum=None):
    if not isinstance(value, list) or len(value) < minimum:
        raise ValueError(f"{path}: ожидается список, минимум элементов: {minimum}")
    if maximum is not None and len(value) > maximum:
        raise ValueError(f"{path}: максимум элементов: {maximum}")
    return value


def validate_vocab(value, path):
    for i, item in enumerate(list_at(value, path, maximum=20)):
        entry = object_at(item, f"{path}[{i}]")
        for key in ("word", "py", "pos", "trans"):
            text_at(entry.get(key), f"{path}[{i}].{key}", allow_empty=(key == "pos"))


def validate_ai_draft(value, expected_pages):
    draft = object_at(value, "ответ ИИ")
    for key in ("title", "subtitle", "unit"):
        text_at(draft.get(key), key, allow_empty=(key != "title"))
    pages = list_at(draft.get("pages"), "pages", minimum=1, maximum=len(expected_pages))
    seen = set()
    for i, value in enumerate(pages):
        path = f"pages[{i}]"
        page = object_at(value, path)
        number = page.get("pdf_page")
        if type(number) is not int or number not in expected_pages or number in seen:
            raise ValueError(f"{path}.pdf_page: нужен уникальный номер из выбранного диапазона")
        seen.add(number)
        for key in ("task", "chaoIntro"):
            text_at(page.get(key), f"{path}.{key}")
        validate_vocab(page.get("vocab"), f"{path}.vocab")
    if seen != set(expected_pages):
        raise ValueError("pages: ИИ вернул не все выбранные страницы")
    return draft


def number_at(value, path, *, positive=False, normalized=False):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(f"{path}: ожидается конечное число")
    if (positive and value <= 0) or (normalized and not 0 <= value <= 1):
        raise ValueError(f"{path}: число вне допустимого диапазона")


def validate_lesson(value, book_id, page_count, max_pages):
    lesson = object_at(value, "урок")
    for key in ("title", "badge", "subtitle", "unit"):
        text_at(lesson.get(key), key, allow_empty=(key in ("subtitle", "unit")))
    lesson_id = lesson.get("lessonId")
    if lesson_id is not None and not (
        (type(lesson_id) is int and lesson_id > 0)
        or (isinstance(lesson_id, str) and lesson_id.strip() and len(lesson_id) <= 128)
    ):
        raise ValueError("lessonId: ожидается непустой идентификатор")
    seen = set()
    for i, value in enumerate(list_at(lesson.get("pages"), "pages", minimum=1, maximum=max_pages)):
        path = f"pages[{i}]"
        page = object_at(value, path)
        if page.get("type") not in ("scanned", "electronic"):
            raise ValueError(f"{path}.type: ожидается scanned или electronic")
        for key in ("level", "pageNum", "navLabel", "chaoIntro", "task", "systemPrompt"):
            text_at(page.get(key), f"{path}.{key}")
        for j, word in enumerate(list_at(page.get("builderWords"), f"{path}.builderWords")):
            text_at(word, f"{path}.builderWords[{j}]")
        content = object_at(page.get("content"), f"{path}.content")
        validate_vocab(content.get("vocab"), f"{path}.content.vocab")
        if page["type"] == "electronic":
            source = object_at(page.get("sourceScan"), f"{path}.sourceScan")
            source_url = source.get("imageUrl")
            source_match = re.fullmatch(rf"/scans/{re.escape(book_id)}/([1-9][0-9]*)", source_url) \
                if isinstance(source_url, str) else None
            if not source_match or int(source_match[1]) > page_count or int(source_match[1]) in seen:
                raise ValueError(f"{path}.sourceScan.imageUrl: нужен уникальный скан этой книги")
            seen.add(int(source_match[1]))
            for key in ("width", "height"):
                number_at(source.get(key), f"{path}.sourceScan.{key}", positive=True)
            layout = object_at(page.get("layout"), f"{path}.layout")
            for key in ("width", "height"):
                number_at(layout.get(key), f"{path}.layout.{key}", positive=True)
            blocks = list_at(layout.get("blocks"), f"{path}.layout.blocks", minimum=1, maximum=500)
            ids = set()
            for j, value in enumerate(blocks):
                block_path = f"{path}.layout.blocks[{j}]"
                block = object_at(value, block_path)
                block_id = block.get("id")
                if not isinstance(block_id, str) or not block_id or block_id in ids:
                    raise ValueError(f"{block_path}.id: нужен уникальный id")
                ids.add(block_id)
                if block.get("type") == "text":
                    for key in ("text", "translation"):
                        text_at(block.get(key), f"{block_path}.{key}", allow_empty=(key == "translation"))
                    if len(block["text"]) > 2000 or len(block["translation"]) > 2000:
                        raise ValueError(f"{block_path}: строка слишком длинная")
                elif block.get("type") == "image":
                    text_at(block.get("alt"), f"{block_path}.alt")
                    url = block.get("imageUrl")
                    if not isinstance(url, str) or not re.fullmatch(
                            rf"/assets/{re.escape(book_id)}/[a-f0-9]{{32}}\.(?:png|jpg|jpeg|webp)", url):
                        raise ValueError(f"{block_path}.imageUrl: выберите загруженное изображение этой книги")
                else:
                    raise ValueError(f"{block_path}.type: ожидается text или image")
                for key in ("x", "y", "w", "h"):
                    number_at(block.get(key), f"{block_path}.{key}", normalized=True)
                if block["w"] <= 0 or block["h"] <= 0 or block["x"] + block["w"] > 1.001 or \
                        block["y"] + block["h"] > 1.001:
                    raise ValueError(f"{block_path}: область должна целиком помещаться на странице")
            continue
        scan = object_at(page.get("scan"), f"{path}.scan")
        url = scan.get("imageUrl")
        match = re.fullmatch(rf"/scans/{re.escape(book_id)}/([1-9][0-9]*)", url) if isinstance(url, str) else None
        if not match or not 1 <= int(match[1]) <= page_count or int(match[1]) in seen:
            raise ValueError(f"{path}.scan.imageUrl: нужен уникальный скан выбранного учебника")
        seen.add(int(match[1]))
        for key in ("width", "height"):
            number_at(scan.get(key), f"{path}.scan.{key}", positive=True)
        for j, value in enumerate(list_at(scan.get("blocks"), f"{path}.scan.blocks")):
            block_path = f"{path}.scan.blocks[{j}]"
            block = object_at(value, block_path)
            text_at(block.get("text"), f"{block_path}.text")
            for key in ("x", "y", "w", "h"):
                number_at(block.get(key), f"{block_path}.{key}", normalized=True)
    if len(seen) != len(lesson["pages"]):
        raise ValueError("pages: один скан нельзя добавить в урок дважды")
    return lesson
