import re
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.execution_log import ExecutionLog
from app.models.goal import Goal
from app.models.habit_log import HabitLog
from app.models.task import Task

router = APIRouter(prefix="/review", tags=["review"])


def _weekly_target(freq: str | None) -> int:
    """Return the number of check-ins expected per week for the given frequency."""
    if not freq or freq == "daily":
        return 7
    m = re.match(r"^(\d+)x_week$", freq)
    if m:
        return int(m.group(1))
    # Nx_day — still expected every day (count per day tracked separately)
    return 7


class HabitWeekStat(BaseModel):
    id: str
    title: str
    goal_title: str
    habit_frequency: str
    days_checked: int
    weekly_target: int
    pct: int
    on_track: bool
    streak: int
    checkins: list[str]


class CompletedTask(BaseModel):
    title: str
    goal_title: str
    completed_at: str


class WeeklyReview(BaseModel):
    week_start: str
    week_end: str
    week_dates: list[str]
    habits: list[HabitWeekStat]
    tasks_completed: list[CompletedTask]
    overall_habit_pct: int
    habits_on_track: int
    grade: str


def _grade(pct: int) -> str:
    if pct >= 90: return "Excellent week"
    if pct >= 70: return "Strong week"
    if pct >= 50: return "Solid progress"
    if pct >= 30: return "Keep pushing"
    return "Room to grow"


def _streak(task_id: str, today: date, db: Session) -> int:
    logs = db.query(HabitLog).filter(HabitLog.task_id == task_id).all()
    log_dates = {log.date for log in logs}
    check = today
    streak = 0
    while check.isoformat() in log_dates:
        streak += 1
        check -= timedelta(days=1)
    return streak


@router.get("/weekly", response_model=WeeklyReview)
def weekly_review(db: Session = Depends(get_db)):
    today = date.today()
    week_dates = [(today - timedelta(days=i)) for i in range(6, -1, -1)]
    week_strs = [d.isoformat() for d in week_dates]
    week_start, week_end = week_strs[0], week_strs[-1]

    # Habit stats
    resolution_goals = (
        db.query(Goal)
        .filter(Goal.type == "resolution", Goal.archived_at.is_(None))
        .options(joinedload(Goal.tasks))
        .all()
    )
    habit_stats: list[HabitWeekStat] = []
    for goal in resolution_goals:
        for task in goal.tasks:
            if task.status == "done":
                continue
            logs = (
                db.query(HabitLog)
                .filter(HabitLog.task_id == task.id, HabitLog.date >= week_start)
                .all()
            )
            checkins = [log.date for log in logs]
            days = len(checkins)
            target = _weekly_target(task.habit_frequency)
            pct = min(round((days / target) * 100), 100)
            habit_stats.append(HabitWeekStat(
                id=task.id,
                title=task.title,
                goal_title=goal.title,
                habit_frequency=task.habit_frequency or "daily",
                days_checked=days,
                weekly_target=target,
                pct=pct,
                on_track=days >= target,
                streak=_streak(task.id, today, db),
                checkins=checkins,
            ))

    # Tasks completed this week
    week_start_dt = datetime.combine(week_dates[0], datetime.min.time())
    exec_logs = (
        db.query(ExecutionLog)
        .filter(ExecutionLog.completed_at >= week_start_dt)
        .options(joinedload(ExecutionLog.task).joinedload(Task.goal))
        .all()
    )
    completed_tasks = [
        CompletedTask(
            title=log.task.title,
            goal_title=log.task.goal.title if log.task.goal else "—",
            completed_at=log.completed_at.strftime("%b %d"),
        )
        for log in exec_logs
        if log.task and log.task.goal
    ]

    # Overall habit % — weighted by each habit's target
    if habit_stats:
        total_possible = sum(h.weekly_target for h in habit_stats)
        total_done = sum(min(h.days_checked, h.weekly_target) for h in habit_stats)
        overall_pct = round((total_done / total_possible) * 100)
    else:
        overall_pct = 0

    on_track_count = sum(1 for h in habit_stats if h.on_track)

    return WeeklyReview(
        week_start=week_start,
        week_end=week_end,
        week_dates=week_strs,
        habits=habit_stats,
        tasks_completed=completed_tasks,
        overall_habit_pct=overall_pct,
        habits_on_track=on_track_count,
        grade=_grade(overall_pct),
    )
