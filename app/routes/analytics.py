from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.daily_snapshot import DailySnapshot
from app.models.defer_log import DeferLog
from app.models.execution_log import ExecutionLog
from app.models.goal import Goal
from app.models.habit_log import HabitLog
from app.models.task import Task

router = APIRouter(prefix="/analytics", tags=["analytics"])

ACTIVE = Goal.archived_at.is_(None)
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


@router.get("")
def get_analytics(db: Session = Depends(get_db)):
    today = date.today()
    today_iso = today.isoformat()

    # ── Date ranges ────────────────────────────────────────────────────────────
    day7_ago  = (today - timedelta(days=6)).isoformat()
    day30_ago = (today - timedelta(days=29)).isoformat()
    week_start = (today - timedelta(days=today.weekday())).isoformat()  # Monday

    # ── Daily snapshots (last 60 days for charts) ───────────────────────────────
    day60_ago = (today - timedelta(days=59)).isoformat()
    snapshots = (
        db.query(DailySnapshot)
        .filter(DailySnapshot.date >= day60_ago)
        .order_by(DailySnapshot.date)
        .all()
    )
    snap_list = [
        {
            "date": s.date,
            "tasks_total": s.tasks_total,
            "tasks_done": s.tasks_done,
            "habits_total": s.habits_total,
            "habits_done": s.habits_done,
            "score_pct": s.score_pct,
            "task_score": s.task_score or 0.0,
            "habit_score": s.habit_score or 0.0,
            "perfect": s.score_pct >= 95,
        }
        for s in snapshots
    ]

    # ── Completion stats from ExecutionLog ──────────────────────────────────────
    logs_30 = db.query(ExecutionLog).filter(
        ExecutionLog.completed_at >= datetime.combine(
            date.fromisoformat(day30_ago), datetime.min.time()
        ).replace(tzinfo=UTC)
    ).all()
    logs_7 = [l for l in logs_30 if l.completed_at.date().isoformat() >= day7_ago]

    tasks_completed_30d = len(logs_30)
    tasks_completed_7d  = len(logs_7)

    # Average per active day (days that had at least 1 completion)
    active_days_30 = len({l.completed_at.date() for l in logs_30})
    active_days_7  = len({l.completed_at.date() for l in logs_7})
    avg_per_active_day_30 = round(tasks_completed_30d / active_days_30, 1) if active_days_30 else 0
    avg_per_active_day_7  = round(tasks_completed_7d  / active_days_7,  1) if active_days_7  else 0

    # Completions by day-of-week (0=Mon … 6=Sun)
    by_dow: dict[int, int] = defaultdict(int)
    for l in logs_30:
        by_dow[l.completed_at.weekday()] += 1
    best_dow_idx = max(by_dow, key=lambda k: by_dow[k]) if by_dow else None
    completions_by_dow = {DAY_NAMES[i]: by_dow.get(i, 0) for i in range(7)}

    # ── Snapshot-based stats ────────────────────────────────────────────────────
    snaps_30 = [s for s in snap_list if s["date"] >= day30_ago and s["date"] < today_iso]
    snaps_7  = [s for s in snap_list if s["date"] >= day7_ago  and s["date"] < today_iso]

    perfect_days_30 = sum(1 for s in snaps_30 if s["perfect"])
    perfect_days_7  = sum(1 for s in snaps_7  if s["perfect"])
    avg_score_30       = round(sum(s["score_pct"]   for s in snaps_30) / len(snaps_30), 1) if snaps_30 else 0
    avg_score_7        = round(sum(s["score_pct"]   for s in snaps_7)  / len(snaps_7),  1) if snaps_7  else 0
    avg_task_score_30  = round(sum(s["task_score"]  for s in snaps_30) / len(snaps_30), 1) if snaps_30 else 0
    avg_task_score_7   = round(sum(s["task_score"]  for s in snaps_7)  / len(snaps_7),  1) if snaps_7  else 0
    avg_habit_score_30 = round(sum(s["habit_score"] for s in snaps_30) / len(snaps_30), 1) if snaps_30 else 0
    avg_habit_score_7  = round(sum(s["habit_score"] for s in snaps_7)  / len(snaps_7),  1) if snaps_7  else 0

    # ── Task lifecycle stats ────────────────────────────────────────────────────
    # Tasks added in last 30 days
    tasks_30 = db.query(Task).filter(Task.created_at >= day30_ago).all()
    tasks_7  = [t for t in tasks_30 if (t.created_at or '') >= day7_ago]

    tasks_added_30d = len(tasks_30)
    tasks_added_7d  = len(tasks_7)

    # Tasks added but still todo (incomplete) — staleness buckets
    todo_tasks = db.query(Task).filter(Task.status == "todo", Task.created_at.isnot(None)).all()
    stale_7d  = [t for t in todo_tasks if t.created_at <= (today - timedelta(days=7)).isoformat()]
    stale_14d = [t for t in todo_tasks if t.created_at <= (today - timedelta(days=14)).isoformat()]
    stale_30d = [t for t in todo_tasks if t.created_at <= (today - timedelta(days=30)).isoformat()]

    # Completion ratio: of tasks added in last 30d, how many were completed?
    added_ids_30 = {t.id for t in tasks_30}
    completed_from_added = sum(1 for l in logs_30 if l.task_id in added_ids_30)
    completion_ratio_30 = round((completed_from_added / tasks_added_30d) * 100) if tasks_added_30d else 0

    # ── Deferral stats ──────────────────────────────────────────────────────────
    defer_logs_30 = db.query(DeferLog).filter(DeferLog.deferred_on >= day30_ago).all()
    defer_logs_7  = [d for d in defer_logs_30 if d.deferred_on >= day7_ago]

    deferrals_30d = len(defer_logs_30)
    deferrals_7d  = len(defer_logs_7)

    # Tasks deferred most often
    defer_count_by_task: dict[str, int] = defaultdict(int)
    for d in defer_logs_30:
        defer_count_by_task[d.task_id] += 1
    top_deferred_ids = sorted(defer_count_by_task, key=lambda k: defer_count_by_task[k], reverse=True)[:5]
    top_deferred_tasks = []
    for tid in top_deferred_ids:
        t = db.query(Task).filter(Task.id == tid).first()
        if t:
            top_deferred_tasks.append({"id": tid, "title": t.title, "defer_count": defer_count_by_task[tid]})

    # ── Habit stats ─────────────────────────────────────────────────────────────
    habit_logs_30 = db.query(HabitLog).filter(HabitLog.date >= day30_ago).all()
    habit_logs_7  = [h for h in habit_logs_30 if h.date >= day7_ago]

    active_habits = db.query(Task).join(Goal).filter(
        Goal.type == "resolution", ACTIVE, Task.status == "todo"
    ).count()

    # Unique days with at least one habit done
    habit_days_30 = len({h.date for h in habit_logs_30})
    habit_days_7  = len({h.date for h in habit_logs_7})

    # ── Weekly breakdown (last 8 weeks) ─────────────────────────────────────────
    weekly = []
    for week_offset in range(7, -1, -1):
        week_end_d   = today - timedelta(days=today.weekday()) - timedelta(weeks=week_offset - 1) - timedelta(days=1)
        week_start_d = week_end_d - timedelta(days=6)
        week_start_iso = week_start_d.isoformat()
        week_end_iso   = week_end_d.isoformat()
        completed = sum(
            1 for l in logs_30
            if week_start_iso <= l.completed_at.date().isoformat() <= week_end_iso
        )
        added = sum(
            1 for t in tasks_30
            if t.created_at and week_start_iso <= t.created_at <= week_end_iso
        )
        weekly.append({
            "week_start": week_start_iso,
            "label": f"{week_start_d.strftime('%b %-d')}",
            "completed": completed,
            "added": added,
        })

    return {
        "snapshots": snap_list,
        "summary": {
            "tasks_completed_7d": tasks_completed_7d,
            "tasks_completed_30d": tasks_completed_30d,
            "tasks_added_7d": tasks_added_7d,
            "tasks_added_30d": tasks_added_30d,
            "completion_ratio_30d": completion_ratio_30,
            "avg_per_active_day_7d": avg_per_active_day_7,
            "avg_per_active_day_30d": avg_per_active_day_30,
            "perfect_days_7d": perfect_days_7,
            "perfect_days_30d": perfect_days_30,
            "avg_score_7d": avg_score_7,
            "avg_score_30d": avg_score_30,
            "avg_task_score_7d": avg_task_score_7,
            "avg_task_score_30d": avg_task_score_30,
            "avg_habit_score_7d": avg_habit_score_7,
            "avg_habit_score_30d": avg_habit_score_30,
            "deferrals_7d": deferrals_7d,
            "deferrals_30d": deferrals_30d,
            "stale_7d_plus": len(stale_7d),
            "stale_14d_plus": len(stale_14d),
            "stale_30d_plus": len(stale_30d),
            "active_habits": active_habits,
            "habit_active_days_7d": habit_days_7,
            "habit_active_days_30d": habit_days_30,
            "best_day_of_week": DAY_NAMES[best_dow_idx] if best_dow_idx is not None else None,
            "completions_by_dow": completions_by_dow,
        },
        "top_deferred_tasks": top_deferred_tasks,
        "stale_tasks": [
            {"id": t.id, "title": t.title, "created_at": t.created_at, "goal_id": t.goal_id,
             "days_old": (today - date.fromisoformat(t.created_at)).days if t.created_at else None}
            for t in sorted(stale_7d, key=lambda t: t.created_at or "")[:10]
        ],
        "weekly_breakdown": weekly,
    }
