"""Ticket evidence survives closing the drawer. In-memory DB only; never imports app.main.

Proves: a proof link posted to a ticket's feed comes back on GET /work-tickets/{id}
both as a feed comment and in the ticket's own evidence list; links set on the
ticket itself are returned too; deleting the proof comment removes the link from
the evidence list, but not while another proof comment still points at it.
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
from app.routes.work_tickets import router as tickets_router


class TicketEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add(Company(id='c', name='Client'))
            db.commit()
        api = FastAPI()
        api.include_router(tickets_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        api.dependency_overrides[get_db] = test_db
        self.client = TestClient(api)
        self.ticket = self.client.post('/work-tickets', json={
            'company_id': 'c', 'title': 'Ship report',
            'proofs': [{'url': 'https://example.com/pr/1', 'label': 'PR'}],
        }).json()

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def _get(self):
        return self.client.get(f"/work-tickets/{self.ticket['id']}").json()

    def test_evidence_set_on_the_ticket_comes_back(self):
        self.assertEqual([p['url'] for p in self._get()['proofs']], ['https://example.com/pr/1'])

    def test_proof_posted_to_the_feed_is_there_after_reopening(self):
        r = self.client.post(f"/work-tickets/{self.ticket['id']}/comments",
                             json={'body': 'https://example.com/screenshot.png', 'type': 'proof'})
        self.assertEqual(r.status_code, 200)

        fresh = self._get()
        self.assertEqual([c['body'] for c in fresh['comments'] if c['type'] == 'proof'],
                         ['https://example.com/screenshot.png'])
        self.assertEqual([p['url'] for p in fresh['proofs']],
                         ['https://example.com/pr/1', 'https://example.com/screenshot.png'])

    def test_deleting_the_proof_comment_removes_it_from_the_evidence_list(self):
        posted = self.client.post(f"/work-tickets/{self.ticket['id']}/comments",
                                  json={'body': 'https://example.com/shot.png', 'type': 'proof'}).json()
        cid = next(c['id'] for c in posted['comments'] if c['type'] == 'proof')

        r = self.client.delete(f"/work-tickets/{self.ticket['id']}/comments/{cid}")
        self.assertEqual(r.status_code, 204)
        fresh = self._get()
        self.assertEqual([c['id'] for c in fresh['comments']], [])
        self.assertEqual([p['url'] for p in fresh['proofs']], ['https://example.com/pr/1'],
                         'the ticket-level link set by hand stays; only the deleted proof goes')

    def test_deleting_one_of_two_identical_proof_comments_keeps_the_link(self):
        url = 'https://example.com/same.png'
        self.client.post(f"/work-tickets/{self.ticket['id']}/comments", json={'body': url, 'type': 'proof'})
        posted = self.client.post(f"/work-tickets/{self.ticket['id']}/comments", json={'body': url, 'type': 'proof'}).json()
        cid = next(c['id'] for c in posted['comments'] if c['type'] == 'proof')

        self.client.delete(f"/work-tickets/{self.ticket['id']}/comments/{cid}")
        fresh = self._get()
        self.assertEqual(len([c for c in fresh['comments'] if c['type'] == 'proof']), 1)
        self.assertIn(url, [p['url'] for p in fresh['proofs']])

    def test_deleting_a_plain_note_leaves_evidence_alone(self):
        posted = self.client.post(f"/work-tickets/{self.ticket['id']}/comments",
                                  json={'body': 'Talked to the client', 'type': 'note'}).json()
        cid = posted['comments'][0]['id']
        self.client.delete(f"/work-tickets/{self.ticket['id']}/comments/{cid}")
        self.assertEqual([p['url'] for p in self._get()['proofs']], ['https://example.com/pr/1'])


if __name__ == '__main__':
    unittest.main()
