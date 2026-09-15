"""Reporting tests use an in-memory DB and never import app.main/start migrations."""
import unittest
from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # Register relationships, without starting the application.
from app.database import Base, get_db
from app.models.company import Company
from app.models.work_log import WorkLog
from app.models.work_session import WorkSession
from app.models.work_ticket import WorkTicket, WorkTimeEntry
from app.routes.work_reports import router
from app.routes.work_logs import router as logs_router


class WorkReportTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([Company(id='a', name='Alpha'), Company(id='b', name='Beta')])
            db.flush()
            db.add_all([
                WorkTicket(id='ticket', company_id='a', title='Feature', ticket_ref='DEV-1',
                           logged_seconds=999999, status='done'),
                WorkTicket(id='other', company_id='b', title='Other company'),
                WorkLog(id='log', company_id='a', title='Meeting', type='meeting',
                        duration_minutes=30, logged_at='2026-09-01'),
            ])
            db.flush()
            for id_, ticket, day, seconds, minutes in [
                ('before', 'ticket', '2026-08-31', 7200, 120),
                ('first', 'ticket', '2026-09-01', 3601, 60),
                ('last', 'ticket', '2026-09-30', 1800, 30),
                ('after', 'ticket', '2026-10-01', 9000, 150),
                ('legacy', 'ticket', '2026-09-07', 0, 5),
                ('beta', 'other', '2026-09-02', 600, 10),
            ]:
                db.add(WorkTimeEntry(id=id_, ticket_id=ticket, logged_at=day,
                                    duration_seconds=seconds, duration_minutes=minutes))
            db.add_all([
                WorkSession(id='duplicated-ticket-session', work_log_id='ticket:ticket',
                            started_at=datetime(2026, 9, 1), ended_at=datetime(2026, 9, 1, 1), duration_seconds=3601),
                WorkSession(id='duplicated-log-session', work_log_id='log',
                            started_at=datetime(2026, 9, 1), ended_at=datetime(2026, 9, 1, 0, 30), duration_seconds=1800),
                WorkSession(id='running', work_log_id='ticket:ticket', started_at=datetime(2026, 9, 3)),
            ])
            db.commit()
        # Fail any accidental INSERT/UPDATE/DELETE, including through existing stats.
        with self.engine.connect() as conn:
            conn.execute(text('PRAGMA query_only=ON'))
        app = FastAPI()
        app.include_router(router)
        app.include_router(logs_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        app.dependency_overrides[get_db] = test_db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def report(self, **params):
        return self.client.get('/work-reports', params={
            'date_from': '2026-09-01', 'date_to': '2026-09-30', **params,
        })

    def test_exact_totals_and_boundaries_without_double_counting(self):
        result = self.report(company_id='a')
        self.assertEqual(result.status_code, 200)
        data = result.json()
        self.assertEqual(data['total_seconds'], 7501)
        self.assertEqual({e['id'] for e in data['entries']}, {'first', 'last', 'legacy', 'log'})
        for breakdown in ('by_day', 'by_week', 'by_company'):
            self.assertEqual(sum(row['seconds'] for row in data[breakdown]), 7501)
        self.assertEqual(sum(data['by_type'].values()), 7501)
        self.assertEqual(data['by_week'][0]['date_from'], '2026-09-01')
        self.assertEqual(data['by_week'][-1]['date_to'], '2026-09-30')

    def test_company_filter(self):
        self.assertEqual(self.report().json()['total_seconds'], 8101)
        self.assertEqual(self.report(company_id='b').json()['total_seconds'], 600)
        self.assertEqual(self.report(company_id='missing').status_code, 404)

    def test_weekly_stats_include_ticket_time_and_match_report(self):
        data = self.report().json()
        stats = self.client.get('/work-logs/stats/weekly', params={
            'date_from': '2026-09-01', 'date_to': '2026-09-30',
        }).json()
        self.assertEqual(stats['total_minutes'], data['total_seconds'] // 60)
        self.assertEqual(stats['by_day'][0]['seconds'], 5401)
        self.assertEqual(sum(d['seconds'] for d in stats['by_day']), data['total_seconds'])

    def test_empty_period_and_leap_day(self):
        data = self.report(date_from='2024-02-01', date_to='2024-02-29').json()
        self.assertEqual(data['total_seconds'], 0)
        self.assertEqual(len(data['by_day']), 29)
        self.assertEqual(data['entries'], [])

    def test_date_validation(self):
        self.assertEqual(self.report(date_from='bad').status_code, 422)
        self.assertEqual(self.report(date_from='2026-10-01').status_code, 400)
        self.assertEqual(self.report(date_from='2024-01-01').status_code, 400)

    def test_reads_leave_legacy_records_unchanged(self):
        self.assertEqual(self.report().status_code, 200)
        with Session(self.engine) as db:
            self.assertEqual(db.get(WorkTimeEntry, 'legacy').duration_seconds, 0)
            self.assertEqual(db.get(WorkTicket, 'ticket').logged_seconds, 999999)
            self.assertEqual(db.get(WorkLog, 'log').duration_minutes, 30)
            self.assertIsNone(db.get(WorkSession, 'running').ended_at)
        self.assertEqual(self.client.post('/work-reports', json={}).status_code, 405)


if __name__ == '__main__':
    unittest.main()
