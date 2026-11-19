"""Day rhythm: a weekday template of blocks, each day built from it, items filed
into blocks, time laid on top. In-memory DB only; never imports app.main.

Proves: template CRUD with validation (kinds, targets, days, times, same-day
overlap); a day resolves the template for its weekday with per-day changes
(move/resize/skip/restore) that touch only that day; "running late" shifts the
rest of the day; items file into blocks by client/project (parent projects too)
and habits into the routine block; recorded time spreads over a target's blocks;
the day workspace carries blocks and rhythm totals; the suggested rhythm is
sane; block notifications fire once at start and five minutes before the end.
"""
import unittest
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
import app.scheduler as scheduler
from app.database import Base, get_db
from app.models.company import Company
from app.models.day_block import DayBlock
from app.models.goal import Goal
from app.models.rhythm_block import RhythmBlock
from app.models.setting import Setting
from app.models.task import Task
from app.models.work_ticket import WorkTicket
from app.routes.rhythm import router as rhythm_router
from app.services.day_rhythm import apply_recorded, rhythm_totals
from app.services.day_workspace import build_day_workspace
from app.services.habit_routine import WEEKDAYS

TODAY = date.today()
TOK = WEEKDAYS[TODAY.weekday()]
NEXT_WEEK = TODAY + timedelta(days=7)
OTHER = TODAY + timedelta(days=1)
OTHER_TOK = WEEKDAYS[OTHER.weekday()]
ALL = list(WEEKDAYS)


class DayRhythmTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            db.add_all([
                Company(id='hb', name='HaramBlur', color='#123456'),
                Goal(id='vision', title='Basira Vision', type='project'),
                Goal(id='jobs', title='Get a Rewarding Job', type='project'),
                Goal(id='deen', title='Deen', type='resolution'),
            ])
            db.flush()
            db.add(Goal(id='vision-sub', title='Vision: onboarding', type='project', parent_id='vision'))
            db.flush()
            db.add_all([
                WorkTicket(id='tk1', company_id='hb', title='Label dataset', status='todo', plan_date=TODAY.isoformat()),
                WorkTicket(id='tk2', company_id='hb', title='Linked to vision', status='todo', plan_date=TODAY.isoformat(),
                           linked_goal_id='vision'),
                Task(id='t-sub', goal_id='vision-sub', title='Design onboarding', status='todo', plan_date=TODAY.isoformat()),
                Task(id='t-job', goal_id='jobs', title='Apply for 3 jobs', status='todo', plan_date=TODAY.isoformat(),
                     scheduled_time='16:30'),
                Task(id='h-quran', goal_id='deen', title='Quran', status='todo', habit_frequency='daily',
                     scheduled_time='07:15', routine_days=','.join(ALL)),
                Task(id='h-walk', goal_id='deen', title='Walk', status='todo', habit_frequency='daily',
                     routine_days=','.join(ALL)),
                Task(id='h-noon', goal_id='deen', title='Read to Shaykh', status='todo', habit_frequency='daily',
                     scheduled_time='12:00', routine_days=','.join(ALL)),
                Setting(key='day_start', value='09:00'), Setting(key='day_end', value='18:00'),
            ])
            db.commit()
        api = FastAPI()
        api.include_router(rhythm_router)
        engine = self.engine

        def test_db():
            with Session(engine) as db:
                yield db
        api.dependency_overrides[get_db] = test_db
        self.client = TestClient(api)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    # helpers
    def create(self, **body):
        return self.client.post('/rhythm', json=body)

    def block(self, title, kind, start, dur, days=ALL, target=None):
        r = self.create(title=title, kind=kind, start_time=start, duration_minutes=dur, days=days, target_ref=target)
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    def day(self, d=TODAY):
        return self.client.get(f'/rhythm/day?date={d.isoformat()}').json()

    def workspace(self, d=TODAY):
        with Session(self.engine) as db:
            db.execute(text('PRAGMA query_only = ON'))
            try:
                return build_day_workspace(db, d, ZoneInfo('UTC'), datetime.now(UTC))
            finally:
                db.execute(text('PRAGMA query_only = OFF'))

    def standard_rhythm(self):
        self.block('Morning routine', 'routine', '07:00', 90)
        self.block('', 'client', '09:00', 120, target='company:hb')
        self.block('', 'project', '11:15', 120, target='goal:vision')
        self.block('Lunch', 'personal', '13:15', 60)
        self.block('Job search', 'project', '16:00', 60, target='goal:jobs')

    # ── template ──

    def test_create_validates_kind_target_days_time_and_overlap(self):
        self.assertEqual(self.create(kind='nap', start_time='09:00').status_code, 400)
        self.assertEqual(self.create(kind='project', start_time='09:00', target_ref='company:hb').status_code, 400)
        self.assertEqual(self.create(kind='client', start_time='09:00', target_ref='company:nope').status_code, 400)
        self.assertEqual(self.create(kind='personal', title='Lunch', start_time='9am').status_code, 400)
        self.assertEqual(self.create(kind='personal', title='Lunch', start_time='12:00', days=[]).status_code, 400)
        self.assertEqual(self.create(kind='break', title='Break', start_time='12:00', target_ref='goal:vision').status_code, 400)
        first = self.block('', 'client', '09:00', 120, days=ALL[:5], target='company:hb')
        self.assertEqual(first['title'], 'HaramBlur')          # title falls back to the target
        self.assertEqual(first['color'], '#123456')            # and so does the colour
        self.assertEqual(first['end_time'], '11:00')
        clash = self.create(kind='project', start_time='10:00', duration_minutes=60, target_ref='goal:vision', days=['wed'])
        self.assertEqual(clash.status_code, 409)
        self.assertEqual(clash.json()['detail']['conflicts'][0]['id'], first['id'])
        # Same hours on days the first block does not use are fine.
        weekend = self.create(kind='project', start_time='10:00', duration_minutes=60, target_ref='goal:vision', days=['sat', 'sun'])
        self.assertEqual(weekend.status_code, 201)
        self.assertEqual(len(self.client.get('/rhythm').json()['blocks']), 2)

    def test_update_and_delete(self):
        b = self.block('Lunch', 'personal', '13:00', 60)
        r = self.client.patch(f"/rhythm/{b['id']}", json={'start_time': '12:30', 'duration_minutes': 45, 'days': ['mon', 'Tue']})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()['start_time'], r.json()['duration_minutes'], r.json()['days']), ('12:30', 45, ['mon', 'tue']))
        # Deleting a template block also drops its per-day changes.
        self.client.post('/rhythm/day/override', json={'rhythm_id': b['id'], 'date': TODAY.isoformat(), 'start_time': '12:45'})
        with Session(self.engine) as db:
            self.assertEqual(db.query(DayBlock).filter_by(rhythm_id=b['id']).count(), 1)
        self.assertEqual(self.client.delete(f"/rhythm/{b['id']}").status_code, 204)
        with Session(self.engine) as db:
            self.assertEqual(db.query(DayBlock).count(), 0)
            self.assertEqual(db.query(RhythmBlock).count(), 0)

    # ── a day from the template ──

    def test_day_is_the_template_for_its_weekday(self):
        self.standard_rhythm()
        self.block('Evening read', 'personal', '20:00', 60, days=[OTHER_TOK])   # not today's weekday
        titles = [b['title'] for b in self.day()['blocks']]
        self.assertEqual(titles, ['Morning routine', 'HaramBlur', 'Basira Vision', 'Lunch', 'Job search'])
        hb = self.day()['blocks'][1]
        self.assertTrue(hb['virtual'])
        self.assertTrue(hb['id'].startswith('rhythm:'))
        self.assertEqual((hb['start_time'], hb['end_time'], hb['kind'], hb['target_title']), ('09:00', '11:00', 'client', 'HaramBlur'))
        with Session(self.engine) as db:
            self.assertEqual(db.query(DayBlock).count(), 0, 'reading a day writes nothing')

    def test_one_day_changes_do_not_touch_other_days(self):
        self.standard_rhythm()
        hb = self.day()['blocks'][1]
        r = self.client.post('/rhythm/day/override', json={'rhythm_id': hb['rhythm_id'], 'date': TODAY.isoformat(),
                                                           'start_time': '09:30', 'duration_minutes': 90})
        self.assertEqual(r.status_code, 200, r.text)
        today_hb = next(b for b in self.day()['blocks'] if b['rhythm_id'] == hb['rhythm_id'])
        self.assertEqual((today_hb['start_time'], today_hb['duration_minutes'], today_hb['virtual']), ('09:30', 90, False))
        week_hb = next(b for b in self.day(NEXT_WEEK)['blocks'] if b['rhythm_id'] == hb['rhythm_id'])
        self.assertEqual((week_hb['start_time'], week_hb['duration_minutes']), ('09:00', 120))
        # Skip today only, then restore.
        self.client.post('/rhythm/day/override', json={'rhythm_id': hb['rhythm_id'], 'date': TODAY.isoformat(), 'skipped': True})
        d = self.day()
        self.assertNotIn(hb['rhythm_id'], [b['rhythm_id'] for b in d['blocks']])
        self.assertEqual([b['rhythm_id'] for b in d['skipped']], [hb['rhythm_id']])
        self.assertIn(hb['rhythm_id'], [b['rhythm_id'] for b in self.day(NEXT_WEEK)['blocks']])
        self.client.post('/rhythm/day/restore', json={'rhythm_id': hb['rhythm_id'], 'date': TODAY.isoformat()})
        back = next(b for b in self.day()['blocks'] if b['rhythm_id'] == hb['rhythm_id'])
        self.assertEqual((back['start_time'], back['virtual']), ('09:00', True))

    def test_a_rhythm_block_can_be_added_to_a_day_it_does_not_run_on(self):
        b = self.block('Deep clean', 'personal', '10:00', 60, days=[OTHER_TOK])
        self.assertNotIn(b['id'], [x['rhythm_id'] for x in self.day()['blocks']])
        # Pulling it onto today (an override with no changes) puts it on today only.
        r = self.client.post('/rhythm/day/override', json={'rhythm_id': b['id'], 'date': TODAY.isoformat()})
        self.assertEqual(r.status_code, 200, r.text)
        mine = next(x for x in r.json()['blocks'] if x['rhythm_id'] == b['id'])
        self.assertTrue(mine['added'])
        self.assertEqual((mine['start_time'], mine['title']), ('10:00', 'Deep clean'))
        self.assertNotIn(b['id'], [x['rhythm_id'] for x in self.day(NEXT_WEEK)['blocks']], 'next week is untouched')
        # Items file into it like any other block, and it can be moved for the day.
        self.client.post('/rhythm/day/override', json={'rhythm_id': b['id'], 'date': TODAY.isoformat(), 'start_time': '10:30'})
        self.assertEqual(next(x for x in self.day()['blocks'] if x['rhythm_id'] == b['id'])['start_time'], '10:30')
        # Restoring removes it from the day; skipping hides it too.
        self.client.post('/rhythm/day/restore', json={'rhythm_id': b['id'], 'date': TODAY.isoformat()})
        self.assertNotIn(b['id'], [x['rhythm_id'] for x in self.day()['blocks']])
        self.client.post('/rhythm/day/override', json={'rhythm_id': b['id'], 'date': TODAY.isoformat()})
        self.client.post('/rhythm/day/override', json={'rhythm_id': b['id'], 'date': TODAY.isoformat(), 'skipped': True})
        d = self.day()
        self.assertNotIn(b['id'], [x['rhythm_id'] for x in d['blocks']])
        self.assertNotIn(b['id'], [x['rhythm_id'] for x in d['skipped']], 'not listed as skipped: it never belonged to this weekday')

    def test_running_late_shifts_the_rest_of_the_day(self):
        self.standard_rhythm()
        r = self.client.post('/rhythm/day/shift', json={'date': TODAY.isoformat(), 'from_time': '11:00', 'minutes': 30})
        self.assertEqual(r.status_code, 200, r.text)
        starts = {b['title']: b['start_time'] for b in r.json()['blocks']}
        self.assertEqual(starts['Morning routine'], '07:00')
        self.assertEqual(starts['HaramBlur'], '09:00')
        self.assertEqual((starts['Basira Vision'], starts['Lunch'], starts['Job search']), ('11:45', '13:45', '16:30'))
        self.assertEqual({b['title']: b['start_time'] for b in self.day(NEXT_WEEK)['blocks']}['Lunch'], '13:15')

    # ── items and time ──

    def test_items_file_into_blocks_by_client_project_and_routine(self):
        self.standard_rhythm()
        ws = self.workspace()
        by_key = {i['key']: i for i in ws['agenda'] + ws['unscheduled']}
        blocks = {b['title']: b for b in ws['blocks']}
        self.assertEqual(by_key['ticket:tk1']['block_id'], blocks['HaramBlur']['id'])
        self.assertEqual(by_key['ticket:tk2']['block_id'], blocks['HaramBlur']['id'], 'client wins over linked project')
        self.assertEqual(by_key['task:t-sub']['block_id'], blocks['Basira Vision']['id'], 'a sub-project files under its parent')
        self.assertEqual(by_key['task:t-job']['block_id'], blocks['Job search']['id'])
        self.assertEqual(by_key['habit:h-quran']['block_id'], blocks['Morning routine']['id'])
        self.assertEqual(by_key['habit:h-walk']['block_id'], blocks['Morning routine']['id'], 'untimed habit joins the routine')
        self.assertIsNone(by_key['habit:h-noon']['block_id'], 'a habit timed outside every routine block is not shown under the wrong hour')
        self.assertEqual(sorted(blocks['HaramBlur']['items']), ['ticket:tk1', 'ticket:tk2'])
        self.assertEqual(ws['totals']['rhythm'], {'work_minutes': 300, 'routine_minutes': 90, 'personal_minutes': 60, 'break_minutes': 0})

    def test_a_client_block_also_takes_tasks_of_the_same_named_project(self):
        with Session(self.engine) as db:
            db.add(Goal(id='hb-goal', title='Haram Blur', type='project'))   # same name as the client, spaced differently
            db.flush()
            db.add(Task(id='t-hb', goal_id='hb-goal', title='Work 3 hours HB', status='todo', plan_date=TODAY.isoformat()))
            db.commit()
        self.block('', 'client', '09:00', 120, target='company:hb')
        ws = self.workspace()
        by_key = {i['key']: i for i in ws['agenda'] + ws['unscheduled']}
        self.assertEqual(by_key['task:t-hb']['block_id'], ws['blocks'][0]['id'])
        self.assertEqual(by_key['ticket:tk1']['block_id'], ws['blocks'][0]['id'])

    def test_an_item_timed_outside_its_block_is_flagged_and_a_block_here_resolves_it(self):
        self.standard_rhythm()                     # Job search 16:00–17:00
        with Session(self.engine) as db:
            db.get(Task, 't-job').scheduled_time = '12:00'
            db.commit()
        item = {i['key']: i for i in (lambda w: w['agenda'] + w['unscheduled'])(self.workspace())}['task:t-job']
        self.assertEqual(item['off_block']['title'], 'Job search')
        self.assertEqual((item['off_block']['start_time'], item['off_block']['target_ref']), ('16:00', 'goal:jobs'))
        # In its block's window: no conflict.
        with Session(self.engine) as db:
            db.get(Task, 't-job').scheduled_time = '16:15'
            db.commit()
        item = {i['key']: i for i in (lambda w: w['agenda'] + w['unscheduled'])(self.workspace())}['task:t-job']
        self.assertIsNone(item['off_block'])
        # A second, today-only block for the same project around 12:00 takes it in.
        with Session(self.engine) as db:
            db.get(Task, 't-job').scheduled_time = '12:00'
            db.add(DayBlock(id='extra', date=TODAY.isoformat(), kind='project', source_ref='goal:jobs',
                            start_time='12:00', duration_minutes=60, title=''))
            db.commit()
        ws = self.workspace()
        item = {i['key']: i for i in ws['agenda'] + ws['unscheduled']}['task:t-job']
        self.assertIsNone(item['off_block'])
        self.assertEqual(item['block_id'], 'extra')
        self.assertEqual([b['title'] for b in ws['blocks'] if b['target_ref'] == 'goal:jobs'], ['Get a Rewarding Job', 'Job search'])
        self.assertIsNone({i['key']: i for i in ws['agenda'] + ws['unscheduled']}['task:t-sub']['off_block'], 'untimed items never conflict')

    def test_unmatched_items_stay_unfiled(self):
        self.block('Lunch', 'personal', '13:00', 60)
        ws = self.workspace()
        self.assertTrue(all(i['block_id'] is None for i in ws['agenda'] + ws['unscheduled']))

    def test_open_time_takes_timed_items_that_match_no_block(self):
        self.block('Open time', 'free', '16:00', 120)           # holds 16:30, the job task's time
        self.block('Lunch', 'personal', '13:00', 60)
        ws = self.workspace()
        by_key = {i['key']: i for i in ws['agenda'] + ws['unscheduled']}
        free = next(b for b in ws['blocks'] if b['kind'] == 'free')
        self.assertEqual(by_key['task:t-job']['block_id'], free['id'])
        self.assertIsNone(by_key['task:t-sub']['block_id'], 'untimed items do not fall into open time')
        self.assertIsNone(by_key['habit:h-noon']['block_id'], 'habits only ever go to routine blocks')

    def test_recorded_time_spreads_over_a_targets_blocks(self):
        blocks = [
            {'kind': 'client', 'target_ref': 'company:hb', 'duration_minutes': 60, 'start_minutes': 540},
            {'kind': 'client', 'target_ref': 'company:hb', 'duration_minutes': 60, 'start_minutes': 900},
            {'kind': 'project', 'target_ref': 'goal:vision', 'duration_minutes': 120, 'start_minutes': 700},
        ]
        apply_recorded(blocks, by_project=[{'project_id': 'vision', 'seconds': 100, 'live_seconds': 0}],
                       by_client=[{'company_id': 'hb', 'seconds': 5000, 'live_seconds': 600}])
        self.assertEqual((blocks[0]['recorded_seconds'], blocks[1]['recorded_seconds']), (3600, 1400))
        self.assertEqual((blocks[0]['live_seconds'], blocks[1]['live_seconds']), (0, 600))
        self.assertEqual(blocks[2]['recorded_seconds'], 100)
        self.assertEqual(rhythm_totals(blocks + [{'kind': 'break', 'duration_minutes': 15}]),
                         {'work_minutes': 240, 'routine_minutes': 0, 'personal_minutes': 0, 'break_minutes': 15})

    # ── suggestion ──

    def test_suggested_rhythm_is_sane_and_unsaved(self):
        r = self.client.get('/rhythm/suggest')
        self.assertEqual(r.status_code, 200)
        blocks = r.json()['blocks']
        self.assertEqual(blocks[0]['kind'], 'routine')
        self.assertEqual(blocks[0]['start_time'], '07:15', 'starts with the earliest morning habit')
        kinds = [b['kind'] for b in blocks]
        self.assertIn('client', kinds); self.assertIn('personal', kinds); self.assertIn('free', kinds)
        job = next(b for b in blocks if b['title'] == 'Job search')
        self.assertEqual(job['target_ref'], 'goal:jobs')
        deep = [b for b in blocks if b['kind'] in ('client', 'project') and b['title'] != 'Job search']
        self.assertTrue(all(b['duration_minutes'] == 120 for b in deep))
        self.assertLessEqual(len(deep), 3)
        # No two weekday blocks overlap.
        wk = sorted([b for b in blocks if 'mon' in b['days']], key=lambda b: b['start_time'])
        for a, b in zip(wk, wk[1:]):
            ah, am = map(int, a['start_time'].split(':')); bh, bm = map(int, b['start_time'].split(':'))
            self.assertLessEqual(ah * 60 + am + a['duration_minutes'], bh * 60 + bm, f"{a['title']} overlaps {b['title']}")
        self.assertEqual(self.client.get('/rhythm').json()['blocks'], [])
        # Saving the whole thing at once works and is all-or-nothing.
        self.assertEqual(self.client.post('/rhythm/batch', json={'blocks': blocks}).status_code, 201)
        self.assertEqual(len(self.client.get('/rhythm').json()['blocks']), len(blocks))

    # ── notifications ──

    def test_block_notifications_fire_once_at_start_and_before_end(self):
        self.standard_rhythm()
        sent = []
        original_session, original_send = scheduler.SessionLocal, scheduler.send_mac_notification
        scheduler.SessionLocal = sessionmaker(bind=self.engine)
        scheduler.send_mac_notification = lambda title, msg: sent.append(msg)
        scheduler._notified_today = set()
        try:
            for _ in range(2):
                scheduler.check_rhythm_and_notify(TODAY.isoformat(), '09:00', {'rhythm_notifications': 'true'})
            scheduler.check_rhythm_and_notify(TODAY.isoformat(), '10:55', {'rhythm_notifications': 'true'})
            scheduler.check_rhythm_and_notify(TODAY.isoformat(), '10:55', {'rhythm_notifications': 'false'})
        finally:
            scheduler.SessionLocal, scheduler.send_mac_notification = original_session, original_send
            scheduler._notified_today = set()
        self.assertEqual(sent, ['Now: HaramBlur · 2h', 'HaramBlur ends in 5 min · next: Basira Vision at 11:15'])


if __name__ == '__main__':
    unittest.main()
