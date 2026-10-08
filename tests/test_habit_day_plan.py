"""Habits on a day's schedule (BAS-050). In-memory DB only; never imports app.main.

Proves: a habit is placed per day (today and another day at once) without touching
its own plan_date or default time; the agenda shows it as a habit row whose done
state comes from that day's check-ins; the Routine model marks it as planned; and
removing/re-timing affects only that day.
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
from app.models.habit_log import HabitLog
from app.models.task import Task
from app.routes.schedule import router as schedule_router
from app.services.day_workspace import build_day_workspace

TODAY = date.today()
THU = TODAY + timedelta(days=2)


class HabitDayPlanTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([Goal(id='r', title='Deen', type='resolution'),
                        Goal(id='p', title='Basira', type='project')])
            db.flush()
            db.add_all([
                Task(id='h-quran', goal_id='r', title='Read Quran Wird', status='todo',
                     habit_frequency='daily', scheduled_time='06:30'),
                Task(id='h-water', goal_id='r', title='Drink water', status='todo', habit_frequency='3x_day'),
                Task(id='t-proj', goal_id='p', title='Project task', status='todo'),
            ])
            db.commit()
        app = FastAPI()
        app.include_router(schedule_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        app.dependency_overrides[get_db] = test_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def add(self, task_id, day=TODAY):
        return self.client.post('/today/schedule/add', json={'kind': 'habit', 'id': task_id, 'date': day.isoformat()})

    def workspace(self, day=TODAY, read_only=True):
        with Session(self.engine) as db:
            if read_only:   # proves the day model never writes (shared connection: reset after)
                db.execute(text('PRAGMA query_only = ON'))
            try:
                return build_day_workspace(db, day, ZoneInfo('UTC'), datetime.now(UTC))
            finally:
                db.execute(text('PRAGMA query_only = OFF'))

    def rows(self, ws):
        return {i['key']: i for i in ws['agenda'] + ws['unscheduled']}

    def test_habit_is_placed_per_day_without_touching_the_habit(self):
        self.assertEqual(self.add('h-quran').status_code, 200)
        self.assertEqual(self.add('h-quran', THU).status_code, 200)
        self.assertEqual(self.add('h-quran').status_code, 200)   # idempotent
        with Session(self.engine) as db:
            self.assertEqual(db.query(HabitDayPlan).filter_by(task_id='h-quran').count(), 2)
            habit = db.get(Task, 'h-quran')
            self.assertIsNone(habit.plan_date)
            self.assertEqual(habit.scheduled_time, '06:30')
        self.assertIn('habit:h-quran', self.rows(self.workspace(TODAY)))
        self.assertIn('habit:h-quran', self.rows(self.workspace(THU)))

    def test_agenda_row_uses_default_time_and_checkins(self):
        self.add('h-quran'); self.add('h-water')
        rows = self.rows(self.workspace())
        quran, water = rows['habit:h-quran'], rows['habit:h-water']
        self.assertEqual(quran['source'], 'habit')
        self.assertEqual(quran['scheduled_time'], '06:30')
        self.assertEqual(quran['status'], 'todo')
        self.assertEqual((water['habit_count'], water['habit_target']), (0, 3))
        with Session(self.engine) as db:
            db.add_all([HabitLog(id='l1', task_id='h-quran', date=TODAY.isoformat(), count=1),
                        HabitLog(id='l2', task_id='h-water', date=TODAY.isoformat(), count=2)])
            db.commit()
        rows = self.rows(self.workspace())
        self.assertEqual(rows['habit:h-quran']['status'], 'done')     # closed off for the day
        self.assertEqual(rows['habit:h-water']['status'], 'todo')     # 2 of 3
        self.assertEqual(rows['habit:h-water']['habit_count'], 2)
        # Tomorrow's occurrence is unaffected by today's check-in.
        self.add('h-quran', THU)
        self.assertEqual(self.rows(self.workspace(THU))['habit:h-quran']['status'], 'todo')

    def test_routines_mark_planned_habits(self):
        self.add('h-quran')
        habits = {h['id']: h for b in self.workspace()['routines'].values() for h in b}
        self.assertTrue(habits['h-quran']['planned'])
        self.assertFalse(habits['h-water']['planned'])
        habits_thu = {h['id']: h for b in self.workspace(THU)['routines'].values() for h in b}
        self.assertFalse(habits_thu['h-quran']['planned'])

    def test_time_and_remove_affect_only_that_day(self):
        self.add('h-quran'); self.add('h-quran', THU)
        r = self.client.post('/today/schedule/time', json={'kind': 'habit', 'id': 'h-quran', 'time': '05:45',
                                                            'date': TODAY.isoformat()})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.rows(self.workspace())['habit:h-quran']['scheduled_time'], '05:45')
        self.assertEqual(self.rows(self.workspace(THU))['habit:h-quran']['scheduled_time'], '06:30')
        with Session(self.engine) as db:
            self.assertEqual(db.get(Task, 'h-quran').scheduled_time, '06:30')
        self.client.post('/today/schedule/remove', json={'kind': 'habit', 'id': 'h-quran', 'date': TODAY.isoformat()})
        self.assertNotIn('habit:h-quran', self.rows(self.workspace()))
        self.assertIn('habit:h-quran', self.rows(self.workspace(THU)))

    def test_only_habits_can_be_added_as_habits(self):
        self.assertEqual(self.add('t-proj').status_code, 400)
        self.assertEqual(self.add('missing').status_code, 404)

    def test_trashed_habit_leaves_the_schedule(self):
        self.add('h-quran')
        with Session(self.engine) as db:
            db.get(Task, 'h-quran').trashed_at = datetime.now(UTC)
            db.commit()
        self.assertNotIn('habit:h-quran', self.rows(self.workspace()))


if __name__ == '__main__':
    unittest.main()
