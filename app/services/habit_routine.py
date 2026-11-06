"""Habit routines: which habits sit on a given day's planner, and at what time.

A habit reaches a day's planner two ways: placed by hand for that day (a
``HabitDayPlan`` row, BAS-050) or by its routine — the weekdays in
``Task.routine_days`` ("mon,wed,fri") at its default ``scheduled_time``. A
routine habit taken off one day keeps a day-plan row flagged ``skipped`` so the
routine does not put it straight back. Read-only: never writes.
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from app.models.goal import Goal
from app.models.habit_day_plan import HabitDayPlan
from app.models.task import Task, habit_row_filter

WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def parse_routine_days(value) -> list[str]:
    """Normalise a stored string or a submitted list to ordered weekday tokens."""
    if not value:
        return []
    raw = value.split(",") if isinstance(value, str) else list(value)
    tokens = {str(t).strip().lower()[:3] for t in raw if str(t).strip()}
    bad = tokens - set(WEEKDAYS)
    if bad:
        raise ValueError(f"Unknown weekday: {', '.join(sorted(bad))}")
    return [d for d in WEEKDAYS if d in tokens]


def routine_days_to_str(days) -> str | None:
    tokens = parse_routine_days(days)
    return ",".join(tokens) if tokens else None


def weekday_token(day: date) -> str:
    return WEEKDAYS[day.weekday()]


def routine_covers(task: Task, day: date) -> bool:
    return weekday_token(day) in parse_routine_days(task.routine_days)


@dataclass
class Placement:
    task: Task
    goal_title: str
    scheduled_time: str | None
    routine: bool          # put here by the habit's routine (not only by hand)


def habit_placements(db: Session, day: date) -> dict[str, Placement]:
    """{habit id: placement} for every habit on ``day``'s planner: hand-placed rows
    that are not skipped, plus routine habits whose weekdays include ``day``.
    Only live habits count (not trashed or done, goal active)."""
    day_iso = day.isoformat()
    token = weekday_token(day)
    live = (
        Task.trashed_at.is_(None), Task.status != "done",
        Goal.type == "resolution", Goal.archived_at.is_(None), Goal.trashed_at.is_(None),
        habit_row_filter(),
    )
    plans = {
        p.task_id: p
        for p in db.query(HabitDayPlan).filter(HabitDayPlan.date == day_iso).all()
    }
    out: dict[str, Placement] = {}
    if plans:
        for t, goal_title in (
            db.query(Task, Goal.title).join(Goal, Task.goal_id == Goal.id)
            .filter(Task.id.in_(list(plans)), *live).all()
        ):
            plan = plans[t.id]
            if plan.skipped:
                continue
            out[t.id] = Placement(t, goal_title, plan.scheduled_time or t.scheduled_time,
                                  token in parse_routine_days(t.routine_days))
    for t, goal_title in (
        db.query(Task, Goal.title).join(Goal, Task.goal_id == Goal.id)
        .filter(Task.routine_days.isnot(None), Task.routine_days.like(f"%{token}%"), *live).all()
    ):
        if t.id in out or t.id in plans:       # already placed, or skipped for this day
            continue
        if token in parse_routine_days(t.routine_days):
            out[t.id] = Placement(t, goal_title, t.scheduled_time, True)
    return out
