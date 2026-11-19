"""Goal outcomes. In-memory DB only; never imports app.main.

Proves: a goal can be marked achieved, blocked, moved out or cancelled; blocked,
moved out and cancelled need a reason; closing outcomes take the goal off the
active list and blocked does not; every change is logged with from/to/reason;
reopening (by status or by unarchive) brings it back and is logged too.
"""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.goal import Goal
from app.routes.goals import router as goals_router


class GoalStatusTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([Goal(id='g', title='Launch app', type='project'), Goal(id='h', title='Side idea', type='project')])
            db.commit()
        api = FastAPI()
        api.include_router(goals_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        api.dependency_overrides[get_db] = test_db
        self.client = TestClient(api)

    def status(self, gid, status, reason=''):
        return self.client.post(f'/goals/{gid}/status', json={'status': status, 'reason': reason})

    def active_ids(self):
        return {g['id'] for g in self.client.get('/goals').json()}

    def test_new_goal_is_active(self):
        g = self.client.get('/goals/g').json()
        self.assertEqual((g['status'], g['status_reason'], g['status_history']), ('active', None, []))

    def test_achieved_closes_without_needing_a_reason(self):
        res = self.status('g', 'achieved')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['status'], 'achieved')
        self.assertIsNotNone(res.json()['archived_at'])
        self.assertEqual(self.active_ids(), {'h'})
        closed = self.client.get('/goals?archived=true').json()
        self.assertEqual([(c['id'], c['status']) for c in closed], [('g', 'achieved')])

    def test_blocked_needs_a_reason_and_stays_active(self):
        self.assertEqual(self.status('g', 'blocked').status_code, 400)
        self.assertEqual(self.status('g', 'blocked', '   ').status_code, 400)
        res = self.status('g', 'blocked', 'Waiting on the SSD')
        self.assertEqual((res.json()['status'], res.json()['status_reason'], res.json()['archived_at']),
                         ('blocked', 'Waiting on the SSD', None))
        self.assertEqual(self.active_ids(), {'g', 'h'})

    def test_moved_out_and_cancelled_need_reasons_and_close(self):
        self.assertEqual(self.status('g', 'moved_out').status_code, 400)
        self.assertEqual(self.status('h', 'cancelled').status_code, 400)
        self.assertEqual(self.status('g', 'moved_out', 'Client work takes priority until January').status_code, 200)
        self.assertEqual(self.status('h', 'cancelled', 'No longer worth doing').status_code, 200)
        self.assertEqual(self.active_ids(), set())

    def test_history_logs_every_change_newest_first(self):
        self.status('g', 'blocked', 'Waiting on legal')
        self.status('g', 'active', 'Legal cleared it')
        self.status('g', 'cancelled', 'Priorities shifted')
        hist = self.client.get('/goals/g').json()['status_history']
        self.assertEqual([(h['from_status'], h['to_status'], h['reason']) for h in hist], [
            ('active', 'cancelled', 'Priorities shifted'),
            ('blocked', 'active', 'Legal cleared it'),
            ('active', 'blocked', 'Waiting on legal'),
        ])

    def test_same_status_and_reason_is_not_logged_twice(self):
        self.status('g', 'blocked', 'Waiting')
        self.status('g', 'blocked', 'Waiting')
        self.assertEqual(len(self.client.get('/goals/g').json()['status_history']), 1)
        self.status('g', 'blocked', 'Still waiting, new vendor')
        self.assertEqual(len(self.client.get('/goals/g').json()['status_history']), 2)

    def test_reopening_restores_the_goal(self):
        self.status('g', 'cancelled', 'Priorities shifted')
        res = self.status('g', 'active')
        self.assertEqual((res.json()['status'], res.json()['archived_at']), ('active', None))
        self.assertIn('g', self.active_ids())

    def test_unarchive_reopens_a_closed_goal_on_record(self):
        self.status('g', 'achieved')
        self.assertEqual(self.client.post('/goals/g/unarchive').json()['status'], 'active')
        hist = self.client.get('/goals/g').json()['status_history']
        self.assertEqual((hist[0]['from_status'], hist[0]['to_status'], hist[0]['reason']), ('achieved', 'active', 'Reopened'))

    def test_plain_archive_keeps_status(self):
        self.client.post('/goals/g/archive')
        self.assertEqual(self.client.get('/goals?archived=true').json()[0]['status'], 'active')
        self.client.post('/goals/g/unarchive')
        self.assertEqual(self.client.get('/goals/g').json()['status_history'], [])

    def test_rejects_bad_input(self):
        self.assertEqual(self.status('g', 'paused', 'x').status_code, 400)
        self.assertEqual(self.status('nope', 'achieved').status_code, 404)


if __name__ == '__main__':
    unittest.main()
