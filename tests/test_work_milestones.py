"""Milestones and ticket due dates. In-memory DB only; never imports app.main.

Proves: milestones are created per client with validated dates; listing rolls up
ticket counts and progress; tickets take a due date and a milestone and can clear
both with ""; deleting a milestone unlinks its tickets; bad input is rejected.
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
from app.models.company import Company
from app.models.work_ticket import WorkTicket
from app.routes.work_milestones import router as milestones_router
from app.routes.work_tickets import router as tickets_router


def day(n):
    return (date.today() + timedelta(days=n)).isoformat()


class MilestoneTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([Company(id='c', name='BasiraVision', color='#123456'), Company(id='c2', name='Other')])
            db.flush()
            db.add_all([
                WorkTicket(id='t1', company_id='c', title='Export footage', status='todo'),
                WorkTicket(id='t2', company_id='c', title='Write report', status='done'),
                WorkTicket(id='t3', company_id='c', title='Call buyer', status='todo'),
            ])
            db.commit()
        api = FastAPI()
        api.include_router(milestones_router)
        api.include_router(tickets_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        api.dependency_overrides[get_db] = test_db
        self.client = TestClient(api)

    def create(self, **body):
        return self.client.post('/work-milestones', json={'company_id': 'c', 'title': 'Demo day', **body})

    def test_create_list_and_progress(self):
        m = self.create(due_date=day(5)).json()
        self.assertEqual((m['title'], m['status'], m['days_left'], m['overdue'], m['company_name']), ('Demo day', 'open', 5, False, 'BasiraVision'))
        for tid in ('t1', 't2'):
            self.assertEqual(self.client.put(f'/work-tickets/{tid}', json={'milestone_id': m['id']}).status_code, 200)
        listed = self.client.get('/work-milestones?company_id=c').json()
        self.assertEqual(len(listed), 1)
        self.assertEqual((listed[0]['ticket_count'], listed[0]['done_count'], listed[0]['progress_pct']), (2, 1, 50))
        self.assertEqual(self.client.get('/work-milestones?company_id=c2').json(), [])
        detail = self.client.get(f"/work-milestones/{m['id']}").json()
        self.assertEqual({t['id'] for t in detail['tickets']}, {'t1', 't2'})
        tickets = self.client.get(f"/work-tickets?milestone_id={m['id']}").json()
        self.assertEqual({t['id'] for t in tickets}, {'t1', 't2'})
        self.assertEqual(tickets[0]['milestone_title'], 'Demo day')

    def test_ordering_overdue_and_done(self):
        late = self.create(title='Late', due_date=day(-2)).json()
        soon = self.create(title='Soon', due_date=day(1)).json()
        undated = self.create(title='Someday').json()
        finished = self.create(title='Finished', due_date=day(-10), status='done').json()
        order = [m['title'] for m in self.client.get('/work-milestones').json()]
        self.assertEqual(order, ['Late', 'Soon', 'Someday', 'Finished'])
        self.assertTrue(late['overdue'])
        self.assertFalse(finished['overdue'])
        self.assertIsNone(undated['days_left'])
        self.assertIsNotNone(finished['completed_at'])
        done = self.client.put(f"/work-milestones/{soon['id']}", json={'status': 'done'}).json()
        self.assertEqual(done['status'], 'done')
        self.assertIsNotNone(done['completed_at'])
        reopened = self.client.put(f"/work-milestones/{soon['id']}", json={'status': 'open', 'due_date': ''}).json()
        self.assertEqual((reopened['status'], reopened['due_date'], reopened['completed_at']), ('open', None, None))

    def test_ticket_due_date_round_trip_and_clearing(self):
        m = self.create().json()
        t = self.client.post('/work-tickets', json={'company_id': 'c', 'title': 'Ship', 'due_date': day(3), 'milestone_id': m['id']}).json()
        self.assertEqual((t['due_date'], t['milestone_id'], t['milestone_title']), (day(3), m['id'], 'Demo day'))
        t = self.client.put(f"/work-tickets/{t['id']}", json={'due_date': '', 'milestone_id': ''}).json()
        self.assertEqual((t['due_date'], t['milestone_id'], t['milestone_title']), (None, None, ''))

    def test_delete_unlinks_tickets(self):
        m = self.create().json()
        self.client.put('/work-tickets/t3', json={'milestone_id': m['id']})
        self.assertEqual(self.client.delete(f"/work-milestones/{m['id']}").status_code, 204)
        self.assertEqual(self.client.get('/work-milestones').json(), [])
        self.assertIsNone(self.client.get('/work-tickets/t3').json()['milestone_id'])

    def test_ticket_links_are_validated(self):
        other = self.client.post('/work-milestones', json={'company_id': 'c2', 'title': 'Elsewhere'}).json()
        self.assertEqual(self.client.put('/work-tickets/t1', json={'due_date': 'tomorrow'}).status_code, 400)
        self.assertEqual(self.client.put('/work-tickets/t1', json={'milestone_id': 'nope'}).status_code, 404)
        self.assertEqual(self.client.put('/work-tickets/t1', json={'milestone_id': other['id']}).status_code, 400)
        self.assertEqual(self.client.post('/work-tickets', json={'company_id': 'c', 'title': 'x', 'due_date': '2026-13-40'}).status_code, 400)
        self.assertIsNone(self.client.get('/work-tickets/t1').json()['due_date'])

    def test_validation(self):
        self.assertEqual(self.create(due_date='next tuesday').status_code, 400)
        self.assertEqual(self.create(title='   ').status_code, 400)
        self.assertEqual(self.create(status='maybe').status_code, 400)
        self.assertEqual(self.client.post('/work-milestones', json={'company_id': 'nope', 'title': 'x'}).status_code, 404)
        self.assertEqual(self.client.get('/work-milestones/missing').status_code, 404)


if __name__ == '__main__':
    unittest.main()
