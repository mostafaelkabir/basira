"""Trash tests: soft-delete goals/tasks, list with days-left, restore, purge > 30d."""
import unittest
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.goal import Goal
from app.models.task import Task
from app.routes.goals import router as goals_router
from app.routes.trash import router as trash_router, purge_expired


class TrashTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add(Goal(id='g', title='Basira', type='project'))
            db.flush()
            db.add_all([
                Task(id='t1', goal_id='g', title='Keep me', status='todo'),
                Task(id='t2', goal_id='g', title='Trash me', status='todo'),
            ])
            db.commit()
        app = FastAPI()
        app.include_router(goals_router)
        app.include_router(trash_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        app.dependency_overrides[get_db] = test_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def _trash_task(self, tid):
        with Session(self.engine) as db:
            db.get(Task, tid).trashed_at = datetime.now(UTC)
            db.commit()

    def test_delete_goal_is_soft_and_listed(self):
        self.assertEqual(self.client.delete('/goals/g').status_code, 204)
        with Session(self.engine) as db:
            self.assertIsNotNone(db.get(Goal, 'g').trashed_at)   # soft, not gone
        trash = self.client.get('/trash').json()
        self.assertEqual({g['id'] for g in trash['goals']}, {'g'})
        self.assertEqual(trash['goals'][0]['days_left'], 30)
        # The goal is hidden from the goals list.
        self.assertEqual(self.client.get('/goals').json(), [])

    def test_restore_goal(self):
        self.client.delete('/goals/g')
        self.assertEqual(self.client.post('/trash/goal/g/restore').status_code, 200)
        self.assertEqual({g['id'] for g in self.client.get('/goals').json()}, {'g'})
        self.assertEqual(self.client.get('/trash').json()['goals'], [])

    def test_task_trash_restore_and_hidden_from_goal(self):
        self._trash_task('t2')
        detail = self.client.get('/goals/g').json()
        self.assertNotIn('t2', {t['id'] for t in detail['tasks']})   # hidden
        self.assertIn('t1', {t['id'] for t in detail['tasks']})
        trash = self.client.get('/trash').json()
        self.assertEqual({t['id'] for t in trash['tasks']}, {'t2'})
        self.assertEqual(self.client.post('/trash/task/t2/restore').status_code, 200)
        self.assertIn('t2', {t['id'] for t in self.client.get('/goals/g').json()['tasks']})

    def test_trashed_goal_hides_its_tasks_from_own_trash_list(self):
        # A goal in the trash shows under goals; its tasks are not listed separately.
        self.client.delete('/goals/g')
        self._trash_task('t2')
        trash = self.client.get('/trash').json()
        self.assertEqual({g['id'] for g in trash['goals']}, {'g'})
        self.assertEqual(trash['tasks'], [])   # t2's goal is trashed -> shown under the goal

    def test_purge_after_retention(self):
        self._trash_task('t2')
        with Session(self.engine) as db:
            db.get(Task, 't2').trashed_at = datetime.now(UTC) - timedelta(days=31)
            db.commit()
            self.assertEqual(purge_expired(db), 1)
            self.assertIsNone(db.get(Task, 't2'))     # permanently gone
            self.assertIsNotNone(db.get(Task, 't1'))  # kept

    def test_permanent_delete_from_trash(self):
        self._trash_task('t2')
        self.assertEqual(self.client.delete('/trash/task/t2').status_code, 204)
        with Session(self.engine) as db:
            self.assertIsNone(db.get(Task, 't2'))
        self.assertEqual(self.client.delete('/trash/task/t2').status_code, 404)  # already gone


if __name__ == '__main__':
    unittest.main()
