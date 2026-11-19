"""End-to-end UI tests for the goal measure: setting a target, the weekly check-in,
the read-out on the goal page and goal card, and the check-in step of the Weekly Review.

Runs against the live app at BASIRA_URL (default http://localhost:8001) with Playwright's
bundled Chromium. Everything lives in throw-away "QA Scratch …" goals created over the
API and purged afterwards, so the user's own data is never touched. Run with:

    venv/bin/python -m unittest tests.e2e.test_goal_measure_ui -v
"""
import json
import os
import re
import unittest
import urllib.error
import urllib.request
from datetime import date, timedelta

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASIRA_URL", "http://localhost:8001")
HEADLESS = os.environ.get("BASIRA_HEADED") != "1"
SHOTS = os.environ.get("BASIRA_SHOTS")   # directory for screenshots, when set


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


def sweep_scratch():
    for g in [g for g in api("GET", "/goals") if g["title"].startswith("QA Scratch")]:
        quiet("DELETE", f"/goals/{g['id']}")
    for g in api("GET", "/trash")["goals"]:
        if g["title"].startswith("QA Scratch"):
            quiet("DELETE", f"/trash/goal/{g['id']}")


def ago(days):
    return (date.today() - timedelta(days=days)).isoformat()


@unittest.skipUnless(app_is_up(), f"Basira is not running at {BASE}")
class GoalMeasureUITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        try:
            cls.browser = cls.pw.chromium.launch(headless=HEADLESS)
        except Exception:
            cls.pw.stop()
            raise
        sweep_scratch()
        # A resolution 8 weeks into a 20-week target, with three past check-ins and a habit.
        cls.goal = api("POST", "/goals", {"title": "QA Scratch Weight", "type": "resolution"})
        cls.habit = api("POST", "/tasks", {"title": "QA walk", "goal_id": cls.goal["id"], "requires_proof": False})
        api("PUT", f"/goals/{cls.goal['id']}/measure", {"name": "Weight", "unit": "kg", "start": 92, "target": 82,
                                                         "start_date": ago(56), "target_date": (date.today() + timedelta(days=84)).isoformat()})
        for days, value in ((42, 91.2), (28, 90.1), (14, 89.4)):
            api("POST", f"/goals/{cls.goal['id']}/measure/checkins", {"value": value, "date": ago(days)})
        cls.blank = api("POST", "/goals", {"title": "QA Scratch Savings", "type": "resolution"})

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        sweep_scratch()

    def setUp(self):
        self.ctx = self.browser.new_context(viewport={"width": 1280, "height": 1000})
        self.page = self.ctx.new_page()
        self.page.add_init_script("window.confirm = () => false; window.alert = () => {};")
        if os.environ.get("BASIRA_THEME"):   # light | dark, for screenshots
            self.page.add_init_script(f"localStorage.setItem('basira_theme', '{os.environ['BASIRA_THEME']}')")
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [])

    def shot(self, name, locator=None):
        if SHOTS:
            (locator or self.page).screenshot(path=os.path.join(SHOTS, f"{name}.png"))

    def open_goal(self, goal):
        self.page.goto(f"{BASE}/#/goals/{goal['id']}")
        expect(self.page.get_by_role("heading", name=goal["title"])).to_be_visible()

    def test_1_read_out_and_weekly_check_in(self):
        self.open_goal(self.goal)
        panel = self.page.get_by_test_id("goal-measure")
        expect(panel.get_by_test_id("measure-current")).to_have_text("89.4")
        expect(panel).to_contain_text(re.compile(r"wk behind"))          # 26% of the way with 40% of the time gone
        expect(panel).to_contain_text("26% of the way")
        expect(panel).to_contain_text(re.compile("Projected arrival", re.I))
        expect(panel.locator("svg[role=img]").first).to_be_visible()

        panel.get_by_role("button", name="Check in").click()
        panel.get_by_test_id("checkin-value").fill("88.2")
        panel.get_by_placeholder("What moved it? (optional)").fill("QA cut sugar")
        panel.get_by_role("button", name="Save").click()
        expect(panel.get_by_test_id("measure-current")).to_have_text("88.2")
        expect(panel.get_by_role("button", name="Update this week")).to_be_visible()
        expect(panel.locator("[data-diagnosis]")).to_be_visible()
        self.shot("goal-measure", panel)

        # The same week again replaces the number instead of adding a second one.
        panel.get_by_role("button", name="Update this week").click()
        panel.get_by_test_id("checkin-value").fill("88")
        panel.get_by_role("button", name="Save").click()
        expect(panel.get_by_test_id("measure-current")).to_have_text("88")
        expect(panel.get_by_role("button", name=re.compile(r"Check-ins \(4\)"))).to_be_visible()
        m = api("GET", f"/goals/{self.goal['id']}/measure")
        self.assertEqual([p["value"] for p in m["points"]], [92, 91.2, 90.1, 89.4, 88])

    def test_2_set_a_target_from_the_goal_page(self):
        self.open_goal(self.blank)
        self.page.get_by_role("button", name="Set a target").click()
        dialog = self.page.get_by_role("dialog")
        submit = dialog.get_by_role("button", name="Set target")
        expect(submit).to_be_disabled()
        dialog.get_by_test_id("measure-name").fill("Savings")
        dialog.get_by_placeholder("kg").fill("EGP")
        dialog.get_by_test_id("measure-start").fill("20000")
        dialog.get_by_test_id("measure-target").fill("100000")
        dialog.get_by_test_id("measure-target-date").fill((date.today() + timedelta(days=200)).isoformat())
        submit.click()
        panel = self.page.get_by_test_id("goal-measure")
        expect(panel.get_by_test_id("measure-current")).to_have_text("20,000")
        expect(panel).to_contain_text("On pace")
        expect(panel.locator("[data-diagnosis=need_data]")).to_be_visible()

        # Removing asks through the app's own dialog (native confirm is stubbed to "no").
        panel_edit = self.page.get_by_role("button", name="Edit target")
        panel_edit.click()
        self.page.get_by_role("button", name="Remove measure").click()
        self.page.get_by_role("button", name="Remove", exact=True).click()
        expect(self.page.get_by_role("button", name="Set a target")).to_be_visible()
        self.assertFalse(api("GET", f"/goals/{self.blank['id']}/measure")["defined"])

    def test_3_goal_card_and_weekly_review(self):
        self.page.goto(f"{BASE}/#/goals")
        card = self.page.locator("div.cursor-pointer", has_text="QA Scratch Weight").first
        mini = card.get_by_test_id("measure-mini")
        expect(mini).to_contain_text("kg")
        expect(mini).to_contain_text(re.compile(r"of 82 · \d+%"))
        self.shot("goal-card", card)

        self.page.get_by_role("button", name="Weekly review").first.click()
        row = self.page.get_by_test_id("review-checkins").locator("div.rounded-xl", has_text="QA Scratch Weight").first
        expect(row).to_contain_text("Weight")
        expect(row).to_contain_text(re.compile(r"wk behind|On pace|wk ahead"))
        self.shot("weekly-review", self.page.get_by_test_id("review-checkins"))


if __name__ == "__main__":
    unittest.main()
