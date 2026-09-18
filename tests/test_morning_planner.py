"""Morning-planner suggestion tests (ticket: Design a single morning planning
workspace). In-memory DB; proves every suggestion carries a reason, ranking by
urgency, exclusion of already-planned/done/archived items, and read-only behavior.
"""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.company import Company
from app.models.goal import Goal
from app.models.task import Task
from app.models.work_ticket import WorkTicket
from app.routes.morning_planner import router

TODAY = "2026-09-18"
YESTERDAY = "2026-09-17"


class MorningPlannerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([
                Company(id='c', name='Client'),
                Goal(id='g', title='Basira', type='project'),
                Goal(id='old', title='Archived', type='project',
                     archived_at=__import__('datetime').datetime(2020, 1, 1)),
            ])
            db.flush()
            db.add_all([
                # In-progress ticket, not planned today -> suggested "In progress".
                WorkTicket(id='tk-wip', company_id='c', linked_goal_id='g',
                           title='Latency work', status='in_progress'),
                # Ticket carried over from yesterday.
                WorkTicket(id='tk-carry', company_id='c', title='Old ticket',
                           status='todo', plan_date=YESTERDAY),
                # Already planned today -> excluded.
                WorkTicket(id='tk-today', company_id='c', title='On the plan',
                           status='in_progress', plan_date=TODAY),
                # Done -> excluded.
                WorkTicket(id='tk-done', company_id='c', title='Finished', status='done'),
                # Overdue task.
                Task(id='t-overdue', goal_id='g', title='Overdue task', status='todo',
                     due_date=YESTERDAY),
                # Due today.
                Task(id='t-due', goal_id='g', title='Due today task', status='todo',
                     due_date=TODAY),
                # Carried over task (past plan_date, no due date).
                Task(id='t-carry', goal_id='g', title='Carried task', status='todo',
                     plan_date=YESTERDAY),
                # Archived-goal task -> excluded.
                Task(id='t-arch', goal_id='old', title='Archived task', status='todo',
                     due_date=YESTERDAY),
                # Future due, no plan -> not suggested.
                Task(id='t-future', goal_id='g', title='Future task', status='todo',
                     due_date='2026-12-31'),
            ])
            db.commit()
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

    def get(self):
        return self.client.get('/morning-suggestions', params={'date': TODAY}).json()

    def test_every_suggestion_has_a_reason(self):
        data = self.get()
        self.assertTrue(data['suggestions'])
        for s in data['suggestions']:
            self.assertTrue(s['reasons'], f"{s['key']} has no reason")

    def test_includes_expected_and_excludes_planned_done_archived(self):
        keys = {s['key'] for s in self.get()['suggestions']}
        self.assertEqual(keys, {
            'ticket:tk-wip', 'ticket:tk-carry',
            'task:t-overdue', 'task:t-due', 'task:t-carry',
        })
        # Explicitly excluded:
        self.assertNotIn('ticket:tk-today', keys)   # already planned today
        self.assertNotIn('ticket:tk-done', keys)    # done
        self.assertNotIn('task:t-arch', keys)       # archived goal
        self.assertNotIn('task:t-future', keys)     # future, unplanned

    def test_ranked_by_urgency_overdue_first(self):
        order = [s['key'] for s in self.get()['suggestions']]
        # Overdue outranks due-today, which outranks in-progress, which outranks carried.
        self.assertLess(order.index('task:t-overdue'), order.index('task:t-due'))
        self.assertLess(order.index('task:t-due'), order.index('ticket:tk-wip'))
        self.assertLess(order.index('ticket:tk-wip'), order.index('ticket:tk-carry'))

    def test_reason_text_and_counts(self):
        data = self.get()
        by_key = {s['key']: s for s in data['suggestions']}
        self.assertIn('In progress', by_key['ticket:tk-wip']['reasons'])
        self.assertIn(f'Overdue since {YESTERDAY}', by_key['task:t-overdue']['reasons'])
        self.assertIn('Due today', by_key['task:t-due']['reasons'])
        self.assertIn(f'Carried over from {YESTERDAY}', by_key['task:t-carry']['reasons'])
        self.assertEqual(data['counts']['in_progress'], 1)
        self.assertEqual(data['counts']['due'], 2)     # overdue + due today
        self.assertEqual(data['counts']['carried_over'], 2)  # tk-carry + t-carry

    def test_read_only(self):
        self.get()
        with Session(self.engine) as db:
            self.assertEqual(db.get(WorkTicket, 'tk-wip').status, 'in_progress')
            self.assertIsNone(db.get(Task, 't-overdue').plan_date)  # not moved onto today
        self.assertEqual(self.client.post('/morning-suggestions').status_code, 405)


if __name__ == '__main__':
    unittest.main()
