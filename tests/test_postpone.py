"""Postpone with a reason. In-memory DB only; never imports app.main.

Proves: POST /today/schedule/postpone moves a task to the chosen day (keeping its
time, dropping today's focus pin, hiding it from suggestions until then), logs the
deferral with category + the user's own words, leaves the reason as a note on the
task, shows up on the new day's agenda tagged with where it came from and why;
tickets move with a note too; bad requests are rejected.
"""
import unittest
from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.comment import Comment
from app.models.company import Company
from app.models.defer_log import DeferLog
from app.models.goal import Goal
from app.models.task import Task
from app.models.work_ticket import WorkTicket, WorkTicketComment
from app.routes.schedule import router as schedule_router
from app.services.day_workspace import _agenda

TODAY = date(2026, 10, 15)


def day(n):
    return (TODAY + timedelta(days=n)).isoformat()


class PostponeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([Company(id='c', name='Client'), Goal(id='g', title='Home', type='project')])
            db.flush()
            db.add_all([
                Task(id='car', goal_id='g', title='Clean my car', status='todo', plan_date=day(0),
                     pinned_date=day(0), scheduled_time='10:00'),
                WorkTicket(id='tk', company_id='c', title='Ship report', status='todo', plan_date=day(0)),
            ])
            db.commit()
        api = FastAPI()
        api.include_router(schedule_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        api.dependency_overrides[get_db] = test_db
        self.client = TestClient(api)

    def postpone(self, **body):
        return self.client.post('/today/schedule/postpone', json={'from_date': day(0), **body})

    def test_task_moves_with_reason(self):
        res = self.postpone(kind='task', id='car', to_date=day(1), reason="It's raining today", category='weather')
        self.assertEqual(res.status_code, 200, res.text)
        with Session(self.engine) as db:
            t = db.get(Task, 'car')
            self.assertEqual((t.plan_date, t.deferred_until, t.scheduled_time), (day(1), day(1), '10:00'))
            self.assertIsNone(t.pinned_date)
            log = db.query(DeferLog).one()
            self.assertEqual((log.deferred_on, log.deferred_until, log.defer_reason, log.note),
                             (day(0), day(1), 'weather', "It's raining today"))
            note = db.query(Comment).one()
            self.assertEqual(note.content, "Postponed to Fri, Oct 16: It's raining today")

            today_items, _, _ = _agenda(db, TODAY, {}, {})
            self.assertNotIn('task:car', {i['key'] for i in today_items})
            tomorrow_items, _, _ = _agenda(db, TODAY + timedelta(days=1), {}, {})
            row = next(i for i in tomorrow_items if i['key'] == 'task:car')
            self.assertEqual(row['postponed'], {'from_date': day(0), 'reason': "It's raining today",
                                                'category': 'weather'})

    def test_category_only_reason(self):
        self.assertEqual(self.postpone(kind='task', id='car', to_date=day(3), category='low_energy').status_code, 200)
        with Session(self.engine) as db:
            self.assertEqual(db.query(Comment).one().content, 'Postponed to Sun, Oct 18: Low energy')
            self.assertIsNone(db.query(DeferLog).one().note)

    def test_ticket_moves_with_note(self):
        res = self.postpone(kind='ticket', id='tk', to_date=day(2), reason='Waiting on data')
        self.assertEqual(res.status_code, 200, res.text)
        with Session(self.engine) as db:
            tk = db.get(WorkTicket, 'tk')
            self.assertEqual((tk.plan_date, tk.snoozed_until), (day(2), day(2)))
            self.assertEqual(db.query(WorkTicketComment).one().body, 'Postponed to Sat, Oct 17: Waiting on data')

    def test_rejects_bad_requests(self):
        self.assertEqual(self.postpone(kind='task', id='car', to_date=day(0)).status_code, 400)
        self.assertEqual(self.postpone(kind='task', id='car', to_date='soon').status_code, 400)
        self.assertEqual(self.postpone(kind='habit', id='car', to_date=day(1)).status_code, 400)
        self.assertEqual(self.postpone(kind='task', id='nope', to_date=day(1)).status_code, 404)
        with Session(self.engine) as db:
            self.assertEqual(db.get(Task, 'car').plan_date, day(0))
            self.assertEqual(db.query(DeferLog).count(), 0)


if __name__ == '__main__':
    unittest.main()
