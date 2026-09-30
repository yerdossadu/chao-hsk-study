"""Publishing pages from Forma Studio: validation, storage, lessons, access."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("CHAO_DATA_DIR", tempfile.mkdtemp(prefix="chao-test-"))
os.environ["FORMA_PUBLISH_TOKEN"] = "test-token-for-unit-tests"

from fastapi.testclient import TestClient  # noqa: E402

import forma  # noqa: E402
import server  # noqa: E402

AUTH = {"authorization": "Bearer test-token-for-unit-tests"}


def meta(n=16, lesson=1, files=None):
    return {
        "book": {"slug": "hsk1-v3", "title": "HSK Course 1", "section": "HSK 1 v3.0", "level": "HSK 1"},
        "page": {"n": n, "pageNum": "с. 1", "navLabel": "Стр. 1 · 课文 1", "aspect": "2342/3190",
                 "chaoIntro": "Привет!", "task": "朗读对话。", "systemPrompt": "Ты Сяо Чао.",
                 "builderWords": ["你", "好！"], "vocab": [{"word": "你好", "py": "nǐ hǎo", "pos": "", "trans": "привет"}]},
        "lesson": {"number": lesson, "title": "AI小语，你好！", "subtitle": "Привет, AI Сяоюй!", "opener": True},
        "files": files if files is not None else [f"pages/{n:03}/assets/img-6.webp"],
    }


class FormaPublishTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)

    def publish(self, data, files=(("files", ("img-6.webp", b"RIFF0000WEBPVP8 ", "image/webp")),), headers=AUTH):
        return self.client.post("/api/forma/pages", headers=headers, files=list(files),
                                data={"meta": json.dumps(data), "html": '<div class="hsk-page">你好</div>',
                                      "css": ".hsk-page{}", "script": "window.FormaPage={}"})

    def test_publish_builds_lesson_in_section(self):
        response = self.publish(meta())
        self.assertEqual(response.status_code, 200, response.text)
        lessons = [l for l in self.client.get("/api/lessons").json() if l.get("source") == "forma"]
        lesson = next(l for l in lessons if l["lessonId"] == "forma-hsk1-v3-001")
        self.assertEqual(lesson["section"], "HSK 1 v3.0")
        page = lesson["pages"][0]
        self.assertEqual(page["type"], "forma")
        self.assertEqual(page["content"]["vocab"][0]["word"], "你好")
        self.assertEqual(self.client.get("/forma/books/hsk1-v3/pages/016/assets/img-6.webp").status_code, 200)
        self.assertEqual(self.client.get("/forma/components.css").status_code, 200)

    def test_requires_token(self):
        self.assertEqual(self.publish(meta(), headers={}).status_code, 401)
        self.assertEqual(self.publish(meta(), headers={"authorization": "Bearer wrong"}).status_code, 401)

    def test_rejects_foreign_paths_and_scripts(self):
        bad = meta(files=["../server.py"])
        self.assertEqual(self.publish(bad).status_code, 400)
        other_page = meta(files=["pages/017/assets/img-6.webp"])
        self.assertEqual(self.publish(other_page).status_code, 400)
        response = self.client.post("/api/forma/pages", headers=AUTH, data={
            "meta": json.dumps(meta(files=[])), "html": "<script>alert(1)</script>"})
        self.assertEqual(response.status_code, 400)

    def test_unpublish_removes_page(self):
        self.assertEqual(self.publish(meta(n=30, lesson=5, files=[]), files=()).status_code, 200)
        self.assertIn("30", self.client.get("/api/forma/pages/hsk1-v3", headers=AUTH).json()["pages"])
        self.assertEqual(self.client.delete("/api/forma/pages/hsk1-v3/30", headers=AUTH).status_code, 200)
        self.assertNotIn("30", self.client.get("/api/forma/pages/hsk1-v3", headers=AUTH).json()["pages"])

    def test_meta_validation(self):
        with self.assertRaises(ValueError):
            forma.validate_forma_meta({**meta(), "book": {"slug": "Bad Slug"}})


if __name__ == "__main__":
    unittest.main()
