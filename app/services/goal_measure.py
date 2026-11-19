"""How close a goal is, and whether its system is working.

A goal with a measure has one number going from `metric_start` to `metric_target`
(optionally by `metric_target_date`). Two things are read every week:

  outcome — the number itself: a weekly check-in (manual), or counted by the app since
            the start date (habit check-ins, completed tasks, hours logged).
  system  — the goal's habits: check-ins done against the weekly targets.

From those: progress (% of the way), pace (weeks ahead of / behind a straight line to
the target date), a projection (arrival date at the rate of the last four weeks) and a
diagnosis that compares the two — the number is moving or flat, the system was kept or not.
"""
import math
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models.execution_log import ExecutionLog
from app.models.goal import Goal, GoalCheckin
from app.models.habit_log import HabitLog
from app.models.task import Task, is_habit
from app.models.work_session import WorkSession
from app.models.work_ticket import WorkTicket, WorkTimeEntry
from app.services.goal_stats import _created, _local_date, _per_day, _per_week, _week_start

SYSTEM_WEEKS = 12
RECENT_DAYS = 28          # the projection reads the last four weeks
ON_PACE_WEEKS = 0.5       # within half a week of the line counts as on pace
KEPT_PCT = 70             # system counts as kept from here up
MOVING_SHARE = 0.75       # share of the needed rate that counts as moving
FAR_DAYS = 3650           # a projection further out than this is "not at this rate"

DIAGNOSES = {
    "reached": ("Target reached", "You got there. Close the goal as achieved, or set the next target."),
    "need_data": ("Check in to see your pace", "One number a week is enough. After the first check-in you get pace and a projected date."),
    "keep_going": ("Working: keep going", "You are keeping the system and the number is moving. Change nothing."),
    "change_system": ("The system is not moving the number", "You did the work and the number stayed flat. The habits are the wrong ones, or too small: change the system, not the effort."),
    "execution": ("The system is not being kept", "The number is flat because the habits are not happening. Make the system smaller until you keep it, then build back up."),
    "easy_or_luck": ("Moving without the system", "The number is moving although the habits are not kept. Either the target is too easy or something else is driving it: find out what."),
    "moving_no_system": ("Moving, with no system on record", "Add the habits that drive this number, so you can tell what is working."),
    "system_new": ("Too early to judge the system", "The habits on this goal are less than a week old. Keep them this week; the next check-in shows whether they move the number."),
    "no_system": ("No system yet", "Nothing is moving this number. Add the weekly habits that should."),
}


def _iso(s: str | None) -> date | None:
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        return None


def _num(x: float) -> float:
    return round(x, 2)


def _family(db: Session, goal: Goal) -> list[str]:
    return [goal.id] + [g.id for g in db.query(Goal.id).filter(Goal.parent_id == goal.id, Goal.trashed_at.is_(None))]


def _habits(db: Session, goal: Goal) -> list[Task]:
    tasks = db.query(Task).filter(Task.goal_id == goal.id, Task.trashed_at.is_(None)).all()
    return [t for t in tasks if is_habit(t, goal.type) and t.status != "done"]


def _events(db: Session, goal: Goal, source: str) -> list[tuple[date, float]]:
    """(day, amount) for a counted metric: every habit check-in, completed task or hour logged."""
    goal_ids = _family(db, goal)
    tasks = db.query(Task).filter(Task.goal_id.in_(goal_ids), Task.trashed_at.is_(None)).all()
    habit_ids = {t.id for t in tasks if t.goal_id == goal.id and is_habit(t, goal.type)}
    task_ids = [t.id for t in tasks]
    out: list[tuple[date, float]] = []
    if source == "checkins" and habit_ids:
        for log in db.query(HabitLog).filter(HabitLog.task_id.in_(habit_ids)):
            if (log.count or 0) > 0 and _iso(log.date):
                out.append((_iso(log.date), float(log.count)))
    elif source == "tasks" and task_ids:
        for log in db.query(ExecutionLog).filter(ExecutionLog.task_id.in_(task_ids)):
            if log.completed_at and log.task_id not in habit_ids:
                out.append((_local_date(log.completed_at), 1.0))
    elif source == "hours":
        if task_ids:
            for s in db.query(WorkSession).filter(WorkSession.task_id.in_(task_ids), WorkSession.ended_at.isnot(None)):
                out.append((_local_date(s.started_at), (s.duration_seconds or 0) / 3600))
        entries = (db.query(WorkTimeEntry).join(WorkTicket, WorkTimeEntry.ticket_id == WorkTicket.id)
                   .filter(WorkTicket.linked_goal_id.in_(goal_ids)))
        for e in entries:
            if _iso(e.logged_at):
                out.append((_iso(e.logged_at), (e.duration_seconds or 0) / 3600))
    return out


