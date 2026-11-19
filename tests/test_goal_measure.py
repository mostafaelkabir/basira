"""Goal measure tests. In-memory DB only; never imports app.main.

Proves: progress, pace (weeks ahead/behind a straight line), the four-week projection,
weekly system adherence from habits, and the diagnosis that compares the two; counted
sources; and the API (one check-in per week, validation, clearing, listing).
"""
import unittest
from datetime import UTC, date, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base, get_db
from app.models.execution_log import ExecutionLog
from app.models.goal import Goal, GoalCheckin
from app.models.habit_log import HabitLog
from app.models.task import Task
from app.routes.goal_measure import router as measure_router
from app.routes.goals import router as goals_router
from app.services.goal_measure import measure, measures

DAY = date(2026, 10, 10)  # a Saturday; its week starts Mon 2026-10-05


def ago(n):
    return (DAY - timedelta(days=n)).isoformat()


def weight_goal(**over):
    """92 → 82 kg over 20 weeks (1 Aug → 19 Dec); DAY is exactly half way."""
    fields = dict(id='w', title='Lose weight', type='resolution', created_at=datetime(2026, 8, 1, tzinfo=UTC),
                  metric_name='Weight', metric_unit='kg', metric_source='manual', metric_start=92, metric_target=82,
                  metric_start_date='2026-08-01', metric_target_date='2026-12-19')
    return Goal(**{**fields, **over})


class Base_(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)

    def add(self, *rows):
        with Session(self.engine) as db:
            db.add_all(rows)
            db.commit()

    def checkins(self, *pairs, goal='w'):
        self.add(*[GoalCheckin(id=f'{goal}-{d}', goal_id=goal, date=d, value=v,
                               week_start=(date.fromisoformat(d) - timedelta(days=date.fromisoformat(d).weekday())).isoformat())
                   for d, v in pairs])

    def habit(self, days_logged, freq='daily', hid='walk'):
        self.add(Task(id=hid, goal_id='w', title='Walk', habit_frequency=freq, created_at=ago(90)))
        self.add(*[HabitLog(id=f'{hid}-{n}', task_id=hid, date=ago(n), count=1) for n in days_logged])

    def read(self, gid='w'):
        with Session(self.engine) as db:
            return measure(db, db.get(Goal, gid), DAY)


class MeasureMathTests(Base_):
    def test_goal_without_a_target_is_undefined(self):
        self.add(Goal(id='w', title='Vague', type='resolution'))
        self.assertEqual(self.read()['defined'], False)

    def test_before_any_checkin_it_asks_for_data(self):
        self.add(weight_goal())
        m = self.read()
        self.assertEqual((m['current'], m['progress_pct'], m['projection']), (92, 0, None))
        self.assertEqual(m['diagnosis']['key'], 'need_data')
        self.assertFalse(m['checked_in_this_week'])
        self.assertEqual(m['expected'], 87)   # half the time gone → half the distance expected

    def test_progress_pace_and_projection(self):
        self.add(weight_goal())
        self.checkins(('2026-09-05', 91), ('2026-10-09', 88))
        m = self.read()
        self.assertEqual((m['current'], m['progress_pct']), (88, 40))
        self.assertEqual(m['pace'], {'status': 'behind', 'weeks': 2.0, 'days_left': 70})
        # Rate since the last point at least four weeks back (5 Sep): 3 kg in 34 days.
        self.assertEqual(m['projection'], {'weekly_rate': -0.62, 'toward': True, 'date': '2026-12-16', 'since': '2026-09-05'})
        self.assertEqual(m['required_weekly'], -0.6)
        self.assertTrue(m['checked_in_this_week'])
        self.assertEqual([p['value'] for p in m['points']], [92, 91, 88])

    def test_ahead_on_pace_and_reached(self):
        self.add(weight_goal())
        self.checkins(('2026-10-09', 85))
        self.assertEqual(self.read()['pace']['status'], 'ahead')
        with Session(self.engine) as db:
            db.get(GoalCheckin, 'w-2026-10-09').value = 87.2
            db.commit()
        self.assertEqual(self.read()['pace']['status'], 'on_pace')
        with Session(self.engine) as db:
            db.get(GoalCheckin, 'w-2026-10-09').value = 81.5
            db.commit()
        m = self.read()
        self.assertEqual((m['pace']['status'], m['progress_pct'], m['diagnosis']['key']), ('reached', 100, 'reached'))

    def test_moving_the_wrong_way_has_no_arrival_date(self):
        self.add(weight_goal())
        self.checkins(('2026-10-09', 94))
        m = self.read()
        self.assertEqual((m['progress_pct'], m['projection']['toward'], m['projection']['date']), (0, False, None))

    def test_no_target_date_means_no_pace_but_still_a_projection(self):
        self.add(weight_goal(metric_target_date=None))
        self.checkins(('2026-10-09', 88))
        m = self.read()
        self.assertIsNone(m['pace'])
        self.assertIsNotNone(m['projection']['date'])

    def test_overdue(self):
        self.add(weight_goal(metric_target_date='2026-09-30'))
        self.checkins(('2026-10-09', 88))
        self.assertEqual(self.read()['pace']['status'], 'overdue')


