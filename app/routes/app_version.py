"""Which frontend build is being served, so open windows can pick up a new one.

The Basira desktop app (a WKWebView) and browser tabs stay open for days. Without
this they keep running whatever JavaScript they loaded at launch, so a rebuilt
frontend never reaches them. ``build_version`` fingerprints the built index.html
(it names the hashed bundles, so it changes on every build); the page compares it
with the version it started with and reloads when they differ.
"""

import hashlib
import os

from fastapi import APIRouter
from fastapi.responses import FileResponse

# The page itself must always be revalidated; the hashed bundles never change.
NO_CACHE = {"Cache-Control": "no-cache, must-revalidate"}
IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}

_cache: dict[str, tuple[float, str]] = {}


def build_version(dist_dir: str) -> str:
    path = os.path.join(dist_dir, "index.html")
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return "dev"
    hit = _cache.get(path)
    if hit and hit[0] == mtime:
        return hit[1]
    with open(path, "rb") as f:
        version = hashlib.sha256(f.read()).hexdigest()[:16]
    _cache[path] = (mtime, version)
    return version


def make_router(dist_dir: str) -> APIRouter:
    router = APIRouter(tags=["app"])

    @router.get("/app-version")
    def app_version():
        return {"version": build_version(dist_dir)}

    return router


def index_response(dist_dir: str) -> FileResponse:
    return FileResponse(os.path.join(dist_dir, "index.html"), headers=NO_CACHE)
