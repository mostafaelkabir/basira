"""End-to-end UI tests for planning boards, driven through a real browser.

Runs against the live app at BASIRA_URL (default http://localhost:8001) with
Playwright's bundled Chromium. Every test works inside a throw-away client
("QA Scratch Co") created over the API and deleted afterwards, so the user's own
data is never touched. Run with:

    venv/bin/python -m unittest tests.e2e.test_boards_ui -v
"""
import json
import os
import re
import unittest
import urllib.request
from datetime import date, timedelta

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASIRA_URL", "http://localhost:8001")
HEADLESS = os.environ.get("BASIRA_HEADED") != "1"


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


SCRATCH_NAME = "QA Scratch Co"


def sweep_scratch():
    """Remove anything a previous aborted run left behind (boards, tickets, milestones, the client)."""
    for c in [c for c in api("GET", "/companies") if c["name"] == SCRATCH_NAME]:
        for b in api("GET", "/boards"):
            if b["scope_type"] == "company" and b["scope_id"] == c["id"]:
                api("DELETE", f"/boards/{b['id']}")
        for t in api("GET", f"/work-tickets?company_id={c['id']}"):
            api("DELETE", f"/work-tickets/{t['id']}")
        for m in api("GET", f"/work-milestones?company_id={c['id']}"):
            api("DELETE", f"/work-milestones/{m['id']}")
        api("DELETE", f"/companies/{c['id']}")


