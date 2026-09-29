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
        if page.get("type") != "scanned":
            raise ValueError(f"{path}.type: ожидается scanned")
        for key in ("level", "pageNum", "navLabel", "chaoIntro", "task", "systemPrompt"):
            text_at(page.get(key), f"{path}.{key}")
        for j, word in enumerate(list_at(page.get("builderWords"), f"{path}.builderWords")):
            text_at(word, f"{path}.builderWords[{j}]")
        content = object_at(page.get("content"), f"{path}.content")
        validate_vocab(content.get("vocab"), f"{path}.content.vocab")
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
    return lesson
