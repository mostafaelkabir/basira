"""Planning whiteboards. In-memory DB only; never imports app.main.

Proves: a board is created per scope with a sensible default title; /ensure is
idempotent per scope; the tldraw document round-trips and is counted; linked
cards get compact entity data with missing ids left out; the palette offers
the right candidates for a goal board and honours search; deletion works and
bad scopes are rejected.
"""
import unittest

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
from app.models.work_milestone import WorkMilestone
from app.models.work_ticket import WorkTicket
from app.routes.boards import router as boards_router


def shape(sid, typ="geo", **props):
    return {"id": f"shape:{sid}", "typeName": "shape", "type": typ, "x": 0, "y": 0, "props": props}


DOC = {
    "store": {
        "document:document": {"id": "document:document", "typeName": "document"},
        "page:page": {"id": "page:page", "typeName": "page", "name": "Page 1"},
        "shape:a": shape("a"),
        "shape:b": shape("b", "sysgo-card", entity="ticket", entityId="tk"),
    },
    "schema": {"schemaVersion": 2},
}


class BoardTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([
                Company(id='c', name='Acme', color='#123456'),
                Goal(id='g', title='Launch app', type='project'),
                Goal(id='g2', title='Read more', type='resolution'),
                Goal(id='sub', title='Beta', type='project', parent_id='g'),
            ])
            db.flush()
            db.add_all([
                Task(id='t1', goal_id='g', title='Write landing page', status='todo', sort_order=20),
                Task(id='t2', goal_id='g', title='Ship it', status='done', sort_order=10),
                Task(id='t3', goal_id='g2', title='Read 20 pages', status='todo'),
                Task(id='t4', goal_id='g2', title='Buy the book', status='todo', kind='task'),
                WorkTicket(id='tk', company_id='c', title='Fix login', status='in_progress',
                           priority='high', ticket_ref='ACME-1', linked_goal_id='g',
                           estimated_minutes=120, logged_minutes=30),
                WorkTicket(id='tk2', company_id='c', title='Write docs', status='done', milestone_id='m1', due_date='2026-11-04'),
                WorkMilestone(id='m1', company_id='c', title='Launch', due_date='2026-11-04'),
                WorkMilestone(id='m2', company_id='c', title='Beta', due_date='2026-10-25', status='done'),
            ])
            db.commit()
        api = FastAPI()
        api.include_router(boards_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        api.dependency_overrides[get_db] = test_db
        self.client = TestClient(api)

    # ── creation and scopes ───────────────────────────────────────────────────

    def test_create_titles_by_scope(self):
        goal = self.client.post('/boards', json={'scope_type': 'goal', 'scope_id': 'g'}).json()
        self.assertEqual((goal['title'], goal['scope_title'], goal['shape_count']), ('Launch app board', 'Launch app', 0))
        company = self.client.post('/boards', json={'scope_type': 'company', 'scope_id': 'c', 'title': '  Q4 plan '}).json()
        self.assertEqual((company['title'], company['scope_title']), ('Q4 plan', 'Acme'))
        work = self.client.post('/boards', json={'scope_type': 'work', 'scope_id': 'ignored'}).json()
        self.assertEqual((work['title'], work['scope_id']), ('Work board', None))
        self.assertEqual(self.client.post('/boards', json={'scope_type': 'global'}).json()['title'], 'Untitled board')
        self.assertEqual(len(self.client.get('/boards').json()), 4)
        self.assertEqual([b['id'] for b in self.client.get('/boards?scope_type=goal&scope_id=g').json()], [goal['id']])

    def test_rejects_bad_scopes(self):
        self.assertEqual(self.client.post('/boards', json={'scope_type': 'sprint'}).status_code, 400)
        self.assertEqual(self.client.post('/boards', json={'scope_type': 'goal'}).status_code, 400)
        self.assertEqual(self.client.post('/boards', json={'scope_type': 'goal', 'scope_id': 'nope'}).status_code, 404)
        self.assertEqual(self.client.post('/boards/ensure', json={'scope_type': 'company', 'scope_id': 'nope'}).status_code, 404)
        self.assertEqual(self.client.get('/boards/missing').status_code, 404)

    def test_ensure_is_idempotent_per_scope(self):
        first = self.client.post('/boards/ensure', json={'scope_type': 'goal', 'scope_id': 'g'}).json()
        again = self.client.post('/boards/ensure', json={'scope_type': 'goal', 'scope_id': 'g'}).json()
        other = self.client.post('/boards/ensure', json={'scope_type': 'goal', 'scope_id': 'g2'}).json()
        work = self.client.post('/boards/ensure', json={'scope_type': 'work'}).json()
        work_again = self.client.post('/boards/ensure', json={'scope_type': 'work'}).json()
        self.assertEqual(first['id'], again['id'])
        self.assertNotEqual(first['id'], other['id'])
        self.assertEqual(work['id'], work_again['id'])
        self.assertEqual(len(self.client.get('/boards').json()), 3)

    # ── document persistence ──────────────────────────────────────────────────

    def test_document_round_trips_and_counts_shapes(self):
        b = self.client.post('/boards', json={'scope_type': 'global', 'title': 'Roadmap'}).json()
        before = b['updated_at']
        res = self.client.put(f"/boards/{b['id']}/document", json={'document': DOC})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['shape_count'], 2)
        full = self.client.get(f"/boards/{b['id']}").json()
        self.assertEqual(full['document'], DOC)
        self.assertEqual(full['shape_count'], 2)
        self.assertGreaterEqual(full['updated_at'], before)
        self.assertEqual(self.client.get('/boards').json()[0]['shape_count'], 2)

    def test_rename_and_delete(self):
        b = self.client.post('/boards', json={'scope_type': 'global'}).json()
        self.assertEqual(self.client.patch(f"/boards/{b['id']}", json={'title': 'Sprint 12'}).json()['title'], 'Sprint 12')
        self.assertEqual(self.client.patch(f"/boards/{b['id']}", json={'title': '  '}).status_code, 400)
        self.assertEqual(self.client.delete(f"/boards/{b['id']}").status_code, 204)
        self.assertEqual(self.client.get(f"/boards/{b['id']}").status_code, 404)
        self.assertEqual(self.client.get('/boards').json(), [])

    # ── linked card data ──────────────────────────────────────────────────────

    def test_entities_are_compact_and_skip_missing(self):
        res = self.client.get('/boards/entities?tickets=tk,gone&tasks=t1,t3&goals=g')
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(set(data['tickets']), {'tk'})
        tk = data['tickets']['tk']
        self.assertEqual((tk['title'], tk['status'], tk['company_name'], tk['company_color'], tk['ticket_ref']),
                         ('Fix login', 'in_progress', 'Acme', '#123456', 'ACME-1'))
        self.assertEqual((tk['estimated_minutes'], tk['logged_minutes']), (120, 30))
        self.assertEqual(data['tasks']['t1']['goal_title'], 'Launch app')
        self.assertFalse(data['tasks']['t1']['is_habit'])
        self.assertTrue(data['tasks']['t3']['is_habit'])
        self.assertEqual((data['goals']['g']['task_count'], data['goals']['g']['done_count']), (2, 1))
        self.assertEqual(self.client.get('/boards/entities').json(), {'tickets': {}, 'tasks': {}, 'goals': {}, 'milestones': {}})
        res = self.client.get('/boards/entities?tickets=tk2&milestones=m1,m2,gone').json()
        self.assertEqual((res['tickets']['tk2']['due_date'], res['tickets']['tk2']['milestone_title']), ('2026-11-04', 'Launch'))
        self.assertEqual(set(res['milestones']), {'m1', 'm2'})
        self.assertEqual((res['milestones']['m1']['ticket_count'], res['milestones']['m1']['done_count'], res['milestones']['m1']['status']), (1, 1, 'open'))

    # ── palette candidates ────────────────────────────────────────────────────

    def test_goal_board_candidates(self):
        b = self.client.post('/boards/ensure', json={'scope_type': 'goal', 'scope_id': 'g'}).json()
        data = self.client.get(f"/boards/{b['id']}/candidates").json()
        self.assertEqual([t['id'] for t in data['tasks']], ['t1', 't2'])      # open first, then done
        self.assertEqual([t['id'] for t in data['tickets']], ['tk'])         # linked ticket only
        self.assertEqual([g['id'] for g in data['goals']], ['sub'])          # sub-goal only
        filtered = self.client.get(f"/boards/{b['id']}/candidates?q=ship").json()
        self.assertEqual(([t['id'] for t in filtered['tasks']], filtered['tickets']), (['t2'], []))

    def test_company_work_and_global_candidates(self):
        company = self.client.post('/boards/ensure', json={'scope_type': 'company', 'scope_id': 'c'}).json()
        data = self.client.get(f"/boards/{company['id']}/candidates").json()
        self.assertEqual([t['id'] for t in data['tickets']], ['tk', 'tk2'])   # done last
        self.assertEqual(([g['id'] for g in data['goals']], data['tasks']), (['g'], []))
        self.assertEqual([m['id'] for m in data['milestones']], ['m1', 'm2'])   # open first
        work = self.client.post('/boards/ensure', json={'scope_type': 'work'}).json()
        self.assertEqual(len(self.client.get(f"/boards/{work['id']}/candidates").json()['tickets']), 2)
        glob = self.client.post('/boards', json={'scope_type': 'global'}).json()
        data = self.client.get(f"/boards/{glob['id']}/candidates").json()
        self.assertEqual({t['id'] for t in data['tasks']}, {'t1', 't3', 't4'})   # open top-level tasks only
        self.assertEqual({g['id'] for g in data['goals']}, {'g', 'g2', 'sub'})


if __name__ == '__main__':
    unittest.main()
