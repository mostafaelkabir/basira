"""Habit routines: pick the weekdays and time a habit goes on the planner by itself.
In-memory DB only; never imports app.main.

Proves: PATCH /tasks/{id} stores weekdays + a default time (validated, "" / []
clear); the day workspace puts the habit on matching days at that time and not on
others; the Routine model marks it planned on those days; taking it off one day
skips only that day (next week is untouched, adding it back undoes the skip); a
per-day time override still works; the legacy /today/schedule feed sees it too;
a hand-placed habit still works on a day outside its routine.
"""
import unittest
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.goal import Goal
from app.models.habit_day_plan import HabitDayPlan
from app.models.task import Task
from app.routes.schedule import router as schedule_router
from app.routes.tasks import router as tasks_router
from app.services.day_workspace import build_day_workspace
from app.services.habit_routine import WEEKDAYS, habit_placements, parse_routine_days

TODAY = date.today()
TOK = WEEKDAYS[TODAY.weekday()]                 # today's weekday token, e.g. "fri"
NEXT_WEEK = TODAY + timedelta(days=7)
OTHER = TODAY + timedelta(days=1)               # tomorrow: a weekday the routine won't use
OTHER_TOK = WEEKDAYS[OTHER.weekday()]


class HabitRoutineTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add(Goal(id='r', title='Deen', type='resolution'))
            db.flush()
            db.add_all([
                Task(id='h-quran', goal_id='r', title='Read Quran Wird', status='todo', habit_frequency='daily'),
                Task(id='h-gym', goal_id='r', title='Gym', status='todo', habit_frequency='3x_week'),
            ])
            db.commit()
        api = FastAPI()
        api.include_router(schedule_router)
        api.include_router(tasks_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        api.dependency_overrides[get_db] = test_db
        self.client = TestClient(api)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def patch(self, task_id, **body):
        return self.client.patch(f'/tasks/{task_id}', json=body)

    def workspace(self, day=TODAY):
        with Session(self.engine) as db:
            db.execute(text('PRAGMA query_only = ON'))   # the day model never writes
            try:
                return build_day_workspace(db, day, ZoneInfo('UTC'), datetime.now(UTC))
            finally:
                db.execute(text('PRAGMA query_only = OFF'))

    def rows(self, ws):
        return {i['key']: i for i in ws['agenda'] + ws['unscheduled']}

    def routines(self, ws):
        return {h['id']: h for b in ws['routines'].values() for h in b}

    # ── storing the routine ──

    def test_routine_is_stored_normalised_and_read_back(self):
        r = self.patch('h-quran', routine_days=['Wed', 'mon', ' FRI '], scheduled_time='06:30')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['routine_days'], ['mon', 'wed', 'fri'])
        self.assertEqual(r.json()['scheduled_time'], '06:30')
        full = self.client.get('/tasks/h-quran').json()
        self.assertEqual((full['routine_days'], full['scheduled_time']), (['mon', 'wed', 'fri'], '06:30'))
        with Session(self.engine) as db:
            self.assertEqual(db.get(Task, 'h-quran').routine_days, 'mon,wed,fri')

    def test_bad_days_or_time_are_rejected_and_empty_clears(self):
        self.assertEqual(self.patch('h-quran', routine_days=['funday']).status_code, 400)
        self.assertEqual(self.patch('h-quran', scheduled_time='6:30pm').status_code, 400)
        self.patch('h-quran', routine_days=['mon'], scheduled_time='06:30')
        r = self.patch('h-quran', routine_days=[], scheduled_time='')
        self.assertEqual((r.json()['routine_days'], r.json()['scheduled_time']), ([], None))
        self.assertEqual(parse_routine_days(None), [])

    def test_create_accepts_a_routine(self):
        r = self.client.post('/tasks', json={'title': 'Walk', 'goal_id': 'r', 'requires_proof': False,
                                             'routine_days': [TOK], 'scheduled_time': '07:00'})
        self.assertEqual(r.status_code, 201)
        self.assertIn(f"habit:{r.json()['id']}", self.rows(self.workspace()))

    # ── on the planner ──

    def test_routine_habit_shows_on_its_days_at_its_time(self):
        self.patch('h-quran', routine_days=[TOK], scheduled_time='06:30')
        row = self.rows(self.workspace())['habit:h-quran']
        self.assertEqual((row['source'], row['scheduled_time'], row['status']), ('habit', '06:30', 'todo'))
        self.assertTrue(row['routine'])
        self.assertEqual(row['routine_days'], [TOK])
        self.assertIn('habit:h-quran', self.rows(self.workspace(NEXT_WEEK)))
        self.assertNotIn('habit:h-quran', self.rows(self.workspace(OTHER)))
        self.assertNotIn('habit:h-gym', self.rows(self.workspace()))
        with Session(self.engine) as db:
            self.assertEqual(db.query(HabitDayPlan).count(), 0, 'routine placement needs no rows')

    def test_routine_habit_without_a_time_is_an_anytime_row(self):
        self.patch('h-gym', routine_days=[TOK])
        ws = self.workspace()
        self.assertIn('habit:h-gym', {i['key'] for i in ws['unscheduled']})

    def test_routines_strip_marks_it_planned_only_on_its_days(self):
        self.patch('h-quran', routine_days=[TOK], scheduled_time='06:30')
        self.assertTrue(self.routines(self.workspace())['h-quran']['planned'])
        self.assertEqual(self.routines(self.workspace())['h-quran']['routine_days'], [TOK])
        self.assertFalse(self.routines(self.workspace(OTHER))['h-quran']['planned'])

    def test_legacy_today_feed_includes_routine_habits(self):
        self.patch('h-quran', routine_days=[TOK])
        ids = [i['id'] for i in self.client.get('/today/schedule').json() if i['kind'] == 'habit']
        self.assertEqual(ids, ['h-quran'])

    # ── per-day changes against a routine ──

    def test_taking_it_off_one_day_skips_only_that_day(self):
        self.patch('h-quran', routine_days=[TOK], scheduled_time='06:30')
        r = self.client.post('/today/schedule/remove', json={'kind': 'habit', 'id': 'h-quran', 'date': TODAY.isoformat()})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn('habit:h-quran', self.rows(self.workspace()))
        self.assertFalse(self.routines(self.workspace())['h-quran']['planned'])
        self.assertIn('habit:h-quran', self.rows(self.workspace(NEXT_WEEK)), 'next week is untouched')
        with Session(self.engine) as db:
            plan = db.query(HabitDayPlan).filter_by(task_id='h-quran', date=TODAY.isoformat()).one()
            self.assertTrue(plan.skipped)
        # Adding it back for today undoes the skip.
        self.client.post('/today/schedule/add', json={'kind': 'habit', 'id': 'h-quran', 'date': TODAY.isoformat()})
        self.assertIn('habit:h-quran', self.rows(self.workspace()))

    def test_per_day_time_override_beats_the_routine_time(self):
        self.patch('h-quran', routine_days=[TOK], scheduled_time='06:30')
        self.client.post('/today/schedule/time', json={'kind': 'habit', 'id': 'h-quran', 'time': '21:00',
                                                        'date': TODAY.isoformat()})
        self.assertEqual(self.rows(self.workspace())['habit:h-quran']['scheduled_time'], '21:00')
        self.assertEqual(self.rows(self.workspace(NEXT_WEEK))['habit:h-quran']['scheduled_time'], '06:30')

    def test_hand_placement_outside_the_routine_still_works(self):
        self.patch('h-quran', routine_days=[TOK], scheduled_time='06:30')
        self.client.post('/today/schedule/add', json={'kind': 'habit', 'id': 'h-quran', 'date': OTHER.isoformat()})
        row = self.rows(self.workspace(OTHER))['habit:h-quran']
        self.assertFalse(row['routine'])
        self.assertEqual(row['scheduled_time'], '06:30')
        # Removing a hand placement outside the routine simply deletes it (no skip marker).
        self.client.post('/today/schedule/remove', json={'kind': 'habit', 'id': 'h-quran', 'date': OTHER.isoformat()})
        self.assertNotIn('habit:h-quran', self.rows(self.workspace(OTHER)))
        with Session(self.engine) as db:
            self.assertEqual(db.query(HabitDayPlan).filter_by(date=OTHER.isoformat()).count(), 0)

    def test_schemas_read_the_stored_days_from_an_orm_task(self):
        # /today builds TaskWithProofs straight from ORM rows, where routine_days is "mon,wed".
        from app.schemas.task import TaskRead, TaskWithProofs
        with Session(self.engine) as db:
            task = db.get(Task, 'h-quran')
            task.routine_days = 'mon,wed'
            self.assertEqual(TaskWithProofs.model_validate(task).routine_days, ['mon', 'wed'])
            self.assertEqual(TaskRead.model_validate(task).routine_days, ['mon', 'wed'])
            task.routine_days = None
            self.assertEqual(TaskWithProofs.model_validate(task).routine_days, [])

    def test_done_or_trashed_habits_leave_the_routine(self):
        self.patch('h-quran', routine_days=[TOK])
        with Session(self.engine) as db:
            db.get(Task, 'h-quran').trashed_at = datetime.now(UTC)
            db.commit()
        self.assertNotIn('habit:h-quran', self.rows(self.workspace()))
        with Session(self.engine) as db:
            self.assertEqual(habit_placements(db, TODAY), {})


if __name__ == '__main__':
    unittest.main()
