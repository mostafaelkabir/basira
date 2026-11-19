"""End-to-end UI tests for the Today page: undoing a "done" click, finding the
evidence afterwards, creating once from the planner, and deleting, driven
through a real browser.

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
    for g in [g for g in api("GET", "/goals") if g["title"].startswith("QA Scratch")]:
        quiet("DELETE", f"/goals/{g['id']}")
    for g in api("GET", "/trash")["goals"]:
        if g["title"].startswith("QA Scratch"):
            quiet("DELETE", f"/trash/goal/{g['id']}")
    for c in [c for c in api("GET", "/companies") if c["name"] == SCRATCH_CO]:
        for b in api("GET", "/rhythm")["blocks"]:
            if b["target_ref"] == f"company:{c['id']}":
                api("DELETE", f"/rhythm/{b['id']}")
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
        cls.doomed = api("POST", "/tasks", {"title": "QA delete me", "goal_id": cls.goal["id"], "requires_proof": False})
        api("POST", "/today/schedule/add", {"kind": "task", "id": cls.doomed["id"], "date": today})
        cls.resolution = api("POST", "/goals", {"title": "QA Scratch Resolution", "type": "resolution"})
        cls.habit = api("POST", "/tasks", {"title": "QA routine habit", "goal_id": cls.resolution["id"], "requires_proof": False})
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
        # Behave like the Basira desktop app (a WKWebView with no UI delegate): native
        # confirm() always says no and alert() is swallowed. Any flow that still relied
        # on them would silently do nothing here, exactly as it did for the user.
        self.page.add_init_script("window.confirm = () => false; window.alert = () => {};")
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)
        # Every test starts from a task that is not done.
        api("POST", f"/tasks/{self.task['id']}/reopen")

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [], f"browser errors: {self.errors}")

    def open_today(self):
        """Today in the calendar view (the default): blocks, cards at their times, Anytime."""
        self.page.add_init_script("try { localStorage.setItem('basira_today_view', 'calendar') } catch (e) {}")
        if self.page.url.endswith("#/today"):
            self.page.reload()          # same URL: goto would not reload, so the old state would stay
        else:
            self.page.goto(f"{BASE}/#/today")
        self.page.wait_for_selector("[data-testid=day-calendar]", timeout=15000)

    def open_today_list(self):
        self.open_today()
        self.page.get_by_role("button", name="List", exact=True).click()
        self.page.wait_for_selector("[data-testid=agenda-timeline]", timeout=15000)

    def confirm_in_app(self, title):
        """Click the confirm button of the app's own dialog (never a native one)."""
        dialog = self.page.get_by_role("dialog").filter(has_text=title)
        expect(dialog).to_be_visible(timeout=10000)
        dialog.locator("button").last.click()
        expect(dialog).to_be_hidden(timeout=10000)

    def item(self, title):
        """An open item on the day: a card at its time, a row inside a block, or an Anytime chip."""
        return self.page.locator(f'[data-testid=day-item][data-title="{title}"], [data-testid=cal-event][data-title="{title}"]').first

    def act(self, title, action):
        """Open the item's ⋯ menu and pick an action."""
        self.page.get_by_role("button", name=f"Actions for {title}").first.click()
        self.page.get_by_role("menu", name=f"Actions for {title}").get_by_role("menuitem", name=action, exact=True).click()

    def open_item(self, title):
        self.item(title).locator(".cal-chip-title, .cal-event-title, .cal-item-title").first.click()

    def completed_row(self, title):
        return self.page.locator(".agenda-row").filter(has_text=title).first

    def complete_with_evidence(self, note=None):
        """Done from the item's menu, through the evidence dialog."""
        self.act("QA undo task", "Done")
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

        # Back on the day, with the evidence still attached.
        expect(self.item("QA undo task")).to_be_visible(timeout=10000)
        fresh = api("GET", f"/tasks/{self.task['id']}")
        self.assertEqual(fresh["status"], "todo")
        self.assertEqual([p["content"] for p in fresh["proofs"]], ["Washed and vacuumed"])

    def test_02_undo_from_the_completed_section_and_evidence_in_notes(self):
        self.open_today()
        self.complete_with_evidence()   # evidence from test 01 is already attached
        self.page.locator(".notice").get_by_role("button", name="Dismiss message").click()

        # The user's own day may hold other completed items; only the section toggle matters.
        self.page.get_by_role("button", name=re.compile(r"^Completed · \d+")).click()
        done_row = self.completed_row("QA undo task")
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
        self.completed_row("QA undo task").get_by_role("button", name="Undo completing QA undo task").click()
        expect(self.item("QA undo task")).to_be_visible(timeout=10000)
        self.assertEqual(api("GET", f"/tasks/{self.task['id']}")["status"], "todo")

    def test_03_ticket_evidence_is_there_after_closing_and_reopening(self):
        self.open_today()
        self.open_item("QA evidence ticket")
        compose = self.page.get_by_placeholder(re.compile("Drop a note, paste a link"))
        expect(compose).to_be_visible(timeout=10000)
        compose.fill("https://github.com/qa/scratch/pull/42")
        compose.press("Enter")
        expect(self.page.get_by_test_id("ticket-evidence")).to_contain_text("Evidence · 1", timeout=10000)
        self.page.get_by_role("button", name="Close ticket").click()
        expect(compose).to_be_hidden(timeout=5000)

        # Reopen from the agenda: the link is in the evidence row and in the feed.
        self.open_item("QA evidence ticket")
        evidence = self.page.get_by_test_id("ticket-evidence")
        expect(evidence).to_be_visible(timeout=10000)
        self.assertIn("PR #42", evidence.inner_text())   # GitHub links get a short label
        self.assertEqual(evidence.locator("a").first.get_attribute("href"), "https://github.com/qa/scratch/pull/42")

        # Still there on a cold load.
        self.open_today()
        self.open_item("QA evidence ticket")
        expect(self.page.get_by_test_id("ticket-evidence")).to_contain_text("PR #42", timeout=10000)
        fresh = api("GET", f"/work-tickets/{self.ticket['id']}")
        self.assertEqual([p["url"] for p in fresh["proofs"]], ["https://github.com/qa/scratch/pull/42"])

    # ── creating from the planner must never make a copy ──────────────────────

    def test_04_planner_composer_creates_a_ticket_once(self):
        self.open_today()
        self.page.get_by_role("button", name=re.compile(r"Plan my day|Edit day")).click()
        planner = self.page.get_by_role("dialog").filter(has_text="Add anything")
        expect(planner).to_be_visible(timeout=10000)
        box = planner.get_by_placeholder("Find or type a new title…")
        box.fill("QA twice ticket")
        planner.get_by_role("button", name="Ticket", exact=True).click()
        planner.get_by_label("Client").select_option(label="QA Scratch Co")
        create = planner.get_by_role("button", name="Create ticket", exact=True)
        create.click()
        expect(self.page.locator(".notice").filter(has_text="Created ticket")).to_be_visible(timeout=10000)

        # The draft is spent: nothing left to click again.
        expect(box).to_have_value("", timeout=5000)
        expect(create).to_be_hidden(timeout=5000)
        mine = [t for t in api("GET", f"/work-tickets?company_id={self.company['id']}") if t["title"] == "QA twice ticket"]
        self.assertEqual(len(mine), 1)

        # Typing the same title again offers the existing ticket instead of a copy.
        box.fill("QA twice ticket")
        planner.get_by_role("button", name="Ticket", exact=True).click()
        hint = planner.get_by_role("status").filter(has_text="already exists")
        expect(hint).to_be_visible(timeout=10000)
        hint.get_by_role("button", name="Add the existing one").click()
        expect(self.page.locator(".notice").filter(has_text="Added")).to_be_visible(timeout=10000)
        mine = [t for t in api("GET", f"/work-tickets?company_id={self.company['id']}") if t["title"] == "QA twice ticket"]
        self.assertEqual(len(mine), 1)

        # And the API itself refuses to make a copy of a ticket created seconds ago.
        again = api("POST", "/work-tickets", {"company_id": self.company["id"], "title": "QA twice ticket"})
        self.assertEqual(again["id"], mine[0]["id"])

    # ── deleting from Today ───────────────────────────────────────────────────

    def test_05_delete_a_task_and_a_ticket_from_the_agenda(self):
        self.open_today()
        # A task goes to the trash, with undo in the toast.
        self.act("QA delete me", "Delete")
        toast = self.page.locator(".notice").filter(has_text="moved to trash")
        expect(toast).to_be_visible(timeout=10000)
        expect(self.item("QA delete me")).to_have_count(0, timeout=10000)
        self.assertIn(self.doomed["id"], [t["id"] for t in api("GET", "/trash")["tasks"]])
        toast.get_by_role("button", name="Undo").click()
        expect(self.item("QA delete me")).to_have_count(1, timeout=10000)
        self.assertNotIn(self.doomed["id"], [t["id"] for t in api("GET", "/trash")["tasks"]])

        # A ticket is deleted for good after confirming.
        self.act("QA evidence ticket", "Delete")
        self.confirm_in_app("Delete ticket")
        expect(self.item("QA evidence ticket")).to_have_count(0, timeout=10000)
        with self.assertRaises(urllib.error.HTTPError) as gone:
            api("GET", f"/work-tickets/{self.ticket['id']}")
        self.assertEqual(gone.exception.code, 404)

    # ── a habit's routine puts it on the planner ───────────────────────────────

    def test_06_habit_routine_set_from_today_lands_on_the_agenda(self):
        self.open_today()
        # The habit starts as a check mark in the Routine strip (maybe behind "more").
        more = self.page.get_by_role("button", name=re.compile(r"more$"))
        if more.count():
            more.first.click()
        self.page.get_by_role("button", name="Notes for QA routine habit").click()
        notes = self.page.get_by_role("dialog").filter(has_text="Notes — QA routine habit")
        expect(notes).to_be_visible(timeout=10000)
        editor = notes.get_by_test_id("routine-editor")
        editor.get_by_role("button", name=date.today().strftime("%a"), exact=True).click()
        editor.get_by_label("Time of day").fill("09:15")
        expect(editor).to_contain_text("9:15 AM", timeout=10000)
        self.page.wait_for_function(
            "async (id) => { const t = await (await fetch(`/tasks/${id}`)).json(); return t.scheduled_time === '09:15' && t.routine_days.length === 1 }",
            arg=self.habit["id"], timeout=10000)
        notes.get_by_role("button", name="Close").click()
        expect(notes).to_be_hidden(timeout=5000)

        # Now it is a card on the day at 9:15, and no longer a chip in the routine strip.
        card = self.item("QA routine habit")
        expect(card).to_be_visible(timeout=10000)
        expect(card).to_contain_text("9:15 AM", timeout=10000)
        expect(self.page.get_by_role("button", name="Notes for QA routine habit")).to_have_count(0)

        # Still there on a cold load.
        self.open_today()
        expect(self.item("QA routine habit")).to_be_visible(timeout=10000)

    # ── the day rhythm on the calendar ────────────────────────────────────────

    def test_07_rhythm_block_on_the_calendar_with_its_work_filed_in(self):
        today = date.today()
        tok = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][today.weekday()]
        # A client block for the scratch client, today only, at an hour nobody uses.
        block = api("POST", "/rhythm", {"kind": "client", "target_ref": f"company:{self.company['id']}",
                                        "start_time": "03:00", "duration_minutes": 120, "days": [tok]})
        ticket = api("POST", "/work-tickets", {"company_id": self.company["id"], "title": "QA rhythm ticket", "status": "todo"})
        api("POST", "/today/schedule/add", {"kind": "ticket", "id": ticket["id"], "date": today.isoformat()})
        try:
            self.open_today()
            cal = self.page.get_by_test_id("day-calendar")
            expect(cal).to_be_visible(timeout=10000)
            band = cal.locator("[data-testid=cal-block]").filter(has_text="QA Scratch Co")
            expect(band).to_be_visible(timeout=10000)
            self.assertEqual(band.get_attribute("data-kind"), "client")
            expect(band).to_contain_text("3:00 AM – 5:00 AM")
            expect(band).to_contain_text("QA rhythm ticket")          # filed in by client
            expect(self.page.get_by_test_id("rhythm-split")).to_contain_text("Deep work")

            # The List view is the same day in time order. The ticket has no time yet, so it
            # waits at the end; once it gets one it takes its place under the block.
            self.page.get_by_role("button", name="List", exact=True).click()
            expect(self.page.get_by_test_id("agenda-block").filter(has_text="QA Scratch Co")).to_be_visible(timeout=10000)
            untimed = self.page.get_by_test_id("agenda-untimed")
            expect(untimed).to_contain_text("QA rhythm ticket")
            untimed.get_by_role("button", name="Set time for QA rhythm ticket").click()
            untimed.locator("input[type=time]").fill("03:15")
            untimed.locator("input[type=time]").blur()
            entry = self.page.locator('[data-testid=agenda-entry][data-title="QA rhythm ticket"]')
            expect(entry).to_be_visible(timeout=10000)
            expect(entry).to_have_class(re.compile(r"agenda-in-block"))
            expect(untimed.filter(has_text="QA rhythm ticket")).to_have_count(0)
            order = self.page.locator("[data-testid=agenda-timeline] > [data-title]").evaluate_all("els => els.map(e => e.dataset.title)")
            self.assertLess(order.index("QA Scratch Co"), order.index("QA rhythm ticket"))
            # The reported bug: an item in NO block that starts earlier must come first, not
            # in a section after the blocks.
            api("POST", "/today/schedule/time", {"kind": "task", "id": self.task["id"], "time": "02:30", "date": today.isoformat()})
            self.open_today_list()
            order = self.page.locator("[data-testid=agenda-timeline] > [data-title]").evaluate_all("els => els.map(e => e.dataset.title)")
            self.assertLess(order.index("QA undo task"), order.index("QA Scratch Co"))
            loose = self.page.locator('[data-testid=agenda-entry][data-title="QA undo task"]')
            expect(loose).to_have_class(re.compile(r"agenda-loose"))
            self.assertEqual(self.page.get_by_text("Outside your blocks").count(), 0)
            api("POST", "/today/schedule/time", {"kind": "task", "id": self.task["id"], "time": None, "date": today.isoformat()})
            api("POST", "/today/schedule/time", {"kind": "ticket", "id": ticket["id"], "time": None, "date": today.isoformat()})
            self.page.get_by_role("button", name="Calendar", exact=True).click()
            self.open_today()
            band = self.page.locator("[data-testid=cal-block]").filter(has_text="QA Scratch Co")
            expect(band).to_be_visible(timeout=10000)

            # Loose items: an untimed task waits in the Anytime lane; give it a time and it
            # becomes an event on the grid.
            expect(self.page.get_by_test_id("cal-anytime")).to_contain_text("QA undo task")
            api("POST", "/today/schedule/time", {"kind": "task", "id": self.task["id"], "time": "03:30", "date": today.isoformat()})
            self.open_today()
            event = self.page.locator("[data-testid=cal-event]").filter(has_text="QA undo task")
            expect(event).to_be_visible(timeout=10000)
            expect(event).to_contain_text("3:30 AM")
            api("POST", "/today/schedule/time", {"kind": "task", "id": self.task["id"], "time": None, "date": today.isoformat()})

            # Select the block: a floating toolbar appears. Skip it for today only, then bring it back.
            band = cal.locator("[data-testid=cal-block]").filter(has_text="QA Scratch Co")
            band.locator(".cal-block-title").click()
            toolbar = self.page.get_by_test_id("cal-float")
            expect(toolbar).to_be_visible(timeout=10000)
            toolbar.get_by_role("button", name="Skip today").click()
            expect(band).to_have_count(0, timeout=10000)
            day = api("GET", f"/rhythm/day?date={today.isoformat()}")
            self.assertIn(block["id"], [b["rhythm_id"] for b in day["skipped"]])   # the user may have skipped others
            self.page.get_by_role("button", name=re.compile(r"QA Scratch Co · restore")).click()
            expect(self.page.locator("[data-testid=cal-block]").filter(has_text="QA Scratch Co")).to_be_visible(timeout=10000)
            self.assertNotIn(block["id"], [b["rhythm_id"] for b in api("GET", f"/rhythm/day?date={today.isoformat()}")["skipped"]])

            # ("Running late" is covered by the unit tests: shifting here would move the
            # user's own blocks for today along with the scratch one.)

            # The template editor lists it.
            self.page.get_by_role("button", name="Rhythm", exact=True).first.click()
            modal = self.page.get_by_role("dialog").filter(has_text="Day rhythm")
            expect(modal).to_be_visible(timeout=10000)
            expect(modal).to_contain_text("QA Scratch Co")
            modal.get_by_role("button", name="Close dialog").click()
        finally:
            api("DELETE", f"/rhythm/{block['id']}")
            api("DELETE", f"/work-tickets/{ticket['id']}")

    # ── blocks are easy to add to a day and to adjust ─────────────────────────

    def test_08_add_a_block_to_today_and_adjust_it_from_list_calendar_and_planner(self):
        today = date.today()
        tok = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][today.weekday()]
        other = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][(today.weekday() + 3) % 7]
        # A rhythm block that does NOT run today, to be pulled in from the planner.
        spare = api("POST", "/rhythm", {"kind": "personal", "title": "QA spare block", "start_time": "03:00",
                                        "duration_minutes": 30, "days": [other]})
        made = None
        try:
            self.open_today()
            # "+ Block" → a one-off block for today only.
            self.page.get_by_role("button", name="Block", exact=True).click()
            editor = self.page.get_by_test_id("block-editor")
            expect(editor).to_be_visible(timeout=10000)
            editor.get_by_label("Kind").select_option("personal")
            editor.get_by_label("Title").fill("QA focus block")
            editor.get_by_label("Starts").fill("04:00")
            editor.get_by_label("Ends").fill("04:30")
            editor.get_by_role("button", name="Add block").click()
            band = self.page.locator("[data-testid=cal-block]").filter(has_text="QA focus block")
            expect(band).to_be_visible(timeout=10000)
            expect(band).to_contain_text("4:00 AM – 4:30 AM")
            made = next(b for b in api("GET", f"/rhythm/day?date={today.isoformat()}")["blocks"] if b["title"] == "QA focus block")
            self.assertIsNone(made["rhythm_id"], "today-only blocks are not in the rhythm")

            # Adjust it: select it, Edit, change the end time.
            band.locator(".cal-block-title").click()
            self.page.get_by_test_id("cal-float").get_by_role("button", name="Edit").click()
            editor = self.page.get_by_test_id("block-editor")
            editor.get_by_label("Ends").fill("04:45")
            editor.get_by_role("button", name="Save", exact=True).click()
            expect(band).to_contain_text("4:00 AM – 4:45 AM", timeout=10000)

            # The planner pulls a rhythm block onto today, and takes it off again.
            self.page.get_by_role("button", name=re.compile(r"Plan my day|Edit day")).click()
            planner = self.page.get_by_role("dialog").filter(has_text="Add anything")
            planner.get_by_role("button", name=f"Add block QA spare block to today").click()
            expect(planner.get_by_role("button", name="Remove block QA spare block from today")).to_be_visible(timeout=10000)
            day = api("GET", f"/rhythm/day?date={today.isoformat()}")
            self.assertTrue(next(b for b in day["blocks"] if b["rhythm_id"] == spare["id"])["added"])
            planner.get_by_role("button", name="Remove block QA spare block from today").click()
            self.page.wait_for_function(
                "async (d) => !(await (await fetch(`/rhythm/day?date=${d}`)).json()).blocks.some(b => b.title === 'QA spare block')",
                arg=today.isoformat(), timeout=10000)
            planner.get_by_role("button", name="Done").click()

            # Remove the one-off block from the editor.
            band = self.page.locator("[data-testid=cal-block]").filter(has_text="QA focus block")
            band.locator(".cal-block-title").click()
            self.page.get_by_test_id("cal-float").get_by_role("button", name="Edit").click()
            self.page.get_by_test_id("block-editor").get_by_role("button", name="Remove", exact=True).click()
            self.confirm_in_app("Remove block")
            expect(band).to_have_count(0, timeout=10000)
            made = None
        finally:
            if made:
                quiet("DELETE", f"/day-plan/{made['id']}")
            api("DELETE", f"/rhythm/{spare['id']}")

    # ── deleting from the rhythm works in the desktop app too ─────────────────

    def test_09_remove_a_block_from_the_rhythm_editor(self):
        doomed = api("POST", "/rhythm", {"kind": "personal", "title": "QA doomed block", "start_time": "02:00",
                                         "duration_minutes": 30, "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]})
        try:
            self.open_today()
            self.page.get_by_role("button", name="Rhythm", exact=True).first.click()
            modal = self.page.get_by_role("dialog").filter(has_text="Day rhythm")
            expect(modal).to_contain_text("QA doomed block", timeout=10000)
            modal.get_by_role("button", name="Remove QA doomed block").click()
            # Cancelling keeps it.
            confirm = self.page.get_by_role("dialog").filter(has_text="Remove block")
            confirm.get_by_role("button", name="Cancel").click()
            expect(confirm).to_be_hidden(timeout=5000)
            self.assertIn(doomed["id"], [b["id"] for b in api("GET", "/rhythm")["blocks"]])
            # Confirming removes it.
            modal.get_by_role("button", name="Remove QA doomed block").click()
            self.confirm_in_app("Remove block")
            expect(modal).not_to_contain_text("QA doomed block", timeout=10000)
            self.assertNotIn(doomed["id"], [b["id"] for b in api("GET", "/rhythm")["blocks"]])
            doomed = None
        finally:
            if doomed:
                quiet("DELETE", f"/rhythm/{doomed['id']}")

    # ── an open window picks up a new build by itself ─────────────────────────

    def test_10_open_window_reloads_on_a_new_build(self):
        self.open_today()
        self.page.evaluate("window.__marker = 'old page'")
        # Pretend the frontend was rebuilt while the window stayed open.
        self.page.route("**/app-version", lambda route: route.fulfill(json={"version": "a-newer-build"}))
        self.page.evaluate("window.dispatchEvent(new Event('focus'))")
        self.page.wait_for_function("window.__marker === undefined", timeout=10000)   # reloaded
        self.page.wait_for_selector("[data-testid=day-calendar]", timeout=15000)

    # ── an item timed outside its own block: move it in, or add a block for it ─

    def test_11_item_outside_its_block_moves_in_or_gets_its_own_block(self):
        today = date.today()
        tok = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][today.weekday()]
        block = api("POST", "/rhythm", {"kind": "client", "target_ref": f"company:{self.company['id']}",
                                        "start_time": "03:00", "duration_minutes": 60, "days": [tok]})
        ticket = api("POST", "/work-tickets", {"company_id": self.company["id"], "title": "QA conflict ticket", "status": "todo"})
        api("POST", "/today/schedule/add", {"kind": "ticket", "id": ticket["id"], "date": today.isoformat()})
        api("POST", "/today/schedule/time", {"kind": "ticket", "id": ticket["id"], "time": "01:30", "date": today.isoformat()})
        extra = None
        try:
            self.open_today_list()
            entry = self.page.locator('[data-testid=agenda-entry][data-title="QA conflict ticket"]')
            flag = entry.get_by_test_id("off-block")
            expect(flag).to_contain_text("Outside your QA Scratch Co block")

            # Option 1: a second block for the client around the ticket's time.
            flag.get_by_role("button", name="Add QA Scratch Co block here").click()
            expect(entry.get_by_test_id("off-block")).to_have_count(0, timeout=10000)
            day = api("GET", f"/rhythm/day?date={today.isoformat()}")
            extra = next(b for b in day["blocks"] if b["target_ref"] == f"company:{self.company['id']}" and not b["rhythm_id"])
            self.assertEqual((extra["start_time"], extra["title"]), ("01:30", "QA Scratch Co"))
            api("DELETE", f"/day-plan/{extra['id']}"); extra = None

            # Option 2: move it into the existing block, at its first free slot.
            self.open_today_list()
            entry = self.page.locator('[data-testid=agenda-entry][data-title="QA conflict ticket"]')
            entry.get_by_test_id("off-block").get_by_role("button", name="Move into block").click()
            expect(entry.get_by_test_id("off-block")).to_have_count(0, timeout=10000)
            expect(entry).to_have_class(re.compile(r"agenda-in-block"))
            self.assertEqual(next(i for i in api("GET", "/today/schedule") if i["id"] == ticket["id"])["scheduled_time"], "03:00")

            # The calendar card marks a conflict too, with both fixes in its menu.
            api("POST", "/today/schedule/time", {"kind": "ticket", "id": ticket["id"], "time": "01:30", "date": today.isoformat()})
            self.open_today()
            card = self.page.locator('[data-testid=cal-event][data-title="QA conflict ticket"]')
            card.get_by_role("button", name="QA conflict ticket is outside its QA Scratch Co block").click()
            menu = self.page.get_by_role("menu", name="Actions for QA conflict ticket")
            expect(menu.get_by_role("menuitem", name="Move into block")).to_be_visible()
            expect(menu.get_by_role("menuitem", name="Add QA Scratch Co block here")).to_be_visible()
        finally:
            if extra:
                quiet("DELETE", f"/day-plan/{extra['id']}")
            api("DELETE", f"/rhythm/{block['id']}")
            api("DELETE", f"/work-tickets/{ticket['id']}")

    # ── take a block off one day, with nothing in it ─────────────────────────

    def test_12_skip_an_empty_block_for_today_from_the_list_and_the_editor(self):
        today = date.today()
        tok = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][today.weekday()]
        block = api("POST", "/rhythm", {"kind": "personal", "title": "QA empty block", "start_time": "02:00",
                                        "duration_minutes": 30, "days": [tok]})
        try:
            self.open_today_list()
            self.page.get_by_role("button", name="Skip block QA empty block today").click()
            expect(self.page.locator('[data-testid=agenda-block][data-title="QA empty block"]')).to_have_count(0, timeout=10000)
            self.assertIn(block["id"], [b["rhythm_id"] for b in api("GET", f"/rhythm/day?date={today.isoformat()}")["skipped"]])
            self.assertIn(block["id"], [b["id"] for b in api("GET", "/rhythm")["blocks"]], "the rhythm keeps it")
            # Undo from the toast brings it back.
            self.page.locator(".notice").get_by_role("button", name="Undo").click()
            expect(self.page.locator('[data-testid=agenda-block][data-title="QA empty block"]')).to_have_count(1, timeout=10000)

            # The block editor has it too.
            self.page.get_by_role("button", name="Edit block QA empty block").click()
            self.page.get_by_test_id("block-editor").get_by_role("button", name=re.compile(r"^Skip .* only$")).click()
            expect(self.page.locator('[data-testid=agenda-block][data-title="QA empty block"]')).to_have_count(0, timeout=10000)
            # And the skipped list restores it.
            self.page.get_by_role("button", name="QA empty block · restore").click()
            expect(self.page.locator('[data-testid=agenda-block][data-title="QA empty block"]')).to_have_count(1, timeout=10000)
        finally:
            api("DELETE", f"/rhythm/{block['id']}")


    # ── a timer left running: take minutes off, undo the session, or discard it ──

    def test_13_fix_time_takes_minutes_off_undoes_a_session_and_discards_a_running_one(self):
        tid = self.task["id"]
        today = date.today().isoformat()
        total = lambda: api("GET", f"/day-timer/item?source=task&item_id={tid}")["total_seconds"]
        fix = self.page.get_by_test_id("fix-time")
        try:
            api("POST", "/day-timer/log", {"source": "task", "item_id": tid, "minutes": 20, "date": today})
            api("POST", "/day-timer/log", {"source": "task", "item_id": tid, "minutes": 50, "date": today})
            self.open_today()

            # Minus time: the latest session (50m) loses 5 minutes.
            self.act("QA undo task", "Fix time…")
            expect(fix).to_contain_text("Last session: 50m")
            fix.get_by_label("Take off").fill("5")
            fix.get_by_role("button", name="Take off").click()
            expect(fix).to_be_hidden(timeout=10000)
            self.assertEqual(total(), 65 * 60)

            # Undo the last session altogether; the earlier 20 minutes stay.
            self.act("QA undo task", "Fix time…")
            fix.get_by_role("button", name=re.compile(r"^Undo last session \(45m\)$")).click()
            expect(fix).to_be_hidden(timeout=10000)
            self.assertEqual(total(), 20 * 60)

            # A running timer is discarded from the Now strip without recording anything.
            if api("GET", "/day-timer/active")["count"] == 0:   # never touch a real running timer
                api("POST", "/day-timer/switch", {"source": "task", "item_id": tid})
                self.open_today()
                self.page.get_by_role("button", name="Fix time for QA undo task").first.click()
                expect(fix).to_contain_text("Timer running since")
                fix.get_by_role("button", name="Discard this session").click()
                expect(fix).to_be_hidden(timeout=10000)
                self.assertEqual(api("GET", "/day-timer/active")["count"], 0)
                self.assertEqual(total(), 20 * 60)
        finally:
            active = api("GET", "/day-timer/active")["active"]
            if any(a["item_id"] == tid for a in active):
                quiet("POST", "/day-timer/undo-last", {"source": "task", "item_id": tid})
            while quiet("POST", "/day-timer/undo-last", {"source": "task", "item_id": tid}):
                pass


if __name__ == "__main__":
    unittest.main()
