"""Undo a completion. In-memory DB only; never imports app.main.

Proves: POST /tasks/{id}/reopen puts a done task back to todo, drops only the
completion it recorded (earlier completions and other tasks' logs stay), keeps
the evidence attached, is a harmless no-op on a task that is not done, and 404s
on an unknown task.
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
from app.models.execution_log import ExecutionLog
from app.models.goal import Goal
from app.models.proof import Proof
from app.models.task import Task
from app.routes.tasks import router as tasks_router


class ReopenTaskTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add(Goal(id='g', title='Home', type='project'))
            db.flush()
            db.add_all([
                Task(id='car', goal_id='g', title='Clean my car', status='todo', requires_proof=False),
                Task(id='other', goal_id='g', title='Other', status='done'),
            ])
            db.add(ExecutionLog(id='other-log', task_id='other', completed_at=datetime.now(UTC)))
            db.commit()
        api = FastAPI()
        api.include_router(tasks_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        api.dependency_overrides[get_db] = test_db
        self.client = TestClient(api)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def _logs(self, task_id):
        with Session(self.engine) as db:
            return db.query(ExecutionLog).filter(ExecutionLog.task_id == task_id).count()

    def test_reopen_undoes_a_mistaken_completion(self):
        self.assertEqual(self.client.post('/tasks/car/complete').status_code, 200)
        self.assertEqual(self._logs('car'), 1)

        r = self.client.post('/tasks/car/reopen')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['status'], 'todo')
        self.assertEqual(self._logs('car'), 0, 'the mistaken completion must not count')
        self.assertEqual(self._logs('other'), 1, 'other tasks keep their history')

    def test_reopen_drops_only_the_latest_completion(self):
        with Session(self.engine) as db:
            db.add(ExecutionLog(id='old', task_id='car', completed_at=datetime.now(UTC) - timedelta(days=3)))
            db.commit()
        self.client.post('/tasks/car/complete')
        self.assertEqual(self._logs('car'), 2)

        self.client.post('/tasks/car/reopen')
        with Session(self.engine) as db:
            remaining = [l.id for l in db.query(ExecutionLog).filter(ExecutionLog.task_id == 'car')]
        self.assertEqual(remaining, ['old'])

    def test_reopen_keeps_the_evidence(self):
        with Session(self.engine) as db:
            db.add(Proof(id='p1', task_id='car', type='text', content='Washed and vacuumed', date='2026-10-27'))
            db.commit()
        self.client.post('/tasks/car/complete')
        self.client.post('/tasks/car/reopen')

        task = self.client.get('/tasks/car').json()
        self.assertEqual(task['status'], 'todo')
        self.assertEqual([p['content'] for p in task['proofs']], ['Washed and vacuumed'])

    def test_reopen_on_a_todo_task_changes_nothing(self):
        r = self.client.post('/tasks/car/reopen')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['status'], 'todo')
        self.assertEqual(self._logs('car'), 0)

    def test_reopen_unknown_task_is_404(self):
        self.assertEqual(self.client.post('/tasks/nope/reopen').status_code, 404)


if __name__ == '__main__':
    unittest.main()
