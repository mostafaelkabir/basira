"""One-off tasks under habits/resolutions. In-memory DB; proves a sub-task of a habit
and a kind='task' row under a resolution are ordinary to-dos: not habits in the
routine strip, weekly review or schedule, but plannable in morning suggestions.
"""
import unittest
from datetime import date

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.goal import Goal
from app.models.task import Task, habit_row_filter, is_habit
from app.routes.schedule import router as schedule_router
from app.routes.tasks import router as tasks_router
from app.services.day_workspace import _agenda, _routines
from app.services.morning_planner import morning_suggestions
from app.services.work_suggestions import suggest_work

TODAY = date.today()


class HabitTaskTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add(Goal(id='r', title='Read more', type='resolution'))
            db.flush()
            db.add(Task(id='habit', goal_id='r', title='Read 5 pages', habit_frequency='daily'))
            db.flush()
            db.add_all([
                Task(id='sub', goal_id='r', title='Buy Atomic Habits', parent_task_id='habit', kind='task',
                     due_date=TODAY.isoformat()),
                Task(id='oneoff', goal_id='r', title='Set up a reading corner', kind='task',
                     due_date=TODAY.isoformat()),
            ])
            db.commit()
        api = FastAPI()
        api.include_router(tasks_router)
        api.include_router(schedule_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        api.dependency_overrides[get_db] = test_db
        self.client = TestClient(api)

    def test_predicate(self):
        with Session(self.engine) as db:
            rows = {t.id: t for t in db.query(Task).all()}
            self.assertTrue(is_habit(rows['habit'], 'resolution'))
            self.assertFalse(is_habit(rows['sub'], 'resolution'))
            self.assertFalse(is_habit(rows['oneoff'], 'resolution'))
            self.assertFalse(is_habit(rows['habit'], 'project'))
            ids = {t.id for t in db.query(Task).filter(habit_row_filter()).all()}
            self.assertEqual(ids, {'habit'})

    def test_routine_strip_lists_only_the_habit(self):
        with Session(self.engine) as db:
            buckets = _routines(db, TODAY)
        ids = [h['id'] for items in buckets.values() for h in items]
        self.assertEqual(ids, ['habit'])

    def test_one_off_is_suggested_for_planning_but_habit_is_not(self):
        with Session(self.engine) as db:
            groups = morning_suggestions(db, TODAY)['groups']
        ids = {s['item_id'] for g in groups for s in g['items']}
        self.assertIn('oneoff', ids)
        self.assertNotIn('habit', ids)

    def test_habit_sub_task_is_findable_and_labelled_with_its_habit(self):
        with Session(self.engine) as db:
            found = {s['item_id']: s['project_title'] for s in suggest_work(db, 'atomic')['suggestions']}
            planner = {s['item_id']: s['project_title'] for g in morning_suggestions(db, TODAY)['groups'] for s in g['items']}
        self.assertEqual(found, {'sub': 'Read more · Read 5 pages'})
        self.assertEqual(planner.get('sub'), 'Read more · Read 5 pages')

    def test_planned_one_offs_show_as_tasks_not_habits(self):
        for kind, item_id in (('task', 'oneoff'), ('task', 'sub'), ('habit', 'habit')):
            self.assertEqual(self.client.post('/today/schedule/add', json={'kind': kind, 'id': item_id}).status_code, 200)
        items = {i['id']: i['kind'] for i in self.client.get('/today/schedule').json()}
        self.assertEqual(items, {'oneoff': 'task', 'sub': 'task', 'habit': 'habit'})
        with Session(self.engine) as db:
            agenda, unscheduled, _ = _agenda(db, TODAY, {}, {})
        self.assertIn('task:sub', {i['key'] for i in agenda + unscheduled})

    def test_create_keeps_kind_and_frequency(self):
        r = self.client.post('/tasks', json={'title': 'Join a book club', 'goal_id': 'r', 'kind': 'task'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['kind'], 'task')
        r = self.client.post('/tasks', json={'title': 'Stretch', 'goal_id': 'r', 'habit_frequency': '3x_week'})
        self.assertEqual(r.json()['habit_frequency'], '3x_week')
        self.assertIsNone(r.json()['kind'])


if __name__ == '__main__':
    unittest.main()
