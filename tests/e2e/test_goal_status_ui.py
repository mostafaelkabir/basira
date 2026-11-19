"""End-to-end UI test for goal outcomes (achieved / blocked / moved out / cancelled).

Drives the live app at BASIRA_URL in headless Chromium, inside one throw-away
goal that is purged from the trash afterwards. Run with:

    venv/bin/python -m unittest tests.e2e.test_goal_status_ui -v
"""
import json
import os
import re
import unittest
import urllib.request

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASIRA_URL", "http://localhost:8001")
TITLE = "QA Outcome Goal"


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def app_is_up():
    try:
        return api("GET", "/health")["status"] == "ok"
    except Exception:
        return False


def sweep():
    for archived in ("", "?archived=true"):
        for g in api("GET", f"/goals{archived}"):
            if g["title"] == TITLE:
                api("DELETE", f"/goals/{g['id']}")
    for g in api("GET", "/trash")["goals"]:
        if g["title"] == TITLE:
            api("DELETE", f"/trash/goal/{g['id']}")


@unittest.skipUnless(app_is_up(), f"Basira is not running at {BASE}")
class GoalStatusUITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        try:
            cls.browser = cls.pw.chromium.launch(headless=os.environ.get("BASIRA_HEADED") != "1")
        except Exception:
            cls.pw.stop()
            raise
        sweep()
        cls.goal = api("POST", "/goals", {"title": TITLE, "type": "project"})

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        sweep()

    def setUp(self):
        self.ctx = self.browser.new_context(viewport={"width": 1440, "height": 900})
        self.page = self.ctx.new_page()
        self.page.add_init_script("window.confirm = () => false")   # the desktop app answers native dialogs with cancel
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [], f"browser errors: {self.errors}")

    def server_goal(self):
        return api("GET", f"/goals/{self.goal['id']}")

    def open_goal(self):
        self.page.goto(f"{BASE}/#/goals/{self.goal['id']}")
        self.page.get_by_role("heading", name=TITLE).wait_for(timeout=15000)

    def set_status(self, outcome, reason=None):
        self.page.get_by_role("button", name=re.compile(r"Close or flag|Update status")).click()
        dialog = self.page.locator("dialog[open]")
        dialog.get_by_role("radio", name=re.compile(outcome)).click()
        return dialog

    def test_01_blocked_needs_a_reason_then_flags_the_goal(self):
        self.open_goal()
        dialog = self.set_status("Blocked")
        submit = dialog.get_by_role("button", name="Mark blocked")
        self.assertTrue(submit.is_disabled())                       # no reason yet
        dialog.locator("#goal-status-reason").fill("Waiting on the recorder password")
        submit.click()
        panel = self.page.locator(".goal-status-panel")
        panel.wait_for(timeout=10000)
        self.assertIn("Waiting on the recorder password", panel.inner_text())
        g = self.server_goal()
        self.assertEqual((g["status"], g["status_reason"], g["archived_at"]), ("blocked", "Waiting on the recorder password", None))
        # Still on the goals list, flagged.
        self.page.goto(f"{BASE}/#/goals")
        card = self.page.locator("div.group").filter(has_text=TITLE).first
        card.wait_for(timeout=10000)
        self.assertIn("Blocked", card.inner_text())

    def test_02_moved_out_closes_it_with_the_reason_and_history(self):
        self.open_goal()
        dialog = self.set_status("Moved out")
        dialog.locator("#goal-status-reason").fill("Client work takes priority until January")
        dialog.get_by_role("button", name="Mark moved out").click()
        self.page.wait_for_function("document.querySelector('.goal-status-panel')?.dataset.status === 'moved_out'", timeout=10000)
        g = self.server_goal()
        self.assertEqual(g["status"], "moved_out")
        self.assertIsNotNone(g["archived_at"])
        self.assertNotIn(self.goal["id"], [x["id"] for x in api("GET", "/goals")])
        self.page.get_by_role("button", name=re.compile(r"Status history")).click()
        log = self.page.locator(".goal-status-log").inner_text()
        self.assertIn("Blocked → Moved out: Client work takes priority until January", log)
        self.assertIn("Active → Blocked: Waiting on the recorder password", log)
        # Listed under closed & archived with its outcome and reason.
        self.page.goto(f"{BASE}/#/goals")
        self.page.get_by_role("button", name=re.compile(r"closed & archived")).click()
        closed = self.page.locator("div.bg-raised").filter(has_text=TITLE).first
        closed.wait_for(timeout=10000)
        self.assertIn("Moved out", closed.inner_text())
        self.assertIn("Client work takes priority until January", closed.inner_text())

    def test_03_reopen_then_close_as_achieved(self):
        self.open_goal()
        self.page.get_by_role("button", name="Update status").click()
        self.page.locator("dialog[open]").get_by_role("button", name="Reopen goal").click()
        self.page.wait_for_function("!document.querySelector('.goal-status-panel[data-status=\"moved_out\"]')", timeout=10000)
        self.assertEqual(self.server_goal()["status"], "active")
        self.assertIn(self.goal["id"], [x["id"] for x in api("GET", "/goals")])
        dialog = self.set_status("Achieved")
        dialog.get_by_role("button", name="Mark achieved").click()                # no reason needed
        self.page.wait_for_function("document.querySelector('.goal-status-panel')?.dataset.status === 'achieved'", timeout=10000)
        self.assertEqual(self.server_goal()["status"], "achieved")
        self.assertEqual(len(self.server_goal()["status_history"]), 4)


if __name__ == "__main__":
    unittest.main()
