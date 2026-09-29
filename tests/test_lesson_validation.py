"""Run: python -m unittest discover -s tests -v (requires httpx). No real AI calls."""

import copy
import json
import os
import tempfile
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

# Keep all test data outside the real library, including import-time DB setup.
_data = tempfile.TemporaryDirectory()
_env = patch.dict(os.environ, {"CHAO_DATA_DIR": _data.name, "ADMIN_PASSWORD": "test",
                               "ALI_TOKEN_PLAN_API_KEY": "fake-test-key"})
_env.start()
import server
from layout import group_ocr_lines


def tearDownModule():
    _env.stop()
    _data.cleanup()


class LessonValidationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.auth = ("teacher", "test")
        self.book_id = "a" * 32
        server.ai_calls.clear()
        with server.connect_db() as db:
            db.execute("DELETE FROM lessons")
            db.execute("DELETE FROM books")
            db.execute("INSERT INTO books(id,title,level,filename,status,page_count) VALUES(?,?,?,?,?,?)",
                       (self.book_id, "Учебник", "HSK 1", "test.pdf", "ready", 2))
        pages = server.BOOKS_DIR / self.book_id / "pages"
        pages.mkdir(parents=True, exist_ok=True)
        for number in (1, 2):
            (pages / f"{number:04}.json").write_text(json.dumps({
                "page": number, "text": "你好", "image": f"/scans/{self.book_id}/{number}",
                "width": 600, "height": 800, "blocks": [
                    {"text": "Hello", "x": .1, "y": .1, "w": .1, "h": .025},
                    {"text": "world", "x": .22, "y": .102, "w": .12, "h": .024}
                ]}), encoding="utf-8")
        self.ai = {"title": "Приветствие", "subtitle": "Учимся здороваться", "unit": "1", "pages": [
            {"pdf_page": n, "task": "Прочитай", "chaoIntro": "Повтори слова", "vocab": [
                {"word": "你好", "py": "nǐ hǎo", "pos": "", "trans": "привет"}]} for n in (1, 2)]}

    def draft(self, value):
        response = Mock()
        response.json.return_value = {"choices": [{"message": {"content": json.dumps(value)}}]}
        with patch.object(server.requests, "post", return_value=response):
            return self.client.post(f"/api/books/{self.book_id}/draft", auth=self.auth,
                                    json={"start": 1, "end": 2})

    def publish(self, lesson):
        return self.client.post("/api/lessons", auth=self.auth,
                                json={"book_id": self.book_id, "lesson": lesson})

    def test_valid_draft_publish_and_read(self):
        # AI may return pages in a different order. The lesson must use PDF order.
        self.ai["pages"].reverse()
        response = self.draft(self.ai)
        self.assertEqual(response.status_code, 200, response.text)
        lesson = response.json()
        self.assertEqual([p["pageNum"] for p in lesson["pages"]], ["p. 1", "p. 2"])
        response = self.publish(lesson)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/api/lessons").json(), [response.json()["lesson"]])

    def test_bad_ai_shapes_are_rejected_with_502(self):
        bad = [None, [], "lesson", {}, {**self.ai, "pages": None}, {**self.ai, "pages": [None]},
               {**self.ai, "title": 123}, {**self.ai, "pages": self.ai["pages"][:1]}]
        for field, values in {"pdf_page": ["invalid", "1", None, True, 1.5, 3, 2],
                              "task": [None, [], ""], "chaoIntro": [False],
                              "vocab": [None, {}, [None], [{"word": "你好"}],
                                        [{"word": "", "py": "ni", "pos": "", "trans": "hi"}]]}.items():
            for value in values:
                item = copy.deepcopy(self.ai)
                item["pages"][0][field] = value
                bad.append(item)
        for value in bad:
            with self.subTest(value=value):
                server.ai_calls.clear()
                response = self.draft(value)
                self.assertEqual(response.status_code, 502, response.text)
                self.assertIn("некорректный урок", response.json()["detail"])
        self.assertEqual(self.client.get("/api/lessons").json(), [])

    def test_invalid_edits_cannot_overwrite_published_lesson(self):
        lesson = self.draft(self.ai).json()
        saved = self.publish(lesson).json()["lesson"]
        cases = [("pages", None), ("title", []), ("lessonId", False)]
        bad = [{**lesson, key: value} for key, value in cases]
        for path, value in [(("content", "vocab"), None), (("content", "vocab"), ["你好"]),
                            (("scan",), None), (("scan", "blocks"), [None]),
                            (("scan", "width"), 0), (("scan", "imageUrl"), f"/scans/{self.book_id}/99"),
                            (("scan", "imageUrl"), f"/scans/{'b' * 32}/1"), (("task",), None)]:
            item = copy.deepcopy(lesson)
            parent = item["pages"][0]
            for key in path[:-1]:
                parent = parent[key]
            parent[path[-1]] = value
            bad.append(item)
        for value in bad:
            with self.subTest(value=value):
                response = self.publish(value)
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(self.client.get("/api/lessons").json(), [saved])

    def test_empty_vocab_is_valid(self):
        self.ai["pages"][0]["vocab"] = []
        response = self.draft(self.ai)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.publish(response.json()).status_code, 200)

    def test_ocr_words_keep_line_geometry_and_columns_separate(self):
        lines = group_ocr_lines([
            {"text": "Good", "x": .1, "y": .1, "w": .08, "h": .025},
            {"text": "morning", "x": .19, "y": .101, "w": .13, "h": .024},
            {"text": "Exercise", "x": .7, "y": .1, "w": .15, "h": .025},
            {"text": "3", "x": .1, "y": .15, "w": .02, "h": .025},
        ])
        self.assertEqual([line["text"] for line in lines], ["Good morning", "Exercise", "3"])
        self.assertAlmostEqual(lines[0]["x"], .1)
        self.assertAlmostEqual(lines[0]["w"], .22)

    def test_electronic_draft_translates_english_and_retains_geometry(self):
        response = Mock()
        response.json.return_value = {"choices": [{"message": {"content": json.dumps({
            "translations": [{"id": "line-1", "translation": "Доброе утро"}]
        })}}]}
        with patch.object(server.requests, "post", return_value=response) as request:
            result = self.client.post(f"/api/books/{self.book_id}/electronic-draft", auth=self.auth,
                                      json={"start": 1, "end": 1, "title": "Первая страница"})
        self.assertEqual(result.status_code, 200, result.text)
        page = result.json()["pages"][0]
        self.assertEqual(page["type"], "electronic")
        self.assertEqual(page["layout"]["blocks"][0]["text"], "Hello world")
        self.assertEqual(page["layout"]["blocks"][0]["translation"], "Доброе утро")
        self.assertAlmostEqual(page["layout"]["blocks"][0]["x"], .1)
        self.assertEqual(request.call_args.args[0], server.QWEN_URL)

    def test_generated_image_is_saved_and_can_be_embedded_in_page(self):
        upload = self.client.post(f"/api/books/{self.book_id}/assets", auth=self.auth,
                                  files={"file": ("drawing.png", b"\x89PNG\r\n\x1a\nimage", "image/png")})
        self.assertEqual(upload.status_code, 200, upload.text)
        asset = upload.json()
        self.assertEqual(self.client.get(asset["url"]).status_code, 200)
        self.assertEqual(len(self.client.get(f"/api/books/{self.book_id}/assets", auth=self.auth).json()), 1)
        translation = Mock()
        translation.json.return_value = {"choices": [{"message": {"content": json.dumps({
            "translations": [{"id": "line-1", "translation": "Привет"}]
        })}}]}
        with patch.object(server.requests, "post", return_value=translation):
            draft_response = self.client.post(f"/api/books/{self.book_id}/electronic-draft", auth=self.auth,
                                              json={"start": 1, "end": 1})
        self.assertEqual(draft_response.status_code, 200, draft_response.text)
        lesson = draft_response.json()
        lesson["pages"][0]["layout"]["blocks"].append({"id": "illustration", "type": "image",
            "imageUrl": asset["url"], "alt": asset["filename"], "x": .7, "y": .72, "w": .25, "h": .25})
        self.assertEqual(self.publish(lesson).status_code, 200)
        lesson["pages"][0]["layout"]["blocks"][-1]["imageUrl"] = f"/assets/{self.book_id}/{'b'*32}.png"
        self.assertEqual(self.publish(lesson).status_code, 400)


if __name__ == "__main__":
    unittest.main()