@unittest.skipUnless(app_is_up(), f"Basira is not running at {BASE}")
class BoardsUITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Browser first: if Playwright cannot start, nothing has been created yet and nothing leaks.
        cls.pw = sync_playwright().start()
        try:
            cls.browser = cls.pw.chromium.launch(headless=HEADLESS)
        except Exception:
            cls.pw.stop()
            raise
        sweep_scratch()
        cls.company = api("POST", "/companies", {"name": SCRATCH_NAME, "color": "#8B5CF6"})
        cid = cls.company["id"]
        cls.milestone = api("POST", "/work-milestones", {"company_id": cid, "title": "QA demo day", "due_date": (date.today() + timedelta(days=4)).isoformat()})
        cls.tickets = [
            api("POST", "/work-tickets", {"company_id": cid, "title": "QA alpha ticket", "status": "todo", "priority": "high",
                                          "due_date": date.today().isoformat(), "milestone_id": cls.milestone["id"]}),
            api("POST", "/work-tickets", {"company_id": cid, "title": "QA beta ticket", "status": "backlog", "estimated_minutes": 45}),
        ]
        cls.board = api("POST", "/boards", {"title": "QA board", "scope_type": "company", "scope_id": cid})

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        sweep_scratch()

    def setUp(self):
        self.ctx = self.browser.new_context(viewport={"width": 1440, "height": 900})
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [], f"browser errors: {self.errors}")

    def open_board(self):
        self.page.goto(f"{BASE}/#/boards/{self.board['id']}")
        self.page.wait_for_selector(".tl-container", timeout=15000)
        self.page.wait_for_selector("aside.board-palette", timeout=10000)

    def wait_for_cards(self, n, timeout=20000):
        """n ticket cards on the board, all showing live data rather than the loading placeholder."""
        self.page.wait_for_function(
            "(n) => { const cards = [...document.querySelectorAll(\".sysgo-card[data-entity='ticket']\")];"
            " return cards.length === n && cards.every(c => !c.textContent.includes('Loading')) }", arg=n, timeout=timeout)

    # ── the flows a planner actually uses ──────────────────────────────────────

    def test_01_palette_adds_live_cards_and_they_persist(self):
        self.open_board()
        palette = self.page.locator("aside.board-palette")
        self.assertIn("QA alpha ticket", palette.inner_text())
        self.page.get_by_role("button", name=re.compile(r"Add all")).click()
        self.wait_for_cards(2)
        titles = self.page.locator(".sysgo-card .card-title").all_inner_texts()
        self.assertEqual(sorted(titles), ["QA alpha ticket", "QA beta ticket"])
        self.assertIn("Due today", self.page.locator(".sysgo-card").filter(has_text="QA alpha").inner_text())
        self.assertIn("QA demo day", self.page.locator(".sysgo-card").filter(has_text="QA alpha").inner_text())
        # Saved to the server (the save state settles) and still there after a reload.
        self.page.wait_for_function("document.querySelector('.board-save-state')?.dataset.state === 'saved'", timeout=10000)
        self.page.reload()
        self.wait_for_cards(2)
        self.page.wait_for_function("document.querySelector('.board-summary')?.textContent.includes('tickets')", timeout=10000)
        self.assertIn("2 tickets", self.page.locator(".board-summary").inner_text())

    def test_02_status_lanes_and_drop_updates_the_ticket(self):
        self.open_board()
        self.wait_for_cards(2)
        self.page.get_by_role("button", name=re.compile(r"^Lanes")).click()
        self.page.get_by_role("menuitem", name="By status").click()
        self.page.wait_for_function("document.querySelectorAll('.tl-frame-heading').length >= 6", timeout=10000)
        headings = " ".join(self.page.locator(".tl-frame-heading").all_inner_texts())
        for name in ("Backlog", "To do", "In progress", "Review", "Blocked", "Done"):
            self.assertIn(name, headings)
        # Filing cards must not touch the tickets.
        self.assertEqual(api("GET", f"/work-tickets/{self.tickets[0]['id']}")["status"], "todo")
        # Drag the alpha card from "To do" into "In progress" (shape containers give reliable boxes).
        self.page.wait_for_timeout(700)   # let the zoom-to-lanes animation settle
        card = self.page.locator(".tl-shape[data-shape-type='sysgo-card']").filter(has_text="QA alpha ticket").first
        target = self.page.locator(".tl-shape[data-shape-type='frame']").filter(has_text="In progress").first
        cb, tb = card.bounding_box(), target.bounding_box()
        self.assertIsNotNone(cb, "card not rendered"); self.assertIsNotNone(tb, "lane not rendered")
        sx, sy = cb["x"] + cb["width"] / 2, cb["y"] + cb["height"] / 2
        tx, ty = tb["x"] + tb["width"] / 2, tb["y"] + min(tb["height"] / 2, 160)
        self.page.mouse.move(sx, sy); self.page.mouse.down()
        for i in range(1, 16):
            self.page.mouse.move(sx + (tx - sx) * i / 15, sy + (ty - sy) * i / 15)
        self.page.mouse.up()
        self.page.wait_for_function(
            f"fetch('{BASE}/work-tickets/{self.tickets[0]['id']}').then(r => r.json()).then(t => t.status === 'in_progress')", timeout=10000)
        self.assertEqual(api("GET", f"/work-tickets/{self.tickets[0]['id']}")["status"], "in_progress")
        self.assertIn("In progress", self.page.locator(".notice").last.inner_text())

    def test_03_inspector_edits_write_through(self):
        self.open_board()
        self.wait_for_cards(2)
        card = self.page.locator(".sysgo-card").filter(has_text="QA beta ticket").first
        card.click()
        inspector = self.page.locator("aside.card-inspector")
        inspector.wait_for(timeout=5000)
        self.assertIn("QA beta ticket", inspector.locator("input.insp-input").first.input_value())
        inspector.locator("select.insp-input").nth(1).select_option("urgent")   # priority
        self.page.wait_for_function(
            f"fetch('{BASE}/work-tickets/{self.tickets[1]['id']}').then(r => r.json()).then(t => t.priority === 'urgent')", timeout=10000)
        inspector.get_by_role("button", name="Today").click()
        self.page.wait_for_function(
            f"fetch('{BASE}/work-tickets/{self.tickets[1]['id']}').then(r => r.json()).then(t => t.due_date === '{date.today().isoformat()}')", timeout=10000)
        self.page.wait_for_function("[...document.querySelectorAll('.sysgo-card')].some(c => c.textContent.includes('QA beta') && c.textContent.includes('Due today'))", timeout=10000)

    def test_04_work_page_shows_milestones_due_dates_and_milestone_board(self):
        self.page.goto(f"{BASE}/#/work")
        self.page.get_by_role("button", name="QA Scratch Co", exact=True).first.click()
        strip = self.page.locator(".milestone-strip, .milestone-tile").first
        strip.wait_for(timeout=10000)
        self.assertIn("QA demo day", self.page.locator(".milestone-strip").inner_text())
        self.page.get_by_role("button", name="◆ Milestones").click()
        self.page.wait_for_selector(".kanban", timeout=10000)
        heads = [h.lower() for h in self.page.locator(".kanban-col-head").all_inner_texts()]   # headings are upper-cased by CSS
        self.assertTrue(any("qa demo day" in h for h in heads), heads)
        self.assertTrue(any("no milestone" in h for h in heads), heads)
        alpha_col = self.page.locator(".kanban-col").filter(has_text="QA demo day")
        self.assertIn("QA alpha ticket", alpha_col.inner_text())
        self.page.get_by_role("button", name="☰ List").click()
        self.page.wait_for_selector(".due-chip", timeout=10000)


if __name__ == "__main__":
    unittest.main()
