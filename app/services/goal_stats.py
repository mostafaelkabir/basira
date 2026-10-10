"""Read-only consistency stats for one goal: streaks, 30-day consistency, a daily
activity heatmap, weekly trend and per-habit streaks.

A goal is "active" on a day when one of its habits was checked in (any count) or
one of its tasks/sub-tasks (or a sub-project's) was completed. Habit streaks are
stricter: a daily habit's day counts only once it hits its per-day target
(e.g. 2x_day needs two check-ins), and an Nx_week habit streaks in weeks that hit N.

A streak that hasn't been extended *yet today* (or this week) is still alive —
the current streak counts back from yesterday (last week) until today is done.
"""
import re
from datetime import UTC, date, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.execution_log import ExecutionLog
from app.models.goal import Goal
from app.models.habit_log import HabitLog
from app.models.task import Task, is_habit
from app.models.work_session import WorkSession
from app.models.work_ticket import WorkTicket, WorkTimeEntry

WINDOW_DAYS = 30
HEATMAP_WEEKS = 26
TREND_WEEKS = 12


def _per_day(freq: str | None) -> int:
    m = re.match(r"^(\d+)x_day$", freq or "")
    return int(m.group(1)) if m else 1


def _per_week(freq: str | None) -> int | None:
    """Target days per week for an Nx_week habit; None for day-based habits."""
    m = re.match(r"^(\d+)x_week$", freq or "")
    return min(int(m.group(1)), 7) if m else None


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _local_date(dt: datetime) -> date:
    # execution_logs.completed_at is written as UTC; SQLite hands it back naive.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone().date()


def _created(task: Task, fallback: date) -> date:
    try:
        return date.fromisoformat(task.created_at) if task.created_at else fallback
    except ValueError:
        return fallback


def _runs(hits: set, step: timedelta, latest):
    """(current, best, best_start, best_end) over a set of dates/week-starts.
    `latest` is today (or this week); current counts back from it, or from the
    period before it when it isn't hit yet."""
    best, best_start, best_end = 0, None, None
    for start in sorted(hits):
        if start - step in hits:
            continue  # not the start of a run
        end, length = start, 1
        while end + step in hits:
            end += step
            length += 1
        if length > best:
            best, best_start, best_end = length, start, end
    anchor = latest if latest in hits else latest - step
    current = 0
    while anchor in hits:
        current += 1
        anchor -= step
    return current, best, best_start, best_end


def _habit_stats(task: Task, logs: list[HabitLog], today: date) -> dict:
    window_start = today - timedelta(days=WINDOW_DAYS - 1)
    start = max(_created(task, window_start), window_start)
    weekly = _per_week(task.habit_frequency)
    log_days = {date.fromisoformat(l.date) for l in logs if (l.count or 0) > 0}

    if weekly:
        per_week: dict[date, int] = {}
        for d in log_days:
            per_week[_week_start(d)] = per_week.get(_week_start(d), 0) + 1
        hits = {w for w, n in per_week.items() if n >= weekly}
        this_week = _week_start(today)
        current, best, b_start, b_end = _runs(hits, timedelta(weeks=1), this_week)
        # Consistency over the weeks touching the window; the running week only
        # counts against you once it's over, but counts for you as soon as it's met.
        scores, w = [], _week_start(start)
        while w <= this_week:
            done = min(per_week.get(w, 0), weekly)
            if w < this_week or done >= weekly:
                scores.append(done / weekly)
            w += timedelta(weeks=1)
        rate = round(100 * sum(scores) / len(scores)) if scores else None
        done_now = this_week in hits
        unit = "week"
        if b_end is not None:
            b_end = b_end + timedelta(days=6)
    else:
        target = _per_day(task.habit_frequency)
        hits = {date.fromisoformat(l.date) for l in logs if (l.count or 0) >= target}
        current, best, b_start, b_end = _runs(hits, timedelta(days=1), today)
        done_now = today in hits
        # Today only counts against you once it's over.
        eligible = (today - start).days + (1 if done_now else 0)
        done = sum(1 for d in hits if start <= d <= today)
        rate = round(100 * done / eligible) if eligible > 0 else None
        unit = "day"

    last = max(log_days) if log_days else None
    return {
        "id": task.id, "title": task.title,
        "habit_frequency": task.habit_frequency or "daily",
        "unit": unit, "done_now": done_now,
        "current_streak": current, "best_streak": best,
        "best_start": b_start.isoformat() if b_start else None,
        "best_end": b_end.isoformat() if b_end else None,
        "rate_30d": rate,
        "total_checkins": sum(l.count or 0 for l in logs),
        "last_done": last.isoformat() if last else None,
    }


