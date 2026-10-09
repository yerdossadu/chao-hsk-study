import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import access


def user_entry(name, password):
    salt = b"0123456789abcdef"
    return {"user": name, "salt": salt.hex(), "iterations": 1000,
            "hash": hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 1000).hex()}


class AccessTests(unittest.TestCase):
    def make(self, users):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "access_users.json").write_text(json.dumps({"users": users}), encoding="utf-8")
        app = FastAPI()
        with patch.dict(os.environ, {"MEILI_ACCESS_USERS": str(tmp / "access_users.json")}):
            access.mount(app, tmp, tmp)

        @app.get("/")
        def home():
            return {"page": "reader"}

        @app.get("/api/lessons")
        def lessons():
            return []

        @app.get("/api/forma/pages/x")
        def studio():
            return {"ok": True}

        @app.get("/api/health")
        def health():
            return {"ok": True}

        return TestClient(app)

    def test_open_without_users(self):
        c = self.make([])
        self.assertEqual(c.get("/").json(), {"page": "reader"})

    def test_sign_in_flow(self):
        c = self.make([user_entry("asem", "secret1")])
        r = c.get("/", follow_redirects=False)
        self.assertEqual(r.status_code, 303)
        self.assertTrue(r.headers["location"].startswith("/login"))
        self.assertEqual(c.get("/api/lessons").status_code, 401)
        self.assertEqual(c.get("/api/health").status_code, 200)
        self.assertEqual(c.get("/api/forma/pages/x", headers={"authorization": "Bearer t"}).status_code, 200)
        bad = c.post("/login", data={"user": "asem", "password": "nope", "next": "/"}, follow_redirects=False)
        self.assertEqual(bad.status_code, 200)
        self.assertIn("Неверное", bad.text)
        good = c.post("/login", data={"user": "Asem", "password": "secret1", "next": "/"}, follow_redirects=False)
        self.assertEqual(good.status_code, 303)
        self.assertEqual(c.get("/").json(), {"page": "reader"})
        self.assertEqual(c.get("/api/lessons").status_code, 200)
        c.get("/logout", follow_redirects=False)
        c.cookies.clear()
        self.assertEqual(c.get("/api/lessons").status_code, 401)

    def test_forged_cookie_refused(self):
        c = self.make([user_entry("asem", "secret1")])
        c.cookies.set(access.COOKIE, "asem|9999999999|deadbeef")
        self.assertEqual(c.get("/api/lessons").status_code, 401)


if __name__ == "__main__":
    unittest.main()
