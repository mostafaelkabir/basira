"""End-to-end UI tests for the Today page: undoing a "done" click and finding the
evidence afterwards, driven through a real browser.

Runs against the live app at BASIRA_URL (default http://localhost:8001) with
Playwright's bundled Chromium. Everything lives in a throw-away goal
("QA Scratch Goal") and client ("QA Scratch Co") created over the API and
purged afterwards, so the user's own data is never touched. Run with:

    venv/bin/python -m unittest tests.e2e.test_today_ui -v
"""
import json
import os
import re
import unittest
import urllib.error
import urllib.request
from datetime import date

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASIRA_URL", "http://localhost:8001")
HEADLESS = os.environ.get("BASIRA_HEADED") != "1"


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def quiet(method, path, body=None):
    try:
        return api(method, path, body)
    except urllib.error.HTTPError:
        return None


def app_is_up():
    try:
        return api("GET", "/health")["status"] == "ok"
    except Exception:
        return False


SCRATCH_GOAL = "QA Scratch Goal"
SCRATCH_CO = "QA Scratch Co"


def sweep_scratch():
    """Remove anything a previous aborted run left behind, then purge it from the trash."""
    for g in [g for g in api("GET", "/goals") if g["title"] == SCRATCH_GOAL]:
        quiet("DELETE", f"/goals/{g['id']}")
    for g in api("GET", "/trash")["goals"]:
        if g["title"] == SCRATCH_GOAL:
            quiet("DELETE", f"/trash/goal/{g['id']}")
    for c in [c for c in api("GET", "/companies") if c["name"] == SCRATCH_CO]:
        for t in api("GET", f"/work-tickets?company_id={c['id']}"):
            api("DELETE", f"/work-tickets/{t['id']}")
        api("DELETE", f"/companies/{c['id']}")


