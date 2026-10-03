"""Pages published from Forma Studio (the platform's management console).

Forma Studio converts textbook pages into HTML built from its own component
set, and publishes each confirmed page here together with its pictures, the
book's character portraits and the page video. The platform groups pages into
lessons of a section (for example "HSK 1 v3.0") and serves them to the reader,
where the usual scenarios (vocabulary, flashcards, sentence builder, tutor)
work on them like on any other page.

Storage, under CHAO_DATA_DIR:
    forma/components.css, forma/forma-page.js   shared page runtime from Forma
    forma/books/<book>/pages/<nnn>/page.json     one published page
    forma/books/<book>/pages/<nnn>/assets/...    its pictures, clip and poster
    forma/books/<book>/cast/...                  portraits shared by the book
Lessons are rebuilt from the page files after every change and stored in the
regular `lessons` table, so /api/lessons delivers them with all other lessons.
"""

import base64
import binascii
import json
import os
import re
import secrets
import shutil
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from lesson_validation import validate_vocab

MAX_HTML = 2 * 1024 * 1024
MAX_FILE = 200 * 1024 * 1024
MAX_FILES = 80
SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
# Paths a publish may write, relative to the book folder.
FILE_PATH = re.compile(r"(?:pages/[0-9]{3}/(?:assets/)?|cast/)[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:webp|png|jpe?g|mp4|webm|mov|mp3|m4a|aac|ogg|wav)")
MEDIA = {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
         ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".wav": "audio/wav",
         ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8"}


def _text(value, limit, path, *, required=True):
    if not isinstance(value, str) or (required and not value.strip()) or len(value) > limit:
        raise ValueError(f"{path}: ожидается строка до {limit} символов")
    return value.strip()


def validate_forma_meta(meta: Any):
    """Check the description of one published page (the HTML is checked apart)."""
    if not isinstance(meta, dict):
        raise ValueError("meta: ожидается объект")
    book = meta.get("book")
    if not isinstance(book, dict) or not isinstance(book.get("slug"), str) or not SLUG.fullmatch(book["slug"]):
        raise ValueError("book.slug: латиница, цифры и дефис")
    _text(book.get("title"), 160, "book.title")
    _text(book.get("section"), 80, "book.section")
    _text(book.get("level"), 20, "book.level")
    page = meta.get("page")
    if not isinstance(page, dict) or type(page.get("n")) is not int or not 1 <= page["n"] <= 999:
        raise ValueError("page.n: номер страницы PDF от 1 до 999")
    for key, limit in (("pageNum", 40), ("navLabel", 120), ("chaoIntro", 600), ("task", 600), ("systemPrompt", 3000), ("aspect", 20)):
        _text(page.get(key), limit, f"page.{key}")
    if not re.fullmatch(r"[0-9]{2,5}/[0-9]{2,5}", page["aspect"]):
        raise ValueError("page.aspect: пропорции страницы вида 2342/3190")
    crop = page.get("crop", {})
    if not isinstance(crop, dict) or any(k not in ("left", "right") or type(v) not in (int, float) or not 0 <= v <= 0.2
                                         for k, v in crop.items()):
        raise ValueError("page.crop: обрезка полей left/right от 0 до 0.2")
    # Texts in the other reading languages (English, Kazakh); Russian stays in the main fields.
    for owner, keys in ((page, ("chaoIntro", "task")), (meta.get("lesson") or {}, ("subtitle",))):
        tr = owner.get("i18n")
        if tr is None:
            continue
        if not isinstance(tr, dict) or any(lang not in ("en", "kz") or not isinstance(v, dict) for lang, v in tr.items()):
            raise ValueError("i18n: языки en/kz со строками")
        for lang, v in tr.items():
            for k, s in v.items():
                if k not in keys or not isinstance(s, str) or len(s) > 600:
                    raise ValueError(f"i18n.{lang}.{k}: строка до 600 символов")
    # Optional copy of the printed page (a file sent with the page), shown on demand.
    scan = page.get("scan")
    if scan is not None and (not isinstance(scan, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.(?:webp|png|jpe?g)", scan)
                             or f"pages/{page['n']:03}/{scan}" not in (meta.get("files") or [])):
        raise ValueError("page.scan: имя файла скана из списка files")
    words = page.get("builderWords")
    if not isinstance(words, list) or len(words) > 12 or not all(isinstance(w, str) and 0 < len(w) <= 40 for w in words):
        raise ValueError("page.builderWords: до 12 непустых строк")
    validate_vocab(page.get("vocab"), "page.vocab")
    lesson = meta.get("lesson")
    if not isinstance(lesson, dict) or type(lesson.get("number")) is not int or not 0 <= lesson["number"] <= 999:
        raise ValueError("lesson.number: номер урока")
    _text(lesson.get("title"), 160, "lesson.title")
    _text(lesson.get("subtitle"), 160, "lesson.subtitle", required=False)
    files = meta.get("files")
    if not isinstance(files, list) or len(files) > MAX_FILES:
        raise ValueError(f"files: до {MAX_FILES} файлов")
    for i, path in enumerate(files):
        if not isinstance(path, str) or not FILE_PATH.fullmatch(path):
            raise ValueError(f"files[{i}]: недопустимый путь файла")
        if path.startswith("pages/") and path[6:9] != f"{page['n']:03}":
            raise ValueError(f"files[{i}]: файл другой страницы")
    return meta


def mount(app: FastAPI, data_dir: Path, connect_db, require_teacher):
    root = data_dir / "forma"
    books = root / "books"
    books.mkdir(parents=True, exist_ok=True)

    def require_publisher(request: Request):
        """Forma Studio signs in with FORMA_PUBLISH_TOKEN (Bearer); the
        teacher's password (Basic) works too."""
        header = request.headers.get("authorization", "")
        token = os.environ.get("FORMA_PUBLISH_TOKEN", "")
        if token and header.startswith("Bearer ") and secrets.compare_digest(header[7:].strip(), token):
            return True
        if header.startswith("Basic "):
            try:
                user, _, password = base64.b64decode(header[6:]).decode("utf-8").partition(":")
            except (binascii.Error, UnicodeDecodeError):
                user, password = "", ""
            expected = os.environ.get("ADMIN_PASSWORD", "")
            if expected and secrets.compare_digest(user, "teacher") and secrets.compare_digest(password, expected):
                return True
        raise HTTPException(401, "Нужен токен публикации Forma (FORMA_PUBLISH_TOKEN) или пароль преподавателя.",
                            headers={"WWW-Authenticate": "Bearer"})

    def page_dir(slug: str, n: int) -> Path:
        return books / slug / "pages" / f"{n:03}"

    def rebuild_lessons(slug: str):
        """Lessons of a book from its published pages, one row per lesson."""
        pages = []
        pages_root = books / slug / "pages"
        if pages_root.is_dir():
            for folder in sorted(pages_root.iterdir()):
                entry = folder / "page.json"
                if entry.is_file():
                    pages.append(json.loads(entry.read_text(encoding="utf-8")))
        by_lesson: dict[int, list] = {}
        for meta in pages:
            by_lesson.setdefault(meta["lesson"]["number"], []).append(meta)
        with connect_db() as db:
            # By book, not by id prefix: «forma-hsk1-v3-%» also matched the workbook's «forma-hsk1-v3-workbook-…»,
            # so publishing a textbook page wiped the workbook's lessons.
            db.execute("DELETE FROM lessons WHERE book_id = ?", (f"forma:{slug}",))
            for number, items in by_lesson.items():
                items.sort(key=lambda m: m["page"]["n"])
                head = items[0]
                book, lesson = head["book"], next((m["lesson"] for m in items if m["lesson"].get("opener")), head["lesson"])
                lesson_id = f"forma-{slug}-{number:03}"
                payload = {
                    "lessonId": lesson_id, "source": "forma", "section": book["section"],
                    "kind": "workbook" if ("workbook" in slug or "тетрад" in book["section"].lower()) else "textbook",
                    "unit": book["section"], "level": book["level"],
                    "badge": f"第 {number} 课" if number else book["section"],
                    "title": lesson["title"], "subtitle": lesson.get("subtitle", ""), "i18n": lesson.get("i18n") or {},
                    "pages": [m["platformPage"] for m in items],
                }
                db.execute("INSERT INTO lessons(id,book_id,title,level,payload,sort_key) VALUES(?,?,?,?,?,?)",
                           (lesson_id, f"forma:{slug}", lesson["title"], book["level"],
                            json.dumps(payload, ensure_ascii=False), f"forma|{book['section']}|{number:04}"))

    # The published pages are the source of truth: rebuild every book's lessons on start
    # (this also brings back lessons lost to the old prefix bug).
    for folder in sorted(books.iterdir()):
        if folder.is_dir() and SLUG.fullmatch(folder.name):
            try:
                rebuild_lessons(folder.name)
            except (OSError, ValueError, KeyError) as exc:   # one broken book must not stop the platform
                print(f"forma: lessons of {folder.name} not rebuilt: {exc}")

    @app.post("/api/forma/pages")
    async def publish_page(request: Request, meta: str = Form(...), html: str = Form(...),
                           css: str = Form(""), script: str = Form(""),
                           files: list[UploadFile] = File(default=[])):
        require_publisher(request)
        try:
            data = validate_forma_meta(json.loads(meta))
        except (ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(400, f"Страница не принята: {exc}") from None
        if not html.strip() or len(html) > MAX_HTML or "<script" in html.lower():
            raise HTTPException(400, "Страница не принята: пустой или недопустимый HTML.")
        if len(files) != len(data["files"]):
            raise HTTPException(400, "Страница не принята: список файлов не совпадает с вложениями.")
        slug, n = data["book"]["slug"], data["page"]["n"]
        book_dir, target = books / slug, page_dir(slug, n)
        # A new version replaces the page's files; the book's cast is shared.
        staging = target.with_name(target.name + f".new-{secrets.token_hex(4)}")
        staging.mkdir(parents=True)
        try:
            for path, upload in zip(data["files"], files):
                content = await upload.read(MAX_FILE + 1)
                if not content or len(content) > MAX_FILE:
                    raise HTTPException(413, f"Файл {path} пустой или больше 200 МБ.")
                dest = (staging / path[10:]) if path.startswith("pages/") else (book_dir / path)
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(content)
            base = f"/forma/books/{slug}/pages/{n:03}/"
            p = data["page"]
            platform_page = {
                "type": "forma", "level": data["book"]["level"], "pageNum": p["pageNum"], "navLabel": p["navLabel"],
                "chaoIntro": p["chaoIntro"], "task": p["task"], "builderWords": p["builderWords"],
                "systemPrompt": p["systemPrompt"], "content": {"vocab": p["vocab"]}, "i18n": p.get("i18n") or {},
                "forma": {"html": html, "aspect": p["aspect"], "crop": p.get("crop", {}), "base": base, "sourcePage": n,
                          **({"scan": base + p["scan"]} if p.get("scan") else {}),
                          "css": f"/forma/components.css?v={int(time.time())}", "script": f"/forma/forma-page.js?v={int(time.time())}"},
            }
            record = {**data, "platformPage": platform_page, "publishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            (staging / "page.json").write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
            if target.exists():
                shutil.rmtree(target)
            staging.rename(target)
        finally:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
        # Runtime shared by all Forma pages: styles and the text-fitting script.
        if css.strip() and len(css) < 512 * 1024:
            (root / "components.css").write_text(css, encoding="utf-8")
        if script.strip() and len(script) < 256 * 1024:
            (root / "forma-page.js").write_text(script, encoding="utf-8")
        rebuild_lessons(slug)
        return {"ok": True, "lessonId": f"forma-{slug}-{data['lesson']['number']:03}", "page": n,
                "publishedAt": record["publishedAt"]}

    @app.delete("/api/forma/pages/{slug}/{n}")
    def unpublish_page(slug: str, n: int, request: Request):
        require_publisher(request)
        if not SLUG.fullmatch(slug) or not 1 <= n <= 999:
            raise HTTPException(404, "Страница не найдена")
        target = page_dir(slug, n)
        if not target.is_dir():
            raise HTTPException(404, "Страница не опубликована")
        shutil.rmtree(target)
        rebuild_lessons(slug)
        return {"ok": True}

    @app.get("/api/forma/pages/{slug}")
    def published_pages(slug: str, request: Request):
        """What is on the platform for a book: page number → publish time."""
        require_publisher(request)
        if not SLUG.fullmatch(slug):
            raise HTTPException(404, "Книга не найдена")
        out = {}
        pages_root = books / slug / "pages"
        if pages_root.is_dir():
            for folder in pages_root.iterdir():
                entry = folder / "page.json"
                if entry.is_file():
                    record = json.loads(entry.read_text(encoding="utf-8"))
                    out[str(record["page"]["n"])] = {"publishedAt": record["publishedAt"], "lesson": record["lesson"]["number"]}
        return {"slug": slug, "pages": out}

    @app.get("/api/forma/health")
    def forma_health(request: Request):
        require_publisher(request)
        return {"ok": True, "tokenConfigured": bool(os.environ.get("FORMA_PUBLISH_TOKEN"))}

    @app.get("/forma/{path:path}")
    def forma_file(path: str):
        """Published pages' files, the shared runtime and cast portraits."""
        if path in ("components.css", "forma-page.js"):
            target = root / path
        elif re.fullmatch(r"books/[a-z0-9][a-z0-9-]{0,63}/" + FILE_PATH.pattern, path):
            target = root / path
        else:
            raise HTTPException(404, "Файл не найден")
        if not target.is_file():
            raise HTTPException(404, "Файл не найден")
        return FileResponse(target, media_type=MEDIA.get(target.suffix.lower(), "application/octet-stream"),
                            headers={"Cache-Control": "public, max-age=300"})
