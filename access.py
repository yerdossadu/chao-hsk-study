"""Sign-in for the learners (user name + password), so the site is not open to anyone who finds its address.

The users live in access_users.json beside this file: names with a salted PBKDF2-SHA256 of each password,
written by the studio owner's own tool on his computer (the passwords themselves are never stored or sent).
With no users listed the site stays open, as before. A signed cookie keeps a learner signed in for 90 days.
Forma Studio's publishing (Bearer token on /api/forma/…) and the health check are not behind the sign-in.
"""
import hashlib
import hmac
import json
import os
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

COOKIE = "meili_session"
DAYS = 90


def load_users(app_dir: Path) -> dict:
    f = Path(os.environ.get("MEILI_ACCESS_USERS") or app_dir / "access_users.json")   # tests point it at an empty list
    try:
        data = json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {}
    except (OSError, ValueError):
        return {}
    return {u["user"].strip().lower(): u for u in data.get("users", []) if u.get("user") and u.get("hash") and u.get("salt")}


def check_password(entry: dict, password: str) -> bool:
    got = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(entry["salt"]), int(entry.get("iterations", 200000)))
    return hmac.compare_digest(got.hex(), entry["hash"].lower())


LOGIN_PAGE = """<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вход · Meili HSK Study</title><link rel="icon" type="image/png" href="/icons/meili-icon-64.png">
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4efe9;font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#203047}
form{width:min(340px,90vw);background:#fff;border-radius:18px;padding:28px 26px;box-shadow:0 10px 30px #0001;display:grid;gap:12px;text-align:center}
img{width:96px;height:96px;margin:0 auto 4px}
h1{margin:0 0 6px;font-size:20px}
input{font:inherit;padding:11px 12px;border:1px solid #d6d9df;border-radius:10px}
button{font:inherit;font-weight:600;padding:11px;border:0;border-radius:10px;background:#1d5c57;color:#fff;cursor:pointer}
.err{color:#b23b2e;font-size:14px;min-height:1em}
</style></head><body>
<form method="post" action="/login"><img src="/icons/meili-icon-192.png" alt=""><h1>Meili HSK Study</h1>
<input name="user" placeholder="Имя пользователя" autocomplete="username" required autofocus>
<input name="password" type="password" placeholder="Пароль" autocomplete="current-password" required>
<input type="hidden" name="next" value="__NEXT__">
<div class="err">__ERR__</div><button type="submit">Войти</button></form></body></html>"""


def mount(app: FastAPI, app_dir: Path, data_dir: Path):
    users = load_users(app_dir)
    secret_file = data_dir / "session_secret"
    if not secret_file.is_file():
        secret_file.write_text(secrets.token_hex(32), encoding="utf-8")
    key = secret_file.read_text(encoding="utf-8").strip().encode()
    tries: dict[str, deque] = defaultdict(deque)

    def sign(user: str, until: int) -> str:
        body = f"{user}|{until}"
        return body + "|" + hmac.new(key, body.encode(), hashlib.sha256).hexdigest()

    def signed_in(request: Request) -> str | None:
        raw = request.cookies.get(COOKIE, "")
        try:
            user, until, mac = raw.split("|")
        except ValueError:
            return None
        good = hmac.compare_digest(mac, hmac.new(key, f"{user}|{until}".encode(), hashlib.sha256).hexdigest())
        return user if good and int(until) > time.time() and user in users else None

    @app.middleware("http")
    async def gate(request: Request, call_next):
        local = request.client and request.client.host in ("127.0.0.1", "::1") and request.url.hostname in ("127.0.0.1", "localhost")
        if not users or local:   # the owner's own computer (the studio's platform) needs no sign-in
            return await call_next(request)
        p = request.url.path
        open_paths = p in ("/login", "/logout", "/api/health") or p.startswith("/icons/")
        studio = p.startswith("/api/forma/") and request.headers.get("authorization", "").startswith(("Bearer ", "Basic "))
        if open_paths or studio or signed_in(request):
            return await call_next(request)
        if p.startswith("/api/") or p.startswith("/forma/"):
            return JSONResponse({"detail": "Нужно войти."}, status_code=401)
        return RedirectResponse("/login?next=" + (p if p.startswith("/") else "/"), status_code=303)

    def page(err: str = "", nxt: str = "/") -> HTMLResponse:
        safe = nxt if nxt.startswith("/") and not nxt.startswith("//") else "/"
        return HTMLResponse(LOGIN_PAGE.replace("__ERR__", err).replace("__NEXT__", safe.replace('"', "")))

    @app.get("/login")
    def login_form(next: str = "/"):
        return page(nxt=next)

    @app.post("/login")
    def login(request: Request, user: str = Form(...), password: str = Form(...), next: str = Form("/")):
        ip = request.client.host if request.client else "?"
        now, q = time.time(), tries[ip]
        while q and now - q[0] > 600:
            q.popleft()
        if len(q) >= 10:
            return page("Слишком много попыток. Подождите 10 минут.", next)
        entry = users.get(user.strip().lower())
        if not entry or not check_password(entry, password):
            q.append(now)
            return page("Неверное имя или пароль.", next)
        until = int(now + DAYS * 86400)
        target = next if next.startswith("/") and not next.startswith("//") else "/"
        resp = RedirectResponse(target, status_code=303)
        resp.set_cookie(COOKIE, sign(entry["user"].strip().lower(), until), max_age=DAYS * 86400, httponly=True,
                        secure=request.url.scheme == "https", samesite="lax")
        return resp

    @app.get("/logout")
    def logout():
        resp = RedirectResponse("/login", status_code=303)
        resp.delete_cookie(COOKIE)
        return resp