def _points(db: Session, goal: Goal, start_date: date, today: date) -> list[dict]:
    """The number over time, oldest first; the first point is the start value on the start date."""
    points = [{"id": None, "date": start_date.isoformat(), "value": _num(goal.metric_start or 0), "note": ""}]
    source = goal.metric_source or "manual"
    if source == "manual":
        rows = db.query(GoalCheckin).filter(GoalCheckin.goal_id == goal.id).order_by(GoalCheckin.date).all()
        points += [{"id": r.id, "date": r.date, "value": _num(r.value), "note": r.note or ""}
                   for r in rows if start_date.isoformat() <= r.date <= today.isoformat()]
        return points
    events = [(d, a) for d, a in _events(db, goal, source) if start_date <= d <= today]
    ws = _week_start(start_date)
    while ws <= today:
        end = min(ws + timedelta(days=6), today)
        if end > start_date:
            total = (goal.metric_start or 0) + sum(a for d, a in events if d <= end)
            points.append({"id": None, "date": end.isoformat(), "value": _num(total), "note": ""})
        ws += timedelta(weeks=1)
    return points


def _system_weeks(db: Session, habits: list[Task], today: date) -> list[dict]:
    """Habit check-ins done against the weekly targets, for the last SYSTEM_WEEKS weeks.
    A week only asks for the days the habit existed and that are already over."""
    ids = [h.id for h in habits]
    logs = db.query(HabitLog).filter(HabitLog.task_id.in_(ids)).all() if ids else []
    by_habit: dict[str, dict[date, int]] = {}
    for log in logs:
        d = _iso(log.date)
        if d:
            by_habit.setdefault(log.task_id, {})[d] = log.count or 0
    weeks = []
    this_week = _week_start(today)
    for i in range(SYSTEM_WEEKS - 1, -1, -1):
        ws = this_week - timedelta(weeks=i)
        done = planned = 0
        for h in habits:
            per_day = _per_day(h.habit_frequency)
            # Today only counts against you once it is over (but counts for you once done).
            done_today = by_habit.get(h.id, {}).get(today, 0) >= per_day
            last = min(ws + timedelta(days=6), today if done_today else today - timedelta(days=1))
            first = max(ws, _created(h, ws))
            avail = (last - first).days + 1
            if avail <= 0:
                continue
            target = _per_week(h.habit_frequency) or 7
            want = round(target * avail / 7)
            hits = sum(1 for d, n in by_habit.get(h.id, {}).items() if first <= d <= last and n >= per_day)
            planned += want
            done += min(hits, want)
        weeks.append({"week_start": ws.isoformat(), "done": done, "planned": planned,
                      "pct": round(100 * done / planned) if planned else None, "partial": ws == this_week})
    return weeks


def _diagnosis(key: str) -> dict:
    title, text = DIAGNOSES[key]
    return {"key": key, "title": title, "text": text}


