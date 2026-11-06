"""Double-submitted ticket creates. In-memory DB only; never imports app.main.

Proves: POST /work-tickets with the same client and title within a minute hands
back the ticket that already exists (200) instead of a copy (201); spacing,
case and whitespace do not matter; a different title, a different client, or
the same title a few minutes later is a new ticket.
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
from app.models.work_ticket import WorkTicket
from app.routes.work_tickets import router as tickets_router


class TicketCreateDedupeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([Company(id='c', name='Client'), Company(id='d', name='Other client')])
            db.commit()
        api = FastAPI()
        api.include_router(tickets_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        api.dependency_overrides[get_db] = test_db
        self.client = TestClient(api)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def create(self, title, company='c'):
        return self.client.post('/work-tickets', json={'company_id': company, 'title': title})

    def titles(self, company='c'):
        return [t['title'] for t in self.client.get(f'/work-tickets?company_id={company}').json()]

    def test_second_identical_create_returns_the_first_ticket(self):
        first = self.create('Label dataset round 1')
        second = self.create('Label dataset round 1')
        self.assertEqual((first.status_code, second.status_code), (201, 200))
        self.assertEqual(first.json()['id'], second.json()['id'])
        self.assertEqual(self.titles(), ['Label dataset round 1'])

    def test_case_and_spacing_do_not_make_it_a_new_ticket(self):
        first = self.create('Label dataset round 1')
        again = self.create('  label   DATASET round 1 ')
        self.assertEqual(first.json()['id'], again.json()['id'])
        self.assertEqual(len(self.titles()), 1)

    def test_different_title_or_client_is_a_new_ticket(self):
        self.create('Label dataset round 1')
        self.assertEqual(self.create('Label dataset round 2').status_code, 201)
        self.assertEqual(self.create('Label dataset round 1', company='d').status_code, 201)
        self.assertEqual(sorted(self.titles()), ['Label dataset round 1', 'Label dataset round 2'])
        self.assertEqual(self.titles('d'), ['Label dataset round 1'])

    def test_same_title_minutes_later_is_deliberate(self):
        first = self.create('Standup notes').json()
        with Session(self.engine) as db:
            db.get(WorkTicket, first['id']).created_at = datetime.now(UTC) - timedelta(minutes=5)
            db.commit()
        later = self.create('Standup notes')
        self.assertEqual(later.status_code, 201)
        self.assertNotEqual(later.json()['id'], first['id'])
        self.assertEqual(len(self.titles()), 2)


if __name__ == '__main__':
    unittest.main()
