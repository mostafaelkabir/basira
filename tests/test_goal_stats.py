"""Goal stats tests. In-memory DB; proves goal/habit streak rules (alive until
today ends, per-day targets, weekly habits streak in weeks), 30-day consistency,
one-offs staying out of habits, and that GET /goals/{id}/stats is write-free.
"""
import unittest
from datetime import UTC, date, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.execution_log import ExecutionLog
from app.models.goal import Goal
from app.models.habit_log import HabitLog
from app.models.task import Task
from app.routes.goals import router
from app.services.goal_stats import goal_stats

DAY = date(2026, 10, 10)  # a Saturday


def ago(n):
    return (DAY - timedelta(days=n)).isoformat()


class GoalStatsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add(Goal(id='r', title='Fit', type='resolution', created_at=datetime(2026, 8, 1, tzinfo=UTC)))
            db.flush()
            db.add_all([
                Task(id='push', goal_id='r', title='Pushups', habit_frequency='daily', created_at=ago(60)),
                Task(id='water', goal_id='r', title='Water', habit_frequency='2x_day', created_at=ago(60)),
                Task(id='run', goal_id='r', title='Run', habit_frequency='2x_week', created_at=ago(60)),
                Task(id='shoes', goal_id='r', title='Buy shoes', kind='task', created_at=ago(60)),
            ])
            logs = []
            # Pushups: a 5-day run 20..16 days ago, then yesterday + the day before (not yet today).
            for n in [20, 19, 18, 17, 16, 2, 1]:
                logs.append(HabitLog(id=f'p{n}', task_id='push', date=ago(n), count=1))
            # Water: target 2/day — only full days count toward its streak.
            logs += [HabitLog(id='w0', task_id='water', date=ago(0), count=2),
                     HabitLog(id='w1', task_id='water', date=ago(1), count=1)]
            # Run: 2 days in each of the last two full weeks, 1 so far this week.
            for n in [8, 10, 13, 15, 0]:
                logs.append(HabitLog(id=f'r{n}', task_id='run', date=ago(n), count=1))
            db.add_all(logs)
            db.add(ExecutionLog(id='e1', task_id='shoes',
                                completed_at=datetime.combine(date.fromisoformat(ago(5)), datetime.min.time()).replace(hour=12)))
            db.commit()

    def stats(self):
        with Session(self.engine) as db:
            return goal_stats(db, db.get(Goal, 'r'), today=DAY)

    def habit(self, s, hid):
        return next(h for h in s['habits'] if h['id'] == hid)

    def test_daily_streak_alive_until_today_ends(self):
        p = self.habit(self.stats(), 'push')
        self.assertFalse(p['done_now'])
        self.assertEqual(p['current_streak'], 2)  # yesterday + day before still count
        self.assertEqual(p['best_streak'], 5)
        self.assertEqual((p['best_start'], p['best_end']), (ago(20), ago(16)))

    def test_per_day_target(self):
        w = self.habit(self.stats(), 'water')
        self.assertEqual(w['current_streak'], 1)  # yesterday had 1 of 2
        self.assertTrue(w['done_now'])

    def test_weekly_habit_streaks_in_weeks(self):
        r = self.habit(self.stats(), 'run')
        self.assertEqual(r['unit'], 'week')
        self.assertFalse(r['done_now'])           # 1 of 2 this week
        self.assertEqual(r['current_streak'], 2)  # last two full weeks met
        self.assertEqual(r['best_streak'], 2)

    def test_one_offs_are_not_habits_but_count_as_activity(self):
        s = self.stats()
        self.assertEqual({h['id'] for h in s['habits']}, {'push', 'water', 'run'})
        self.assertEqual(s['tasks_completed'], 1)
        self.assertIn(ago(5), {c['date'] for c in s['heatmap'] if c['count']})

    def test_goal_streak_and_consistency(self):
        s = self.stats()
        self.assertTrue(s['active_today'])          # water + run today
        self.assertEqual(s['current_streak'], 3)    # today, 1, 2
        self.assertEqual(s['best_streak'], 6)       # 20..15 (run on 15)
        self.assertEqual(s['consistency_basis'], 'habits')
        # Pushups: 7 full days of 29 finished ones (today isn't over and isn't done).
        self.assertEqual(self.habit(s, 'push')['rate_30d'], round(100 * 7 / 29))
        rates = [h['rate_30d'] for h in s['habits']]
        self.assertEqual(s['consistency_30d'], round(sum(rates) / len(rates)))
        self.assertEqual(len(s['heatmap']), 26 * 7)
        self.assertEqual(len(s['trend']), 12)

    def test_endpoint_is_read_only(self):
        api = FastAPI()
        api.include_router(router)

        def ro_db():
            with Session(self.engine) as db:
                db.execute(text('PRAGMA query_only=ON'))
                try:
                    yield db
                finally:
                    db.execute(text('PRAGMA query_only=OFF'))
        api.dependency_overrides[get_db] = ro_db
        client = TestClient(api)
        res = client.get('/goals/r/stats')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(client.get('/goals/missing/stats').status_code, 404)


if __name__ == '__main__':
    unittest.main()
