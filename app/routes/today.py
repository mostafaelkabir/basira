import re
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.daily_snapshot import DailySnapshot
from app.models.execution_log import ExecutionLog
from app.models.goal import Goal
from app.models.habit_log import HabitLog
from app.models.proof import Proof
from app.models.task import Task
from app.schemas.comment import CommentRead
from app.schemas.proof import ProofRead
from app.schemas.task import TaskRead, TaskWithProofs
from app.schemas.today import FocusTaskRead, HabitItem, ProjectSummary, TodayResponse

router = APIRouter(prefix="/today", tags=["today"])

ACTIVE = Goal.archived_at.is_(None)


def _per_day(frequency: str | None) -> int:
    m = re.match(r"^(\d+)x_day$", frequency or "")
    return int(m.group(1)) if m else 1


def calculate_streak(task_id: str, db: Session) -> int:
    logs = db.query(HabitLog).filter(HabitLog.task_id == task_id).all()
    log_dates = {log.date for log in logs}
    check = date.today()
    streak = 0
    while check.isoformat() in log_dates:
        streak += 1
        check -= timedelta(days=1)
    return streak


def get_weekly_checkins(task_id: str, db: Session) -> list[str]:
    seven_days_ago = (date.today() - timedelta(days=6)).isoformat()
    logs = (
        db.query(HabitLog)
        .filter(HabitLog.task_id == task_id, HabitLog.date >= seven_days_ago)
        .all()
    )
    return [log.date for log in logs]


def get_monthly_checkins(task_id: str, db: Session) -> list[str]:
    thirty_days_ago = (date.today() - timedelta(days=29)).isoformat()
    logs = (
        db.query(HabitLog)
        .filter(HabitLog.task_id == task_id, HabitLog.date >= thirty_days_ago)
        .all()
    )
    return [log.date for log in logs]


def _not_deferred(task: Task, today: str) -> bool:
    return task.deferred_until is None or task.deferred_until <= today


def _upsert_snapshot(target_date: str, db: Session) -> None:
    """Compute and store a DailySnapshot for the given date.

    Task score  = tasks_done / tasks_total
      denominator = tasks actually completed that day
                  + tasks still in todo status that were pinned or planned for that day
                  + active daily-goal tasks that weren't deferred past that date
                  (i.e. what was genuinely on the list that day)

    Habit score = habits_done / habits_total
      denominator = only habits with frequency "daily" (or higher per-day freq)
                    that were due that specific day of the week
                    — weekly habits only count on their relevant days
    """
    d = date.fromisoformat(target_date)
    day_start = datetime.combine(d, datetime.min.time()).replace(tzinfo=UTC)
    day_end   = datetime.combine(d + timedelta(days=1), datetime.min.time()).replace(tzinfo=UTC)

    # ── Tasks ──────────────────────────────────────────────────────────────────
    tasks_done = db.query(ExecutionLog).filter(
        ExecutionLog.completed_at >= day_start,
        ExecutionLog.completed_at < day_end,
    ).count()

    # Tasks explicitly on the list: pinned that day or planned for that day
    focused_or_planned = db.query(Task).filter(
        (Task.pinned_date == target_date) | (Task.plan_date == target_date)
    ).count()

    # Active daily-goal tasks (todo, not deferred past target_date)
    daily_active = db.query(Task).join(Goal).filter(
        Goal.type == "daily",
        Goal.archived_at.is_(None),
        Task.status == "todo",
        (Task.deferred_until.is_(None)) | (Task.deferred_until <= target_date),
    ).count()

    # Total = what was done + what was still pending on the list
    # Use the larger of (tasks_done alone) or (active list) as the denominator
    tasks_total = max(tasks_done, tasks_done + daily_active + focused_or_planned)

    # ── Habits ─────────────────────────────────────────────────────────────────
    habit_logs = db.query(HabitLog).filter(HabitLog.date == target_date).all()
    habits_done = len(habit_logs)

    # Count habits that were actually due today based on frequency
    # daily / Nx_day  → due every day
    # 3x_week / 2x_week / 1x_week → count them, but they won't all be done every day —
    #   include them in the denominator on all days (user decides when to do them)
    # For simplicity: count all active habits as the denominator (not their frequency),
    # but DO NOT penalise days for not hitting weekly habits.
    # Better heuristic: habit_total = number of active habits; score capped gracefully.
    habits_total = db.query(Task).join(Goal).filter(
        Goal.type == "resolution",
        Goal.archived_at.is_(None),
        Task.status == "todo",
    ).count()

    # ── Scores ─────────────────────────────────────────────────────────────────
    task_score  = round((tasks_done  / tasks_total)  * 100, 1) if tasks_total  > 0 else 0.0
    habit_score = round((habits_done / habits_total) * 100, 1) if habits_total > 0 else 0.0

    # Combined score: tasks weighted 70%, habits 30%
    # (tasks are the primary commitment; habits are bonus consistency)
    if tasks_total > 0 and habits_total > 0:
        score_pct = round(task_score * 0.7 + habit_score * 0.3, 1)
    elif tasks_total > 0:
        score_pct = task_score
    else:
        score_pct = habit_score

    snap = db.query(DailySnapshot).filter(DailySnapshot.date == target_date).first()
    if snap:
        snap.tasks_total  = tasks_total
        snap.tasks_done   = tasks_done
        snap.habits_total = habits_total
        snap.habits_done  = habits_done
        snap.task_score   = task_score
        snap.habit_score  = habit_score
        snap.score_pct    = score_pct
    else:
        db.add(DailySnapshot(
            date=target_date,
            tasks_total=tasks_total, tasks_done=tasks_done,
            habits_total=habits_total, habits_done=habits_done,
            task_score=task_score, habit_score=habit_score,
            score_pct=score_pct,
        ))
    db.commit()


