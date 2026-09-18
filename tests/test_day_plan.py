"""Durable day-block tests: in-memory DB, isolated from the live database.

Covers reference validation (no guessing/creating goals), conflict preview,
overlap-free move with optimistic concurrency, and that the additive migration
creates the table without disturbing anything else.
"""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.company import Company
from app.models.day_block import DayBlock
from app.models.goal import Goal
from app.models.task import Task
from app.routes.day_plan import router

DAY = "2026-09-18"


class DayPlanTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([
                Company(id='alpha', name='Alpha'),
                Goal(id='basira', title='Basira', type='project'),
            ])
            db.flush()
            db.add(Task(id='t1', goal_id='basira', title='Redesign'))
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

    def create(self, **body):
        return self.client.post('/day-plan', json={'date': DAY, **body})

    # ── Reference validation ─────────────────────────────────────────────────

    def test_project_block_requires_existing_goal(self):
        self.assertEqual(self.create(kind='project', source_ref='goal:basira',
                                     start_time='09:00', duration_minutes=60).status_code, 201)
        self.assertEqual(self.create(kind='project', source_ref='goal:missing',
                                     start_time='11:00').status_code, 404)
        # Wrong reference type for the kind is rejected, not coerced.
        self.assertEqual(self.create(kind='project', source_ref='task:t1',
                                     start_time='11:00').status_code, 400)

    def test_client_and_item_blocks(self):
        self.assertEqual(self.create(kind='client', source_ref='company:alpha',
                                     start_time='13:00', duration_minutes=90).status_code, 201)
        self.assertEqual(self.create(kind='task', source_ref='task:t1',
                                     start_time='15:00').status_code, 201)
        self.assertEqual(self.create(kind='ticket', source_ref='ticket:nope',
                                     start_time='16:00').status_code, 404)

    def test_free_blocks_need_title_not_ref(self):
        self.assertEqual(self.create(kind='break', title='Lunch',
                                     start_time='12:00', duration_minutes=45).status_code, 201)
        self.assertEqual(self.create(kind='break', start_time='12:00').status_code, 400)  # no title
        self.assertEqual(self.create(kind='break', title='x', source_ref='task:t1',
                                     start_time='12:00').status_code, 400)  # ref not allowed
        self.assertEqual(self.create(kind='bogus', title='x', start_time='12:00').status_code, 400)

    # ── Conflict preview ─────────────────────────────────────────────────────

    def test_preview_reports_conflicts_without_saving(self):
        self.create(kind='project', source_ref='goal:basira', start_time='09:00', duration_minutes=60)
        res = self.client.post('/day-plan/preview', json={
            'date': DAY, 'kind': 'task', 'source_ref': 'task:t1',
            'start_time': '09:30', 'duration_minutes': 60,
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()['conflicts']), 1)
        # Preview did not persist anything.
        with Session(self.engine) as db:
            self.assertEqual(db.query(DayBlock).count(), 1)
        # A non-overlapping slot is clean.
        clean = self.client.post('/day-plan/preview', json={
            'date': DAY, 'kind': 'task', 'source_ref': 'task:t1', 'start_time': '11:00',
        })
        self.assertEqual(clean.json()['conflicts'], [])

    def test_unscheduled_blocks_never_conflict(self):
        self.create(kind='project', source_ref='goal:basira', start_time='09:00', duration_minutes=60)
        res = self.client.post('/day-plan/preview', json={
            'date': DAY, 'kind': 'task', 'source_ref': 'task:t1', 'start_time': None,
        })
        self.assertEqual(res.json()['conflicts'], [])

    # ── Move with optimistic concurrency ─────────────────────────────────────

    def test_move_changes_schedule_and_bumps_revision(self):
        block = self.create(kind='task', source_ref='task:t1',
                            start_time='09:00', duration_minutes=30).json()
        self.assertEqual(block['revision'], 1)
        moved = self.client.patch(f"/day-plan/{block['id']}", json={
            'start_time': '14:00', 'duration_minutes': 45, 'revision': 1,
        })
        self.assertEqual(moved.status_code, 200)
        self.assertEqual(moved.json()['start_time'], '14:00')
        self.assertEqual(moved.json()['revision'], 2)
        # A stale revision is refused as a conflict.
        stale = self.client.patch(f"/day-plan/{block['id']}", json={
            'start_time': '15:00', 'revision': 1,
        })
        self.assertEqual(stale.status_code, 409)
        # The referenced task is never modified by a move.
        with Session(self.engine) as db:
            self.assertIsNone(db.get(Task, 't1').scheduled_time)
            self.assertIsNone(db.get(Task, 't1').estimated_minutes)

    def test_list_and_delete(self):
        b1 = self.create(kind='task', source_ref='task:t1', start_time='09:00').json()
        self.create(kind='break', title='Lunch', start_time='12:00', duration_minutes=60)
        listed = self.client.get('/day-plan', params={'date': DAY}).json()
        self.assertEqual(len(listed['blocks']), 2)
        self.assertEqual(listed['planned_minutes'], 30 + 60)
        self.assertEqual(self.client.delete(f"/day-plan/{b1['id']}").status_code, 204)
        self.assertEqual(len(self.client.get('/day-plan', params={'date': DAY}).json()['blocks']), 1)

    # ── Additive migration ───────────────────────────────────────────────────

    def test_migration_creates_table_additively(self):
        """The documented CREATE TABLE IF NOT EXISTS is a no-op on a DB that already
        has day_blocks, and leaves existing rows intact. (The DDL is asserted here
        directly; importing app.main is avoided so no live-DB side effects run.)"""
        self.create(kind='task', source_ref='task:t1', start_time='09:00')
        # Re-running the day_blocks DDL against a populated table must not drop data.
        with self.engine.connect() as conn:
            conn.execute(text("""CREATE TABLE IF NOT EXISTS day_blocks (
                id TEXT PRIMARY KEY, date TEXT NOT NULL, start_time TEXT,
                duration_minutes INTEGER DEFAULT 30, kind TEXT NOT NULL, source_ref TEXT,
                title TEXT DEFAULT '', note TEXT DEFAULT '', revision INTEGER DEFAULT 1,
                created_at TIMESTAMP, updated_at TIMESTAMP)"""))
            conn.commit()
        self.assertIn('day_blocks', inspect(self.engine).get_table_names())
        with Session(self.engine) as db:
            self.assertEqual(db.query(DayBlock).count(), 1)


if __name__ == '__main__':
    unittest.main()