def goal_stats(db: Session, goal: Goal, today: date | None = None) -> dict:
    today = today or date.today()
    goal_ids = [goal.id] + [g.id for g in db.query(Goal.id).filter(
        Goal.parent_id == goal.id, Goal.trashed_at.is_(None))]
    tasks = db.query(Task).filter(Task.goal_id.in_(goal_ids), Task.trashed_at.is_(None)).all()
    task_ids = [t.id for t in tasks]
    goal_start = _local_date(goal.created_at) if goal.created_at else today

    habits = [t for t in tasks if t.goal_id == goal.id and is_habit(t, goal.type)]
    habit_ids = {t.id for t in habits}
    habit_logs = db.query(HabitLog).filter(HabitLog.task_id.in_(habit_ids)).all() if habit_ids else []
    completions = db.query(ExecutionLog).filter(ExecutionLog.task_id.in_(task_ids)).all() if task_ids else []

    # Daily activity: check-ins + completions per local date.
    activity: dict[date, dict] = {}
    for l in habit_logs:
        if (l.count or 0) > 0:
            a = activity.setdefault(date.fromisoformat(l.date), {"checkins": 0, "completed": 0})
            a["checkins"] += l.count
    for c in completions:
        if c.completed_at:
            a = activity.setdefault(_local_date(c.completed_at), {"checkins": 0, "completed": 0})
            a["completed"] += 1
    active_days = {d for d in activity if d <= today}
    current, best, b_start, b_end = _runs(active_days, timedelta(days=1), today)

    # Per-habit stats (active habits only; retired = marked done).
    logs_by_habit: dict[str, list[HabitLog]] = {}
    for l in habit_logs:
        logs_by_habit.setdefault(l.task_id, []).append(l)
    habit_rows = [_habit_stats(t, logs_by_habit.get(t.id, []), today)
                  for t in sorted(habits, key=lambda t: t.sort_order or 0) if t.status != "done"]

    # Consistency: mean habit rate for resolutions with habits, otherwise share of
    # days active since the goal started (capped to the window).
    window_start = today - timedelta(days=WINDOW_DAYS - 1)
    rated = [h["rate_30d"] for h in habit_rows if h["rate_30d"] is not None]
    active_30 = sum(1 for d in active_days if d >= window_start)
    if rated:
        consistency = round(sum(rated) / len(rated))
        basis = "habits"
    else:
        span = (today - max(goal_start, window_start)).days + (1 if today in active_days else 0)
        consistency = round(100 * active_30 / span) if span > 0 else None
        basis = "active_days"
    days_window = min(WINDOW_DAYS, (today - goal_start).days + 1)

    # Heatmap: HEATMAP_WEEKS full weeks ending with this week (Mon-first).
    heat_start = _week_start(today) - timedelta(weeks=HEATMAP_WEEKS - 1)
    heatmap = []
    d = heat_start
    while d <= _week_start(today) + timedelta(days=6):
        a = activity.get(d, {"checkins": 0, "completed": 0})
        heatmap.append({"date": d.isoformat(), "count": a["checkins"] + a["completed"],
                        "future": d > today})
        d += timedelta(days=1)

    # Weekly trend: active days per week for the last TREND_WEEKS weeks.
    trend = []
    for i in range(TREND_WEEKS - 1, -1, -1):
        ws = _week_start(today) - timedelta(weeks=i)
        days = [ws + timedelta(days=k) for k in range(7)]
        trend.append({
            "week_start": ws.isoformat(),
            "active_days": sum(1 for x in days if x in active_days),
            "elapsed_days": sum(1 for x in days if x <= today),
            "events": sum(activity[x]["checkins"] + activity[x]["completed"] for x in days if x in activity),
        })

    # Time logged on the goal's tasks (task timers) and linked work tickets.
    task_secs = sum(s.duration_seconds or 0 for s in db.query(WorkSession).filter(
        WorkSession.task_id.in_(task_ids), WorkSession.ended_at.isnot(None))) if task_ids else 0
    ticket_secs = sum(e.duration_seconds or 0 for e in db.query(WorkTimeEntry)
                      .join(WorkTicket, WorkTimeEntry.ticket_id == WorkTicket.id)
                      .filter(WorkTicket.linked_goal_id.in_(goal_ids)))

    last_active = max(active_days) if active_days else None
    return {
        "goal_id": goal.id,
        "type": goal.type,
        "today": today.isoformat(),
        "started": goal_start.isoformat(),
        "days_since_start": (today - goal_start).days + 1,
        "current_streak": current,
        "best_streak": best,
        "best_start": b_start.isoformat() if b_start else None,
        "best_end": b_end.isoformat() if b_end else None,
        "active_today": today in active_days,
        "consistency_30d": consistency,
        "consistency_basis": basis,
        "active_days_30d": active_30,
        "window_days": days_window,
        "active_days_total": len(active_days),
        "last_active": last_active.isoformat() if last_active else None,
        "total_checkins": sum(l.count or 0 for l in habit_logs),
        "tasks_completed": len(completions),
        "tasks_done": sum(1 for t in tasks if t.status == "done" and t.id not in habit_ids),
        "tasks_total": sum(1 for t in tasks if t.id not in habit_ids),
        "time_logged_seconds": task_secs + ticket_secs,
        "habits": habit_rows,
        "heatmap": heatmap,
        "trend": trend,
    }
