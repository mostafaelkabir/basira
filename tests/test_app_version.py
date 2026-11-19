"""Open windows pick up a new frontend build. Never imports app.main.

Proves: /app-version fingerprints the built index.html and changes when the build
changes; the page is served with no-cache so a reload always fetches it.
"""
import os
import tempfile
import time
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.app_version import build_version, index_response, make_router


class AppVersionTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.write('<script src="/assets/index-AAA.js"></script>')
        api = FastAPI()
        api.include_router(make_router(self.dir))
        api.get("/")(lambda: index_response(self.dir))
        self.client = TestClient(api)

    def write(self, html):
        path = os.path.join(self.dir, "index.html")
        with open(path, "w") as f:
            f.write(html)
        os.utime(path, (time.time() + len(html), time.time() + len(html)))   # distinct mtime per build

    def test_version_changes_with_each_build(self):
        first = self.client.get("/app-version").json()["version"]
        self.assertEqual(first, self.client.get("/app-version").json()["version"], "stable between builds")
        self.write('<script src="/assets/index-BBBBBB.js"></script>')
        self.assertNotEqual(first, self.client.get("/app-version").json()["version"])

    def test_page_is_never_served_stale(self):
        r = self.client.get("/")
        self.assertIn("no-cache", r.headers["cache-control"])

    def test_missing_build_is_dev(self):
        self.assertEqual(build_version(tempfile.mkdtemp()), "dev")


if __name__ == "__main__":
    unittest.main()
