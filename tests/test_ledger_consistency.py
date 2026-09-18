"""Step 6 regression guard: the new day-workspace read model and the existing
work-reports ledger must agree on work time for the same data, and neither may
double-count a saved ticket session's two representations.
"""
import unittest
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base
from app.models.company import Company
from app.models.goal import Goal
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_session import WorkSession
from app.models.work_ticket import WorkTicket, WorkTimeEntry
from app.services.day_workspace import build_day_workspace
from app.services.work_reports import summarize_work, work_entries

DAY = date(2026, 9, 18)
DAY_ISO = DAY.isoformat()


class LedgerConsistencyTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([Company(id='c', name='Client'), Goal(id='g', title='G', type='project')])
            db.flush()
            db.add_all([
                Task(id='t', goal_id='g', title='Task'),
                WorkTicket(id='tk', company_id='c', linked_goal_id='g', title='Ticket'),
                WorkLog(id='wl', company_id='c', title='Log', duration_minutes=25, logged_at=DAY_ISO),
            ])
            db.flush()
            db.add_all([
                WorkTimeEntry(id='e1', ticket_id='tk', logged_at=DAY_ISO,
                              duration_seconds=1800, duration_minutes=30),
                WorkTimeEntry(id='e2', ticket_id='tk', logged_at=DAY_ISO,
                              duration_seconds=900, duration_minutes=15),
                # Duplicated stopped session for the same ticket time — must be ignored
                # by BOTH read models.
                WorkSession(id='dup', work_log_id='ticket:tk',
                            started_at=datetime(2026, 9, 18, 10), ended_at=datetime(2026, 9, 18, 10, 45),
                            duration_seconds=2700),
                # A task session (day-workspace personal time; not in work-reports).
                WorkSession(id='task-s', task_id='t',
                            started_at=datetime(2026, 9, 18, 14), ended_at=datetime(2026, 9, 18, 15),
                            duration_seconds=3600),
                # A still-running ticket timer — excluded from both saved totals.
                WorkSession(id='run', work_log_id='ticket:tk', started_at=datetime(2026, 9, 18, 20)),
            ])
            db.commit()

    def tearDown(self):
        self.engine.dispose()

    def test_work_ledger_agrees_between_models(self):
        with Session(self.engine) as db:
            ws = build_day_workspace(db, DAY, ZoneInfo('UTC'), datetime(2026, 9, 18, 21, tzinfo=UTC))
            report = summarize_work(work_entries(db, DAY_ISO, DAY_ISO), DAY, DAY)

        # Work-reports total for the day: ticket 1800+900 + worklog 25m = 2700 + 1500.
        self.assertEqual(report['total_seconds'], 1800 + 900 + 1500)

        # Day-workspace recorded WORK sources (ticket + worklog) must equal it exactly.
        work_recorded = sum(e['seconds'] for e in ws['recorded'] if e['source'] in ('ticket', 'worklog'))
        self.assertEqual(work_recorded, report['total_seconds'])

        # The duplicated ticket session inflates neither model.
        self.assertEqual(ws['totals']['recorded_seconds'], report['total_seconds'] + 3600)  # + task time
        # The running ticket timer is live-only in the workspace, absent from reports.
        self.assertEqual(ws['totals']['live_seconds'], 3600)  # 20:00 -> 21:00
        self.assertTrue(all(e['source'] != 'task' for e in report['entries']))


if __name__ == '__main__':
    unittest.main()