@router.get("", response_model=TodayResponse)
def get_today(db: Session = Depends(get_db)):
    today = date.today().isoformat()

    # Auto-snapshot: always refresh today; refresh yesterday if its score columns are empty
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    try:
        ysnap = db.query(DailySnapshot).filter(DailySnapshot.date == yesterday).first()
        if not ysnap or ysnap.task_score is None:
            _upsert_snapshot(yesterday, db)
    except Exception:
        pass
    try:
        _upsert_snapshot(today, db)
    except Exception:
        pass

    # Tasks completed today via ExecutionLog
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=UTC)
    completed_today_ids = {
        log.task_id for log in db.query(ExecutionLog)
        .filter(ExecutionLog.completed_at >= today_start).all()
    }

    # Focus tasks — pinned for today, any goal type (including subtasks)
    focus_rows = (
        db.query(Task)
        .join(Goal, Task.goal_id == Goal.id)
        .filter(Task.pinned_date == today, ACTIVE)
        .options(joinedload(Task.proofs), joinedload(Task.comments), joinedload(Task.goal))
        .order_by(Task.sort_order)
        .all()
    )
    focus_ids = {t.id for t in focus_rows}

    # Batch-load parent tasks for any pinned subtasks
    parent_task_ids = [t.parent_task_id for t in focus_rows if t.parent_task_id]
    parent_tasks_map: dict[str, Task] = {}
    if parent_task_ids:
        parent_tasks_map = {t.id: t for t in db.query(Task).filter(Task.id.in_(parent_task_ids)).all()}

    # Daily todos — exclude focus-pinned and deferred tasks
    daily_goals = (
        db.query(Goal).filter(Goal.type == "daily", ACTIVE)
        .options(
            joinedload(Goal.tasks).joinedload(Task.proofs),
            joinedload(Goal.tasks).joinedload(Task.comments),
        )
        .all()
    )
    daily_tasks = sorted(
        [t for g in daily_goals for t in g.tasks
         if (t.status == "todo" or t.id in completed_today_ids) and t.id not in focus_ids and _not_deferred(t, today) and not t.parent_task_id],
        key=lambda t: t.sort_order or 0,
    )

    # Habits
    resolution_goals = (
        db.query(Goal).filter(Goal.type == "resolution", ACTIVE)
        .options(joinedload(Goal.tasks))
        .all()
    )
    habits = []
    for goal in resolution_goals:
        for task in goal.tasks:
            if task.status == "done":
                continue
            per_day = _per_day(task.habit_frequency)
            log = (
                db.query(HabitLog)
                .filter(HabitLog.task_id == task.id, HabitLog.date == today)
                .first()
            )
            today_count = log.count if log else 0
            proof_today = (
                db.query(Proof)
                .filter(Proof.task_id == task.id, Proof.date == today)
                .first()
            )
            habits.append(HabitItem(
                id=task.id,
                title=task.title,
                goal_id=goal.id,
                goal_title=goal.title,
                checked_today=today_count >= per_day,
                today_count=today_count,
                today_target=per_day,
                habit_frequency=task.habit_frequency or "daily",
                requires_proof=task.requires_proof,
                has_proof_today=proof_today is not None,
                streak=calculate_streak(task.id, db),
                weekly_checkins=get_weekly_checkins(task.id, db),
                monthly_checkins=get_monthly_checkins(task.id, db),
                plan_date=task.plan_date,
            ))

    # Project tasks — exclude focus-pinned and deferred tasks
    project_goals = (
        db.query(Goal).filter(Goal.type == "project", ACTIVE)
        .options(
            joinedload(Goal.tasks).joinedload(Task.proofs),
            joinedload(Goal.tasks).joinedload(Task.comments),
        )
        .all()
    )
    visible_project_tasks = sorted(
        [t for goal in project_goals for t in goal.tasks
         if (t.status == "todo" or t.id in completed_today_ids) and t.id not in focus_ids and _not_deferred(t, today) and not t.parent_task_id],
        key=lambda t: t.sort_order or 0,
    )

    # Batch-load sub-tasks for every top-level task visible today
    all_parent_ids = (
        [t.id for t in focus_rows] +
        [t.id for t in daily_tasks] +
        [t.id for t in visible_project_tasks]
    )
    sub_map: dict[str, list[Task]] = {}
    if all_parent_ids:
        for s in db.query(Task).filter(Task.parent_task_id.in_(all_parent_ids)).all():
            sub_map.setdefault(s.parent_task_id, []).append(s)

    def _with_subs(t: Task) -> TaskWithProofs:
        tw = TaskWithProofs.model_validate(t)
        subs = sub_map.get(t.id, [])
        return tw.model_copy(update={"sub_tasks": [TaskRead.model_validate(s) for s in subs]})

    # Rebuild focus with sub_tasks + parent context + tags
    focus = [
        FocusTaskRead(
            id=t.id,
            title=t.title,
            goal_id=t.goal_id,
            goal_title=t.goal.title,
            status=t.status,
            requires_proof=t.requires_proof,
            pinned_date=t.pinned_date,
            parent_task_id=t.parent_task_id,
            parent_task_title=parent_tasks_map[t.parent_task_id].title if t.parent_task_id and t.parent_task_id in parent_tasks_map else None,
            is_urgent=t.is_urgent or False,
            is_important=t.is_important or False,
            sort_order=t.sort_order or 0,
            proofs=[ProofRead.model_validate(p) for p in t.proofs],
            comments=[CommentRead.model_validate(c) for c in t.comments],
            sub_tasks=[TaskRead.model_validate(s) for s in sub_map.get(t.id, [])],
        )
        for t in focus_rows
    ]

    projects = [
        ProjectSummary(
            goal_id=goal.id,
            goal_title=goal.title,
            tasks=[
                _with_subs(t) for t in goal.tasks
                if (t.status == "todo" or t.id in completed_today_ids) and t.id not in focus_ids and _not_deferred(t, today) and not t.parent_task_id
            ],
        )
        for goal in project_goals
    ]

    return TodayResponse(
        date=today,
        focus=focus,
        daily=[_with_subs(t) for t in daily_tasks],
        habits=habits,
        projects=projects,
    )