class DiagnosisTests(Base_):
    MOVING = (('2026-09-05', 91), ('2026-10-09', 88))
    FLAT = (('2026-09-05', 92), ('2026-10-09', 91.9))

    def diagnose(self, checkins, logged=None):
        self.add(weight_goal())
        self.checkins(*checkins)
        if logged is not None:
            self.habit(logged)
        return self.read()

    def test_kept_and_moving(self):
        m = self.diagnose(self.MOVING, range(0, 28))
        self.assertEqual((m['system_pct'], m['diagnosis']['key']), (100, 'keep_going'))

    def test_kept_and_flat_means_change_the_system(self):
        self.assertEqual(self.diagnose(self.FLAT, range(0, 28))['diagnosis']['key'], 'change_system')

    def test_not_kept_and_flat_is_execution(self):
        m = self.diagnose(self.FLAT, [3, 12])
        self.assertLess(m['system_pct'], 70)
        self.assertEqual(m['diagnosis']['key'], 'execution')

    def test_not_kept_and_moving(self):
        self.assertEqual(self.diagnose(self.MOVING, [])['diagnosis']['key'], 'easy_or_luck')

    def test_no_habits(self):
        m = self.diagnose(self.MOVING)
        self.assertEqual((m['system_pct'], m['habits_count'], m['diagnosis']['key']), (None, 0, 'moving_no_system'))

    def test_no_habits_and_flat(self):
        self.assertEqual(self.diagnose(self.FLAT)['diagnosis']['key'], 'no_system')


class SystemWeekTests(Base_):
    def test_running_week_only_asks_for_days_that_have_come(self):
        self.add(weight_goal())
        self.habit([0, 1, 2, 3, 4, 5])            # Mon..Sat of the running week, nothing before
        weeks = self.read()['weeks']
        self.assertEqual(len(weeks), 12)
        self.assertEqual(weeks[-1], {'week_start': '2026-10-05', 'done': 6, 'planned': 6, 'pct': 100, 'partial': True})
        self.assertEqual((weeks[-2]['done'], weeks[-2]['planned'], weeks[-2]['pct']), (0, 7, 0))

    def test_today_does_not_count_against_you_until_it_is_over(self):
        self.add(weight_goal())
        self.habit([1, 2, 3, 4, 5])               # Mon..Fri; Saturday (today) not done yet
        week = self.read()['weeks'][-1]
        self.assertEqual((week['done'], week['planned']), (5, 5))

    def test_habit_added_today_is_not_judged_yet(self):
        self.add(weight_goal(), Task(id='new', goal_id='w', title='New habit', created_at=DAY.isoformat()))
        self.checkins(('2026-09-05', 91), ('2026-10-09', 88))
        m = self.read()
        self.assertEqual((m['habits_count'], m['system_pct'], m['diagnosis']['key']), (1, None, 'system_new'))

    def test_weekly_habit_is_capped_at_its_target(self):
        self.add(weight_goal())
        self.habit([6, 7, 8, 9, 10], freq='3x_week')   # five check-ins last week (Sep 30–Oct 4)
        last = self.read()['weeks'][-2]
        self.assertEqual((last['done'], last['planned']), (3, 3))

    def test_retired_and_one_off_tasks_are_not_the_system(self):
        self.add(weight_goal())
        self.add(Task(id='old', goal_id='w', title='Old habit', status='done', created_at=ago(90)),
                 Task(id='buy', goal_id='w', title='Buy scale', kind='task', created_at=ago(90)))
        m = self.read()
        self.assertEqual((m['habits_count'], m['system_pct']), (0, None))


class CountedSourceTests(Base_):
    def test_tasks_source_counts_completions_since_the_start(self):
        self.add(Goal(id='w', title='Read', type='project', metric_name='Books', metric_source='tasks',
                      metric_start=0, metric_target=24, metric_start_date='2026-09-01', metric_target_date='2026-12-31'))
        self.add(*[Task(id=f'b{i}', goal_id='w', title=f'Book {i}', status='done') for i in range(4)])
        stamps = ['2026-08-20', '2026-09-10', '2026-09-28', '2026-10-08']   # the first is before the start
        self.add(*[ExecutionLog(id=f'e{i}', task_id=f'b{i}', completed_at=datetime.fromisoformat(s + 'T12:00:00+00:00'))
                   for i, s in enumerate(stamps)])
        m = self.read()
        self.assertEqual((m['current'], m['checked_in_this_week']), (3, True))
        self.assertEqual(m['points'][0], {'id': None, 'date': '2026-09-01', 'value': 0, 'note': ''})
        self.assertEqual(m['points'][-1]['date'], DAY.isoformat())

    def test_checkins_source_counts_habit_checkins(self):
        self.add(weight_goal(metric_name='Workouts', metric_source='checkins', metric_start=0, metric_target=100))
        self.habit([1, 2, 3, 200])   # the last one is before the start date
        self.assertEqual(self.read()['current'], 3)


