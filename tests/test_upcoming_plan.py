"""Plan upcoming days (BAS-046). In-memory DB only; never imports app.main.

Proves: /today/schedule/add plans a chosen date (default today, bad date rejected),
the upcoming overview matches Today's agenda/capacity rules and is write-free, and
morning suggestions for a future day skip work planned for another day while
labelling work still on today's plan.
"""
import unittest
from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.company import Company
from app.models.goal import Goal
from app.models.setting import Setting
from app.models.task import Task
from app.models.work_ticket import WorkTicket
from app.routes.schedule import router as schedule_router
from app.services.morning_planner import morning_suggestions
from app.services.upcoming_plan import upcoming_days

TODAY = date(2026, 10, 6)


def day(n):
    return (TODAY + timedelta(days=n)).isoformat()


class UpcomingPlanTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([Company(id='c', name='Client'), Goal(id='g', title='Basira', type='project'),
                        Setting(key='day_start', value='09:00'), Setting(key='day_end', value='17:00'),
                        Setting(key='buffer_pct', value='0')])
            db.flush()
            db.add_all([
                Task(id='t-today', goal_id='g', title='On today', status='todo', plan_date=day(0),
                     estimated_minutes=60),
                Task(id='t-tomorrow', goal_id='g', title='Planned tomorrow', status='todo', plan_date=day(1),
                     scheduled_time='10:00', estimated_minutes=120),
                Task(id='t-thu', goal_id='g', title='Planned Thursday', status='todo', plan_date=day(2),
                     estimated_minutes=500),
                Task(id='t-free', goal_id='g', title='Unplanned', status='todo', estimated_minutes=30),
                WorkTicket(id='tk-tomorrow', company_id='c', linked_goal_id='g', title='Ticket tomorrow',
                           status='todo', plan_date=day(1), estimated_minutes=45),
                WorkTicket(id='tk-today', company_id='c', title='Ticket today', status='todo', plan_date=day(0)),
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

    def plan_date(self, model, id_):
        with Session(self.engine) as db:
            return db.get(model, id_).plan_date

    # ── Planning a chosen day ────────────────────────────────────────────────
    def test_add_plans_the_requested_date(self):
        r = self.client.post('/today/schedule/add', json={'kind': 'task', 'id': 't-free', 'date': day(3)})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.plan_date(Task, 't-free'), day(3))
        r = self.client.post('/today/schedule/add', json={'kind': 'ticket', 'id': 'tk-today', 'date': day(1)})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.plan_date(WorkTicket, 'tk-today'), day(1))

    def test_add_without_date_still_means_today(self):
        self.client.post('/today/schedule/add', json={'kind': 'task', 'id': 't-free'})
        self.assertEqual(self.plan_date(Task, 't-free'), date.today().isoformat())

    def test_add_rejects_a_bad_date(self):
        r = self.client.post('/today/schedule/add', json={'kind': 'task', 'id': 't-free', 'date': 'next friday'})
        self.assertEqual(r.status_code, 400)
        self.assertIsNone(self.plan_date(Task, 't-free'))

    # ── Upcoming overview ────────────────────────────────────────────────────
    def test_upcoming_days_counts_and_capacity(self):
        with Session(self.engine) as db:
            db.execute(text('PRAGMA query_only = ON'))   # proves the read model never writes
            data = upcoming_days(db, TODAY, 4)
        days = {d['date']: d for d in data['days']}
        self.assertEqual(list(days), [day(0), day(1), day(2), day(3)])
        self.assertEqual(days[day(1)]['item_count'], 2)
        self.assertEqual(days[day(1)]['planned_minutes'], 165)
        self.assertEqual(days[day(1)]['available_minutes'], 480)
        self.assertEqual(days[day(2)]['over_minutes'], 20)
        self.assertEqual(days[day(3)]['item_count'], 0)
        self.assertEqual({i['key'] for i in days[day(1)]['items']}, {'task:t-tomorrow', 'ticket:tk-tomorrow'})

    def test_upcoming_days_is_clamped(self):
        with Session(self.engine) as db:
            self.assertEqual(len(upcoming_days(db, TODAY, 400)['days']), 31)
            self.assertEqual(len(upcoming_days(db, TODAY, 0)['days']), 1)

    # ── Suggestions for an upcoming day ──────────────────────────────────────
    def suggestions(self, planning):
        with Session(self.engine) as db:
            data = morning_suggestions(db, planning, actual_today=TODAY)
        return {g['key']: g for g in data['groups']}

    def all_keys(self, groups):
        return {i['key'] for g in groups.values() for i in g['items']}

    def test_future_day_skips_work_planned_for_another_day(self):
        g = self.suggestions(TODAY + timedelta(days=1))
        keys = self.all_keys(g)
        self.assertNotIn('task:t-thu', keys)          # already planned for Thursday
        self.assertNotIn('task:t-tomorrow', keys)     # already on the day being planned

    def test_future_day_labels_work_still_on_today(self):
        g = self.suggestions(TODAY + timedelta(days=1))
        carry = {i['key']: i for i in g['yesterday']['items']}
        self.assertEqual(g['yesterday']['label'], 'Carry over')
        self.assertEqual(carry['task:t-today']['reasons'], ["Still on today's plan"])
        self.assertEqual(carry['ticket:tk-today']['reasons'], ["Still on today's plan"])

    def test_today_planning_skips_upcoming_planned_work(self):
        g = self.suggestions(TODAY)
        self.assertEqual(g['yesterday']['label'], "Yesterday's plan")
        keys = self.all_keys(g)
        self.assertNotIn('task:t-tomorrow', keys)
        self.assertNotIn('ticket:tk-tomorrow', keys)


if __name__ == '__main__':
    unittest.main()