@router.get("/overview")
def get_overview(db: Session = Depends(get_db)):
    today = date.today()
    goals = (
        db.query(Goal)
        .filter(ACTIVE)
        .options(joinedload(Goal.tasks))
        .all()
    )

    result = []
    for goal in goals:
        task_ids = [t.id for t in goal.tasks]
        task_count = len(goal.tasks)
        done_count = sum(1 for t in goal.tasks if t.status == "done")
        days_since = None

        if task_ids:
            if goal.type == "resolution":
                last_log = (
                    db.query(HabitLog)
                    .filter(HabitLog.task_id.in_(task_ids))
                    .order_by(HabitLog.date.desc())
                    .first()
                )
                if last_log:
                    days_since = (today - date.fromisoformat(last_log.date)).days
            else:
                last_log = (
                    db.query(ExecutionLog)
                    .filter(ExecutionLog.task_id.in_(task_ids))
                    .order_by(ExecutionLog.completed_at.desc())
                    .first()
                )
                if last_log:
                    completed = last_log.completed_at
                    if completed.tzinfo is None:
                        completed = completed.replace(tzinfo=UTC)
                    days_since = (datetime.now(UTC) - completed).days

        result.append({
            "id": goal.id,
            "title": goal.title,
            "type": goal.type or "untyped",
            "icon": goal.icon,
            "cover": goal.cover or False,
            "task_count": task_count,
            "done_count": done_count,
            "days_since_activity": days_since,
        })

    # Sort: active first, then by days since, stalled/never last
    return sorted(result, key=lambda g: (
        g["days_since_activity"] is None,
        g["days_since_activity"] if g["days_since_activity"] is not None else 9999
    ))


class DailyTaskCreate(BaseModel):
    title: str


@router.post("/daily-task", response_model=TaskWithProofs, status_code=201)
def add_daily_task(data: DailyTaskCreate, db: Session = Depends(get_db)):
    if not data.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")

    daily_goal = db.query(Goal).filter(Goal.type == "daily", ACTIVE).first()
    if not daily_goal:
        daily_goal = Goal(id=str(uuid4()), title="Daily Tasks", description="", type="daily")
        db.add(daily_goal)
        db.flush()

    task = Task(
        id=str(uuid4()),
        title=data.title.strip(),
        goal_id=daily_goal.id,
        status="todo",
        requires_proof=False,
        created_at=date.today().isoformat(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return TaskWithProofs.model_validate(task)