class MeasureApiTests(Base_):
    def setUp(self):
        super().setUp()
        self.add(Goal(id='w', title='Lose weight', type='resolution'), Goal(id='p', title='Plain', type='project'))
        api = FastAPI()
        api.include_router(measure_router)
        api.include_router(goals_router)

        def test_db():
            with Session(self.engine) as db:
                yield db
        api.dependency_overrides[get_db] = test_db
        self.c = TestClient(api)
        self.today = date.today()

    def define(self, **over):
        body = {'name': 'Weight', 'unit': 'kg', 'start': 92, 'target': 82,
                'start_date': (self.today - timedelta(days=30)).isoformat(),
                'target_date': (self.today + timedelta(days=60)).isoformat(), **over}
        return self.c.put('/goals/w/measure', json=body)

    def test_define_read_and_list(self):
        self.assertEqual(self.c.get('/goals/w/measure').json()['defined'], False)
        self.assertEqual(self.c.get('/goals/measures').json(), [])
        res = self.define()
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()['name'], res.json()['current']), ('Weight', 92))
        self.assertEqual([m['goal_id'] for m in self.c.get('/goals/measures').json()], ['w'])
        self.assertEqual(self.c.get('/goals/w').json()['title'], 'Lose weight')   # the goal route still answers

    def test_validation(self):
        self.assertEqual(self.define(target=92).status_code, 400)
        self.assertEqual(self.define(target_date=(self.today - timedelta(days=40)).isoformat()).status_code, 400)
        self.assertEqual(self.define(source='vibes').status_code, 400)
        self.assertEqual(self.define(start_date='soon').status_code, 400)
        self.assertEqual(self.c.put('/goals/nope/measure', json={'name': 'x', 'start': 0, 'target': 1}).status_code, 404)

    def test_one_checkin_per_week_and_delete(self):
        self.assertEqual(self.c.post('/goals/w/measure/checkins', json={'value': 90}).status_code, 400)  # no target yet
        self.define()
        self.c.post('/goals/w/measure/checkins', json={'value': 90, 'note': 'after trip'})
        m = self.c.post('/goals/w/measure/checkins', json={'value': 89.5}).json()
        entered = [p for p in m['points'] if p['id']]
        self.assertEqual([(p['value'], p['note']) for p in entered], [(89.5, '')])
        self.assertTrue(m['checked_in_this_week'])
        earlier = (self.today - timedelta(days=14)).isoformat()
        m = self.c.post('/goals/w/measure/checkins', json={'value': 91, 'date': earlier}).json()
        self.assertEqual([p['value'] for p in m['points']], [92, 91, 89.5])
        future = (self.today + timedelta(days=1)).isoformat()
        self.assertEqual(self.c.post('/goals/w/measure/checkins', json={'value': 1, 'date': future}).status_code, 400)
        m = self.c.delete(f"/goals/w/measure/checkins/{entered[0]['id']}").json()
        self.assertEqual([p['value'] for p in m['points']], [92, 91])
        self.assertEqual(self.c.delete('/goals/w/measure/checkins/nope').status_code, 404)

    def test_counted_metric_refuses_manual_checkins(self):
        self.define(source='checkins', start=0, target=100)
        self.assertEqual(self.c.post('/goals/w/measure/checkins', json={'value': 5}).status_code, 400)

    def test_clear_removes_the_measure_and_its_checkins(self):
        self.define()
        self.c.post('/goals/w/measure/checkins', json={'value': 90})
        self.assertEqual(self.c.delete('/goals/w/measure').json()['defined'], False)
        with Session(self.engine) as db:
            self.assertEqual(db.query(GoalCheckin).count(), 0)

    def test_closed_goals_leave_the_list_and_purging_takes_the_checkins(self):
        self.define()
        self.c.post('/goals/w/measure/checkins', json={'value': 90})
        self.c.post('/goals/w/status', json={'status': 'achieved'})
        with Session(self.engine) as db:
            self.assertEqual(measures(db), [])
            db.delete(db.get(Goal, 'w'))
            db.commit()
            self.assertEqual(db.query(GoalCheckin).count(), 0)


if __name__ == '__main__':
    unittest.main()