def measure(db: Session, goal: Goal, today: date | None = None) -> dict:
    today = today or date.today()
    habits = _habits(db, goal)
    base = {"goal_id": goal.id, "title": goal.title, "icon": goal.icon, "type": goal.type,
            "defined": goal.metric_target is not None, "habits_count": len(habits)}
    if not base["defined"]:
        return base

    start, target = goal.metric_start or 0.0, goal.metric_target
    span = target - start
    start_date = _iso(goal.metric_start_date) or (_local_date(goal.created_at) if goal.created_at else today)
    target_date = _iso(goal.metric_target_date)
    source = goal.metric_source or "manual"

    points = _points(db, goal, start_date, today)
    latest = points[-1]
    current, current_date = latest["value"], _iso(latest["date"])
    progress = (current - start) / span if span else 0.0
    reached = progress >= 1

    # Pace: where a straight line from start to target would be today.
    pace = expected = required_weekly = None
    if target_date and target_date > start_date:
        total_days = (target_date - start_date).days
        frac = min(max((today - start_date).days / total_days, 0.0), 1.0)
        expected = _num(start + span * frac)
        weeks_delta = (progress - frac) * total_days / 7
        if reached:
            status = "reached"
        elif today > target_date:
            status = "overdue"
        elif abs(weeks_delta) < ON_PACE_WEEKS:
            status = "on_pace"
        else:
            status = "ahead" if weeks_delta > 0 else "behind"
        pace = {"status": status, "weeks": round(abs(weeks_delta), 1),
                "days_left": max((target_date - today).days, 0)}
        if not reached and target_date > today:
            required_weekly = _num((target - current) / ((target_date - today).days / 7))

    # Projection: the rate of the last four weeks, carried forward.
    projection = None
    moving = reached
    if len(points) >= 2:
        cutoff = current_date - timedelta(days=RECENT_DAYS)
        ref = next((p for p in reversed(points[:-1]) if _iso(p["date"]) <= cutoff), points[0])
        days = (current_date - _iso(ref["date"])).days
        if days >= 1:
            rate_day = (current - ref["value"]) / days
            toward = rate_day * span > 0
            arrive = None
            if toward and not reached:
                left = math.ceil((target - current) / rate_day)
                arrive = (current_date + timedelta(days=left)).isoformat() if left <= FAR_DAYS else None
            projection = {"weekly_rate": _num(rate_day * 7), "toward": toward, "date": arrive,
                          "since": ref["date"]}
            if not reached:
                needed = abs(span) / (target_date - start_date).days if pace else 0.0
                moving = toward and abs(rate_day) >= MOVING_SHARE * needed

    weeks = _system_weeks(db, habits, today)
    recent = [w for w in weeks[-4:] if w["planned"]]
    system_pct = round(100 * sum(w["done"] for w in recent) / sum(w["planned"] for w in recent)) if recent else None

    if reached:
        key = "reached"
    elif projection is None:
        key = "need_data"
    elif system_pct is None:
        key = "system_new" if habits else "moving_no_system" if moving else "no_system"
    elif system_pct >= KEPT_PCT:
        key = "keep_going" if moving else "change_system"
    else:
        key = "easy_or_luck" if moving else "execution"

    this_week = _week_start(today).isoformat()
    checked_in = source != "manual" or any(p["id"] and _week_start(_iso(p["date"])).isoformat() == this_week for p in points)
    return {
        **base,
        "name": goal.metric_name or "", "unit": goal.metric_unit or "", "source": source,
        "start": _num(start), "target": _num(target),
        "start_date": start_date.isoformat(), "target_date": target_date.isoformat() if target_date else None,
        "today": today.isoformat(),
        "current": current, "current_date": latest["date"],
        "progress_pct": round(100 * min(max(progress, 0.0), 1.0)),
        "expected": expected, "required_weekly": required_weekly,
        "pace": pace, "projection": projection,
        "points": points, "weeks": weeks, "system_pct": system_pct,
        "checked_in_this_week": checked_in,
        "diagnosis": _diagnosis(key),
    }


def measures(db: Session, today: date | None = None) -> list[dict]:
    """The measure of every open goal that has one."""
    goals = (db.query(Goal).filter(Goal.metric_target.isnot(None), Goal.archived_at.is_(None),
                                   Goal.trashed_at.is_(None)).order_by(Goal.created_at).all())
    return [measure(db, g, today) for g in goals]