@unittest.skipUnless(app_is_up(), f"Basira is not running at {BASE}")
class TodayUITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        try:
            cls.browser = cls.pw.chromium.launch(headless=HEADLESS)
        except Exception:
            cls.pw.stop()
            raise
        sweep_scratch()
        today = date.today().isoformat()
        cls.goal = api("POST", "/goals", {"title": SCRATCH_GOAL, "type": "project"})
        cls.task = api("POST", "/tasks", {"title": "QA undo task", "goal_id": cls.goal["id"], "requires_proof": False})
        api("POST", "/today/schedule/add", {"kind": "task", "id": cls.task["id"], "date": today})
        cls.company = api("POST", "/companies", {"name": SCRATCH_CO, "color": "#8B5CF6"})
        cls.ticket = api("POST", "/work-tickets", {"company_id": cls.company["id"], "title": "QA evidence ticket", "status": "todo"})
        api("POST", "/today/schedule/add", {"kind": "ticket", "id": cls.ticket["id"], "date": today})

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        sweep_scratch()

    def setUp(self):
        self.ctx = self.browser.new_context(viewport={"width": 1280, "height": 900})
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)
        # Every test starts from a task that is not done.
        api("POST", f"/tasks/{self.task['id']}/reopen")

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [], f"browser errors: {self.errors}")

    def open_today(self):
        self.page.goto(f"{BASE}/#/today")
        self.page.wait_for_selector(".agenda-row", timeout=15000)

    def row(self, title):
        return self.page.locator(".agenda-row").filter(has_text=title).first

    def complete_with_evidence(self, note=None):
        """Click Done on the task row and go through the evidence dialog."""
        self.row("QA undo task").get_by_role("button", name="Done").click()
        dialog = self.page.get_by_role("dialog").filter(has_text="Make your progress visible")
        expect(dialog).to_be_visible(timeout=10000)
        if note is not None:
            dialog.get_by_placeholder(re.compile("Describe the result")).fill(note)
        dialog.get_by_role("button", name="Complete with evidence").click()
        expect(dialog).to_be_hidden(timeout=10000)

    # ── the two complaints: can't undo a done click; can't find the evidence ──

    def test_01_undo_from_the_toast_right_after_a_done_click(self):
        self.open_today()
        self.complete_with_evidence(note="Washed and vacuumed")
        self.assertEqual(api("GET", f"/tasks/{self.task['id']}")["status"], "done")

        toast = self.page.locator(".notice").filter(has_text="marked done")
        expect(toast).to_be_visible(timeout=5000)
        toast.get_by_role("button", name="Undo").click()

        # Back on the list, with the evidence still attached.
        expect(self.row("QA undo task").get_by_role("button", name="Done")).to_be_visible(timeout=10000)
        fresh = api("GET", f"/tasks/{self.task['id']}")
        self.assertEqual(fresh["status"], "todo")
        self.assertEqual([p["content"] for p in fresh["proofs"]], ["Washed and vacuumed"])

    def test_02_undo_from_the_completed_section_and_evidence_in_notes(self):
        self.open_today()
        self.complete_with_evidence()   # evidence from test 01 is already attached
        self.page.locator(".notice").get_by_role("button", name="Dismiss message").click()

        # The user's own day may hold other completed items; only the section toggle matters.
        self.page.get_by_role("button", name=re.compile(r"^Completed · \d+")).click()
        done_row = self.row("QA undo task")
        expect(done_row.get_by_role("button", name="Undo completing QA undo task")).to_be_visible(timeout=10000)

        # The evidence handed in at completion is one click away.
        done_row.get_by_role("button", name="Notes for QA undo task").click()
        notes = self.page.get_by_role("dialog").filter(has_text="Notes — QA undo task")
        expect(notes).to_be_visible(timeout=10000)
        evidence = notes.get_by_label("Evidence")
        self.assertRegex(evidence.inner_text(), re.compile(r"evidence · 1", re.I))   # the eyebrow is uppercased by CSS
        self.assertIn("Completed", evidence.inner_text())
        self.assertIn("Washed and vacuumed", evidence.inner_text())
        notes.get_by_role("button", name="Close").click()
        expect(notes).to_be_hidden(timeout=5000)

        # And the done click can still be taken back from here.
        self.row("QA undo task").get_by_role("button", name="Undo completing QA undo task").click()
        expect(self.row("QA undo task").get_by_role("button", name="Done")).to_be_visible(timeout=10000)
        self.assertEqual(api("GET", f"/tasks/{self.task['id']}")["status"], "todo")

    def test_03_ticket_evidence_is_there_after_closing_and_reopening(self):
        self.open_today()
        self.row("QA evidence ticket").get_by_role("button", name="Open").click()
        compose = self.page.get_by_placeholder(re.compile("Drop a note, paste a link"))
        expect(compose).to_be_visible(timeout=10000)
        compose.fill("https://github.com/qa/scratch/pull/42")
        compose.press("Enter")
        expect(self.page.get_by_test_id("ticket-evidence")).to_contain_text("Evidence · 1", timeout=10000)
        self.page.get_by_role("button", name="Close ticket").click()
        expect(compose).to_be_hidden(timeout=5000)

        # Reopen from the agenda: the link is in the evidence row and in the feed.
        self.row("QA evidence ticket").get_by_role("button", name="Open").click()
        evidence = self.page.get_by_test_id("ticket-evidence")
        expect(evidence).to_be_visible(timeout=10000)
        self.assertIn("PR #42", evidence.inner_text())   # GitHub links get a short label
        self.assertEqual(evidence.locator("a").first.get_attribute("href"), "https://github.com/qa/scratch/pull/42")

        # Still there on a cold load.
        self.page.reload()
        self.page.wait_for_selector(".agenda-row", timeout=15000)
        self.row("QA evidence ticket").get_by_role("button", name="Open").click()
        expect(self.page.get_by_test_id("ticket-evidence")).to_contain_text("PR #42", timeout=10000)
        fresh = api("GET", f"/work-tickets/{self.ticket['id']}")
        self.assertEqual([p["url"] for p in fresh["proofs"]], ["https://github.com/qa/scratch/pull/42"])


if __name__ == "__main__":
    unittest.main()
