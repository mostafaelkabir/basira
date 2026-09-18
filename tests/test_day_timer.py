"""Unified timer adapter tests: in-memory DB, isolated from the live database.

The load-bearing case: switching AWAY from a ticket must preserve the ticket's
elapsed time as a WorkTimeEntry (the ledger), not silently drop it — which the
legacy task-timer start path did.
"""
import unittest
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.company import Company
from app.models.goal import Goal
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_session import WorkSession
from app.models.work_ticket import WorkTicket, WorkTimeEntry
from app.routes.day_timer import router


class DayTimerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([
                Company(id='alpha', name='Alpha'),
                Goal(id='g', title='Goal', type='project'),
            ])
            db.flush()
            db.add_all([
                Task(id='t1', goal_id='g', title='Task one'),
                WorkTicket(id='tk', company_id='alpha', title='Ticket'),
                WorkLog(id='wl', company_id='alpha', title='Log', duration_minutes=0,
                        logged_at='2026-09-18'),
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

    def switch(self, source, item_id):
        return self.client.post('/day-timer/switch', json={'source': source, 'item_id': item_id})

    def _backdate_active(self, seconds):
        """Push the running session's start into the past so elapsed is measurable."""
        with Session(self.engine) as db:
            s = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).first()
            s.started_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=seconds)
            db.commit()

    # ── Single-active enforcement ────────────────────────────────────────────

    def test_switch_enforces_single_active(self):
        self.switch('task', 't1')
        self.switch('ticket', 'tk')
        active = self.client.get('/day-timer/active').json()
        self.assertEqual(active['count'], 1)
        self.assertEqual(active['active'][0]['source'], 'ticket')

    def test_switching_same_item_is_noop(self):
        first = self.switch('task', 't1').json()
        again = self.switch('task', 't1').json()
        self.assertTrue(again['already_running'])
        self.assertEqual(again['session_id'], first['session_id'])
        self.assertEqual(self.client.get('/day-timer/active').json()['count'], 1)

    # ── The ledger-preservation guarantee ────────────────────────────────────

    def test_switch_away_from_ticket_writes_time_entry(self):
        self.switch('ticket', 'tk')
        self._backdate_active(600)          # 10 minutes on the ticket
        self.switch('task', 't1')           # switch away -> must record ticket time
        with Session(self.engine) as db:
            entries = db.query(WorkTimeEntry).filter(WorkTimeEntry.ticket_id == 'tk').all()
            self.assertEqual(len(entries), 1)
            self.assertGreaterEqual(entries[0].duration_seconds, 600)
            self.assertEqual(db.get(WorkTicket, 'tk').logged_seconds, entries[0].duration_seconds)
            # And exactly one session is now active (the task).
            self.assertEqual(db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).count(), 1)

    def test_switch_away_from_worklog_accumulates_minutes(self):
        self.switch('worklog', 'wl')
        self._backdate_active(300)          # 5 minutes
        self.switch('task', 't1')
        with Session(self.engine) as db:
            self.assertGreaterEqual(db.get(WorkLog, 'wl').duration_minutes, 5)

    def test_stop_is_retry_safe(self):
        self.switch('task', 't1')
        self._backdate_active(120)
        first = self.client.post('/day-timer/stop').json()
        self.assertEqual(len(first['stopped']), 1)
        second = self.client.post('/day-timer/stop').json()
        self.assertEqual(second['stopped'], [])  # nothing left; no error

    def test_stop_all_reconciles_legacy_multiple_active(self):
        # Simulate a legacy state: two sessions running at once.
        with Session(self.engine) as db:
            past = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=300)
            db.add_all([
                WorkSession(id='a', task_id='t1', started_at=past),
                WorkSession(id='b', work_log_id='ticket:tk', started_at=past),
            ])
            db.commit()
        result = self.client.post('/day-timer/stop').json()
        self.assertEqual(len(result['stopped']), 2)
        with Session(self.engine) as db:
            self.assertEqual(db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).count(), 0)
            self.assertEqual(db.query(WorkTimeEntry).filter(WorkTimeEntry.ticket_id == 'tk').count(), 1)

    # ── Manual log across sources ────────────────────────────────────────────

    def test_manual_log_each_source(self):
        self.assertEqual(self.client.post('/day-timer/log', json={
            'source': 'ticket', 'item_id': 'tk', 'minutes': 45, 'date': '2026-09-10'}).status_code, 200)
        self.assertEqual(self.client.post('/day-timer/log', json={
            'source': 'task', 'item_id': 't1', 'minutes': 30, 'date': '2026-09-10'}).status_code, 200)
        self.client.post('/day-timer/log', json={'source': 'worklog', 'item_id': 'wl', 'minutes': 15})
        with Session(self.engine) as db:
            entry = db.query(WorkTimeEntry).filter(WorkTimeEntry.ticket_id == 'tk').one()
            self.assertEqual((entry.duration_seconds, entry.logged_at), (2700, '2026-09-10'))
            # Task manual entry is a saved, dated session (allocates to 2026-09-10).
            ts = db.query(WorkSession).filter(WorkSession.task_id == 't1').one()
            self.assertEqual(ts.duration_seconds, 1800)
            self.assertEqual(ts.started_at.strftime('%Y-%m-%d'), '2026-09-10')
            self.assertEqual(db.get(WorkLog, 'wl').duration_minutes, 15)

    def test_unknown_source_and_missing_item(self):
        self.assertEqual(self.switch('bogus', 'x').status_code, 400)
        self.assertEqual(self.switch('task', 'missing').status_code, 404)


if __name__ == '__main__':
    unittest.main()
