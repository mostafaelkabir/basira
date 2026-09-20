"""Day-workspace tests: in-memory DB, never import app.main or run migrations.

Proves the read model's totals, attribution, timezone day-allocation, live
overlay, double-count prevention, and that every read leaves the DB untouched.
"""
import unittest
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  register relationships without starting the app
from app.database import Base, get_db
from app.models.company import Company
from app.models.goal import Goal
from app.models.habit_log import HabitLog
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_session import WorkSession
from app.models.work_ticket import WorkTicket, WorkTimeEntry
from app.routes.day_workspace import router
from app.services.day_workspace import build_day_workspace

DAY = date(2026, 9, 18)
CHICAGO = ZoneInfo("America/Chicago")  # UTC-5 during DST on this date
# One shared clock for deterministic live math: 2026-09-18 20:00 UTC = 15:00 CDT.
AS_OF = datetime(2026, 9, 18, 20, 0, tzinfo=UTC)


class DayWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([
                Company(id='alpha', name='Alpha'),
                Company(id='beta', name='Beta'),
                Goal(id='basira', title='Basira', type='project'),
                Goal(id='clientproj', title='Client Proj', type='project'),
                Goal(id='health', title='Health', type='resolution'),
            ])
            db.flush()

            db.add_all([
                # Personal project task with today's plan block + a schedule time.
                Task(id='t-redesign', goal_id='basira', title='Today redesign',
                     status='todo', plan_date='2026-09-18', scheduled_time='10:45',
                     estimated_minutes=75),
                # Habit tasks under the resolution goal (routines).
                Task(id='h-meditate', goal_id='health', title='Meditate',
                     habit_frequency='daily', scheduled_time='07:00'),
                Task(id='h-workout', goal_id='health', title='Workout',
                     habit_frequency='daily', scheduled_time='18:00'),
                Task(id='h-water', goal_id='health', title='Water',
                     habit_frequency='2x_day', scheduled_time=None),
            ])
            db.add_all([
                WorkTicket(id='tk-client', company_id='alpha', linked_goal_id='clientproj',
                           title='Model work', status='in_progress', plan_date=None),
                WorkTicket(id='tk-loose', company_id='alpha', linked_goal_id=None,
                           title='Loose ticket', plan_date='2026-09-18'),
                WorkLog(id='lg-beta', company_id='beta', linked_goal_id=None,
                        title='Beta sync', type='meeting', duration_minutes=15,
                        logged_at='2026-09-18'),
            ])
            db.flush()

            db.add_all([
                # Saved task session inside today (15:00 CDT) — counts today.
                WorkSession(id='task-today', task_id='t-redesign',
                            started_at=datetime(2026, 9, 18, 14, 0),
                            ended_at=datetime(2026, 9, 18, 15, 0), duration_seconds=3600),
                # Saved task session at 09-17 23:30 CDT (04:30 UTC) — belongs to YESTERDAY.
                WorkSession(id='task-yesterday', task_id='t-redesign',
                            started_at=datetime(2026, 9, 18, 4, 30),
                            ended_at=datetime(2026, 9, 18, 5, 0), duration_seconds=1800),
                # Ticket time entry for today.
                WorkTimeEntry(id='wte-client', ticket_id='tk-client', logged_at='2026-09-18',
                              duration_seconds=1800, duration_minutes=30),
                # Duplicated stopped session for the SAME ticket time — must NOT double-count.
                WorkSession(id='dup-ticket', work_log_id='ticket:tk-client',
                            started_at=datetime(2026, 9, 18, 14, 0),
                            ended_at=datetime(2026, 9, 18, 14, 30), duration_seconds=1800),
                # Running task timer inside today → live only (elapsed 3600s at AS_OF).
                WorkSession(id='run-task', task_id='t-redesign',
                            started_at=datetime(2026, 9, 18, 19, 0)),
                # Running ticket timer started 09-17 23:00 CDT → crosses midnight, live only.
                WorkSession(id='run-ticket', work_log_id='ticket:tk-client',
                            started_at=datetime(2026, 9, 18, 4, 0)),
                # Today's habit check-ins.
                HabitLog(id='hl-med', task_id='h-meditate', date='2026-09-18', count=1),
                HabitLog(id='hl-water', task_id='h-water', date='2026-09-18', count=1),
            ])
            db.commit()

        # Fail any accidental INSERT/UPDATE/DELETE from a "read".
        with self.engine.connect() as conn:
            conn.execute(text('PRAGMA query_only=ON'))

        app = FastAPI()
        app.include_router(router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        app.dependency_overrides[get_db] = test_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def workspace(self):
        """Service call with a fixed clock, for deterministic live numbers."""
        with Session(self.engine) as db:
            return build_day_workspace(db, DAY, CHICAGO, AS_OF)

    # ── Recorded totals & attribution ────────────────────────────────────────

    def test_recorded_totals_no_double_count(self):
        w = self.workspace()
        # task 3600 (today only) + ticket 1800 + worklog 900 = 6300.
        self.assertEqual(w['totals']['recorded_seconds'], 6300)
        keys = {e['key']: e['seconds'] for e in w['recorded']}
        self.assertEqual(keys, {
            'task:t-redesign': 3600, 'ticket:tk-client': 1800, 'worklog:lg-beta': 900,
        })

    def test_project_and_client_groupings_each_sum_to_total(self):
        w = self.workspace()
        proj = {g['project_title']: g['seconds'] for g in w['by_project']}
        self.assertEqual(proj, {'Basira': 3600, 'Client Proj': 1800, 'Unassigned': 900})
        client = {g['company_name']: g['seconds'] for g in w['by_client']}
        self.assertEqual(client, {'Personal': 3600, 'Alpha': 1800, 'Beta': 900})
        self.assertEqual(sum(g['seconds'] for g in w['by_project']), 6300)
        self.assertEqual(sum(g['seconds'] for g in w['by_client']), 6300)

    # ── Live overlay stays separate from recorded ────────────────────────────

    def test_live_overlay_is_separate_and_deterministic(self):
        w = self.workspace()
        # run-task elapsed 3600 (19:00→20:00 UTC), run-ticket 57600 (04:00→20:00 UTC).
        self.assertEqual(w['totals']['live_seconds'], 3600 + 57600)
        self.assertEqual(w['totals']['recorded_seconds'], 6300)  # unchanged by live
        live = {t['key']: t['elapsed_seconds'] for t in w['active_timers']}
        self.assertEqual(live, {'task:t-redesign': 3600, 'ticket:tk-client': 57600})
        basira = next(g for g in w['by_project'] if g['project_title'] == 'Basira')
        self.assertEqual((basira['seconds'], basira['live_seconds']), (3600, 3600))

    def test_warnings_for_overlap_and_midnight(self):
        w = self.workspace()
        codes = {warn['code'] for warn in w['warnings']}
        self.assertIn('multiple_active_timers', codes)
        self.assertIn('session_crosses_midnight', codes)
        crossing = next(t for t in w['active_timers'] if t['key'] == 'ticket:tk-client')
        self.assertTrue(crossing['crosses_midnight'])

    # ── Timezone day-allocation ──────────────────────────────────────────────

    def test_timezone_moves_boundary_session_across_days(self):
        # In UTC, the 04:30-UTC session falls on 2026-09-18; in Chicago it is 09-17.
        with Session(self.engine) as db:
            utc = build_day_workspace(db, DAY, ZoneInfo('UTC'), AS_OF)
            chi = build_day_workspace(db, DAY, CHICAGO, AS_OF)
        # UTC day includes both saved task sessions (3600 + 1800); Chicago only 3600.
        utc_task = next(e for e in utc['recorded'] if e['key'] == 'task:t-redesign')
        chi_task = next(e for e in chi['recorded'] if e['key'] == 'task:t-redesign')
        self.assertEqual(utc_task['seconds'], 5400)
        self.assertEqual(chi_task['seconds'], 3600)

    # ── Agenda / unscheduled from existing single-block fields ────────────────

    def test_agenda_splits_by_scheduled_time(self):
        w = self.workspace()
        agenda = {i['key'] for i in w['agenda']}
        unscheduled = {i['key'] for i in w['unscheduled']}
        self.assertIn('task:t-redesign', agenda)       # has scheduled_time 10:45
        self.assertIn('ticket:tk-loose', unscheduled)  # planned today, no time
        redesign = next(i for i in w['agenda'] if i['key'] == 'task:t-redesign')
        self.assertEqual(redesign['recorded_seconds'], 3600)
        self.assertEqual(redesign['planned_minutes'], 75)

    # ── Routines grouped by time of day ──────────────────────────────────────

    def test_routines_grouped_with_progress(self):
        w = self.workspace()
        r = w['routines']
        self.assertEqual({h['id'] for h in r['morning']}, {'h-meditate'})
        self.assertEqual({h['id'] for h in r['evening']}, {'h-workout'})
        self.assertEqual({h['id'] for h in r['anytime']}, {'h-water'})
        meditate = r['morning'][0]
        self.assertTrue(meditate['done'])  # count 1 >= target 1
        water = r['anytime'][0]
        self.assertEqual((water['count'], water['target'], water['done']), (1, 2, False))

    # ── Endpoint contract & read-only guarantee ──────────────────────────────

    def test_endpoint_returns_totals_and_is_read_only(self):
        res = self.client.get('/day-workspace', params={
            'date': '2026-09-18', 'timezone': 'America/Chicago',
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data['totals']['recorded_seconds'], 6300)
        self.assertEqual(data['date'], '2026-09-18')
        self.assertEqual(data['timezone'], 'America/Chicago')
        # POST is not allowed on a read-only endpoint.
        self.assertEqual(self.client.post('/day-workspace').status_code, 405)

    def test_reads_leave_records_unchanged(self):
        self.client.get('/day-workspace', params={'date': '2026-09-18'})
        self.workspace()
        with Session(self.engine) as db:
            self.assertEqual(db.get(WorkTimeEntry, 'wte-client').duration_seconds, 1800)
            self.assertEqual(db.get(WorkSession, 'task-today').duration_seconds, 3600)
            self.assertIsNone(db.get(WorkSession, 'run-task').ended_at)
            self.assertEqual(db.query(WorkSession).count(), 5)
            self.assertEqual(db.query(HabitLog).count(), 2)

    def test_capacity_available_and_over(self):
        w = self.workspace()
        # Default window 09:00–18:00 (540m) with 15% buffer -> 459 available.
        self.assertEqual(w['totals']['available_minutes'], 459)
        self.assertEqual(w['totals']['day_start'], '09:00')
        self.assertEqual(w['totals']['buffer_pct'], 15)
        # planned 75m (from the redesign task) is under 459 -> not over.
        self.assertEqual(w['totals']['over_minutes'], 0)

    def test_invalid_timezone_rejected(self):
        res = self.client.get('/day-workspace', params={'timezone': 'Mars/Phobos'})
        self.assertEqual(res.status_code, 400)


if __name__ == '__main__':
    unittest.main()
