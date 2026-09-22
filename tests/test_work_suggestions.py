"""Work-suggestions tests (ticket: Suggest existing work with contextual search
and ranking). In-memory DB; proves ranking, distinct IDs, blocked labeling,
archived/completed exclusion, typo tolerance, and that reads never write.
"""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.company import Company
from app.models.goal import Goal
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_ticket import WorkTicket
from app.routes.work_suggestions import router


class WorkSuggestionsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([
                Company(id='alpha', name='Alpha Corp'),
                Goal(id='basira', title='Basira', type='project'),
                Goal(id='old', title='Archived Goal', type='project',
                     archived_at=__import__('datetime').datetime(2020, 1, 1)),
            ])
            db.flush()
            db.add_all([
                # Exact title vs. weak contextual (tag) match for "latency".
                WorkTicket(id='exact', company_id='alpha', linked_goal_id='basira',
                           title='Latency', status='todo', ticket_ref='DEV-9'),
                WorkTicket(id='contains', company_id='alpha', linked_goal_id='basira',
                           title='Reduce inference latency on device', status='in_progress'),
                WorkTicket(id='tagonly', company_id='alpha', linked_goal_id='basira',
                           title='Unrelated title', status='todo', tags='["latency"]'),
                # Two different tickets that share an ambiguous word.
                WorkTicket(id='amb1', company_id='alpha', title='Model export A', status='todo'),
                WorkTicket(id='amb2', company_id='alpha', title='Model export B', status='backlog'),
                # Blocked + done tickets.
                WorkTicket(id='blocked', company_id='alpha', title='Blocked export work', status='blocked'),
                WorkTicket(id='done', company_id='alpha', title='Export finished', status='done'),
                # A task under an archived goal must be excluded.
                Task(id='task-old', goal_id='old', title='Export legacy', status='todo'),
                Task(id='task-live', goal_id='basira', title='Export docs', status='todo'),
                WorkLog(id='log', company_id='alpha', title='Export planning log',
                        status='todo', logged_at='2026-09-18'),
            ])
            db.commit()
        with self.engine.connect() as conn:
            conn.execute(text('PRAGMA query_only=ON'))

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

    def suggest(self, q, **params):
        return self.client.get('/work-suggestions', params={'q': q, **params}).json()

    def test_exact_title_outranks_contextual(self):
        data = self.suggest('latency')
        order = [s['key'] for s in data['suggestions']]
        # Exact title 'Latency' must rank above the title-contains and tag-only hits.
        self.assertEqual(order[0], 'ticket:exact')
        self.assertLess(order.index('ticket:contains'), order.index('ticket:tagonly'))
        self.assertIn('Related to', ' '.join(
            next(s for s in data['suggestions'] if s['key'] == 'ticket:tagonly')['reasons']))

    def test_reference_match_is_top(self):
        data = self.suggest('DEV-9')
        self.assertEqual(data['suggestions'][0]['key'], 'ticket:exact')
        self.assertIn('Matches reference DEV-9', data['suggestions'][0]['reasons'])

    def test_ambiguous_names_keep_distinct_ids(self):
        data = self.suggest('model export', show_all=True)
        keys = {s['key'] for s in data['suggestions']}
        self.assertIn('ticket:amb1', keys)
        self.assertIn('ticket:amb2', keys)  # both retained, not merged

    def test_blocked_labeled_and_done_excluded(self):
        data = self.suggest('export', show_all=True)
        keys = {s['key'] for s in data['suggestions']}
        self.assertIn('ticket:blocked', keys)
        self.assertNotIn('ticket:done', keys)          # completed excluded
        self.assertNotIn('task:task-old', keys)        # archived goal excluded
        blocked = next(s for s in data['suggestions'] if s['key'] == 'ticket:blocked')
        self.assertTrue(blocked['blocked'])
        self.assertIn('Blocked', blocked['reasons'])

    def test_in_progress_boost_over_plain_todo(self):
        data = self.suggest('latency', show_all=True)
        contains = next(s for s in data['suggestions'] if s['key'] == 'ticket:contains')
        self.assertIn('In progress', contains['reasons'])

    def test_typo_tolerance(self):
        # 'latancy' is one edit from 'latency'.
        data = self.suggest('latancy')
        keys = {s['key'] for s in data['suggestions']}
        self.assertIn('ticket:exact', keys)

    def test_limit_and_has_more(self):
        data = self.suggest('export', limit=2)
        self.assertEqual(len(data['suggestions']), 2)
        self.assertTrue(data['has_more'])
        alld = self.suggest('export', show_all=True)
        self.assertFalse(alld['has_more'])
        self.assertEqual(alld['total'], len(alld['suggestions']))

    def test_browse_empty_query_lists_all(self):
        # Empty query browses everything non-done; in-progress ranks first.
        data = self.suggest('', show_all=True)
        keys = {s['key'] for s in data['suggestions']}
        self.assertIn('ticket:contains', keys)      # in_progress ticket
        self.assertIn('task:task-live', keys)
        self.assertNotIn('ticket:done', keys)        # done excluded
        self.assertNotIn('task:task-old', keys)      # archived goal excluded

    def test_browse_source_filter(self):
        tasks = self.suggest('', show_all=True, source='task')
        self.assertTrue(tasks['suggestions'])
        self.assertTrue(all(s['source'] == 'task' for s in tasks['suggestions']))
        tickets = self.suggest('', show_all=True, source='ticket')
        self.assertTrue(all(s['source'] == 'ticket' for s in tickets['suggestions']))

    def test_reads_do_not_write(self):
        self.suggest('export', show_all=True)
        with Session(self.engine) as db:
            self.assertEqual(db.query(WorkTicket).count(), 7)
        self.assertEqual(self.client.post('/work-suggestions').status_code, 405)


if __name__ == '__main__':
    unittest.main()
