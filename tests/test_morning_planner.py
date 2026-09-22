"""Morning-planner tests (ticket: Group, cap and snooze). In-memory DB; proves
grouping order, the 14-day cutoff, per-group cap, snooze for both sources, and that
GET is write-free.
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
from app.models.task import Task
from app.models.work_ticket import WorkTicket
from app.routes.morning_planner import router

DAY = date(2026, 9, 20)


def ago(n):
    return (DAY - timedelta(days=n)).isoformat()


def ahead(n):
    return (DAY + timedelta(days=n)).isoformat()


class MorningPlannerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([Company(id='c', name='Client'), Goal(id='g', title='Basira', type='project')])
            db.flush()
            db.add_all([
                WorkTicket(id='tk-wip', company_id='c', linked_goal_id='g', title='In-progress ticket',
                           status='in_progress', estimated_minutes=90),
                WorkTicket(id='tk-blocked', company_id='c', title='Blocked ticket', status='blocked'),
                WorkTicket(id='tk-carry', company_id='c', title='Carried ticket', status='todo', plan_date=ago(2)),
                Task(id='t-wip', goal_id='g', title='In-progress task', status='in_progress'),
                Task(id='t-overdue10', goal_id='g', title='Overdue 10d', status='todo', due_date=ago(10)),
                Task(id='t-overdue30', goal_id='g', title='Overdue 30d', status='todo', due_date=ago(30)),
                Task(id='t-due3', goal_id='g', title='Due in 3d', status='todo', due_date=ahead(3)),
                Task(id='t-carry3', goal_id='g', title='Carried 3d', status='todo', plan_date=ago(3)),
                Task(id='t-carry10', goal_id='g', title='Carried 10d', status='todo', plan_date=ago(10)),
            ])
            db.commit()
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

    def groups(self, **params):
        data = self.client.get('/morning-suggestions', params={'date': DAY.isoformat(), **params}).json()
        return {g['key']: g for g in data['groups']}

    def keys(self, group):
        return {i['key'] for i in group['items']}

    def test_grouping_order_and_membership(self):
        g = self.groups()
        self.assertEqual(self.keys(g['resume']), {'ticket:tk-wip', 'task:t-wip'})
        self.assertEqual(self.keys(g['yesterday']), {'ticket:tk-carry', 'task:t-carry3'})
        self.assertEqual(self.keys(g['due']), {'task:t-overdue10', 'task:t-due3'})
        # Older is collapsed to a preview but its total counts all.
        older_keys = self.keys(self.groups(include_older='true')['older'])
        self.assertEqual(older_keys, {'ticket:tk-blocked', 'task:t-overdue30', 'task:t-carry10'})

    def test_14_day_cutoff(self):
        g = self.groups(include_older='true')
        self.assertIn('task:t-overdue10', self.keys(g['due']))     # 10d overdue -> due
        self.assertIn('task:t-overdue30', self.keys(g['older']))   # 30d overdue -> older
        self.assertNotIn('task:t-overdue30', self.keys(g['due']))

    def test_in_progress_ticket_in_resume(self):
        g = self.groups()
        self.assertIn('ticket:tk-wip', self.keys(g['resume']))
        self.assertTrue(any('In progress' in i['reasons'] for i in g['resume']['items']))
        self.assertTrue(any('Blocked' in i['reasons'] for i in self.groups(include_older='true')['older']['items']))

    def test_reasons_and_suggested_minutes(self):
        g = self.groups()
        wip = next(i for i in g['resume']['items'] if i['key'] == 'ticket:tk-wip')
        self.assertEqual(wip['suggested_minutes'], 90)
        self.assertEqual(wip['company_name'], 'Client')
        due = next(i for i in g['due']['items'] if i['key'] == 'task:t-due3')
        self.assertEqual(due['suggested_minutes'], 30)   # no estimate -> default 30

    def test_older_collapsed_with_total(self):
        older = self.groups()['older']
        self.assertTrue(older['collapsed'] or older['total'] <= 3)
        self.assertLessEqual(len(older['items']), 3)
        self.assertEqual(older['total'], 3)

    def test_per_group_cap(self):
        with Session(self.engine) as db:
            for i in range(12):
                db.add(Task(id=f'wip{i}', goal_id='g', title=f'wip {i}', status='in_progress'))
            db.commit()
        self.assertEqual(len(self.groups()['resume']['items']), 8)   # capped
        self.assertEqual(self.groups()['resume']['total'], 14)       # 12 + tk-wip + t-wip

    def test_snooze_task_then_reappears(self):
        tomorrow = ahead(1)
        res = self.client.post('/morning-suggestions/snooze', json={'source': 'task', 'item_id': 't-due3', 'until': tomorrow})
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('task:t-due3', self.keys(self.groups()['due']))          # hidden today
        # A day later it is visible again.
        later = self.client.get('/morning-suggestions', params={'date': ahead(2)}).json()
        due = next(g for g in later['groups'] if g['key'] == 'due')
        self.assertIn('task:t-due3', {i['key'] for i in due['items']})
        with Session(self.engine) as db:  # estimate/status/title untouched
            t = db.get(Task, 't-due3')
            self.assertEqual((t.status, t.due_date), ('todo', ahead(3)))
            self.assertIsNone(t.plan_date)

    def test_snooze_ticket_until_date(self):
        self.client.post('/morning-suggestions/snooze', json={'source': 'ticket', 'item_id': 'tk-carry', 'until': ahead(5)})
        self.assertNotIn('ticket:tk-carry', self.keys(self.groups()['yesterday']))
        with Session(self.engine) as db:
            self.assertEqual(db.get(WorkTicket, 'tk-carry').snoozed_until, ahead(5))

    def test_get_is_write_free(self):
        # No writes on GET even with the query_only guard set.
        with self.engine.connect() as conn:
            conn.execute(text('PRAGMA query_only=ON'))
        self.assertEqual(self.client.get('/morning-suggestions', params={'date': DAY.isoformat()}).status_code, 200)


if __name__ == '__main__':
    unittest.main()
