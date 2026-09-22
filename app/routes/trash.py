"""Trash: soft-deleted goals and tasks, restorable for 30 days then purged."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.goal import Goal
from app.models.task import Task

router = APIRouter(prefix="/trash", tags=["trash"])

RETENTION_DAYS = 30


def _days_left(trashed_at: datetime | None) -> int:
    if not trashed_at:
        return RETENTION_DAYS
    if trashed_at.tzinfo is None:
        trashed_at = trashed_at.replace(tzinfo=UTC)
    elapsed = (datetime.now(UTC) - trashed_at).days
    return max(0, RETENTION_DAYS - elapsed)


def purge_expired(db: Session) -> int:
    """Permanently delete items trashed more than RETENTION_DAYS ago."""
    cutoff = datetime.now(UTC) - timedelta(days=RETENTION_DAYS)
    removed = 0
    for goal in db.query(Goal).filter(Goal.trashed_at.isnot(None), Goal.trashed_at < cutoff).all():
        db.delete(goal); removed += 1
    for task in db.query(Task).filter(Task.trashed_at.isnot(None), Task.trashed_at < cutoff).all():
        db.delete(task); removed += 1
    if removed:
        db.commit()
    return removed


# ── List ─────────────────────────────────────────────────────────────────────

@router.get("")
def list_trash(db: Session = Depends(get_db)):
    purge_expired(db)  # keep the trash honest on every read
    goals = db.query(Goal).filter(Goal.trashed_at.isnot(None)).all()
    # Individually-trashed tasks whose goal is NOT itself trashed (those show under the goal).
    trashed_goal_ids = {g.id for g in goals}
    tasks = [t for t in db.query(Task).filter(Task.trashed_at.isnot(None)).all()
             if t.goal_id not in trashed_goal_ids]
    goal_titles = {g.id: g.title for g in db.query(Goal.id, Goal.title).all()}

    def goal_kind(g):
        return {"resolution": "Resolution", "project": "Project", "daily": "Daily"}.get(g.type, "Goal")

    return {
        "retention_days": RETENTION_DAYS,
        "goals": [{
            "id": g.id, "title": g.title, "kind": goal_kind(g), "type": g.type,
            "trashed_at": g.trashed_at.replace(tzinfo=UTC).isoformat() if g.trashed_at else None,
            "days_left": _days_left(g.trashed_at),
            "task_count": len(g.tasks),
        } for g in sorted(goals, key=lambda g: g.trashed_at or datetime.now(UTC), reverse=True)],
        "tasks": [{
            "id": t.id, "title": t.title, "kind": "Habit" if False else "Task",
            "goal_title": goal_titles.get(t.goal_id, ""),
            "trashed_at": t.trashed_at.replace(tzinfo=UTC).isoformat() if t.trashed_at else None,
            "days_left": _days_left(t.trashed_at),
        } for t in sorted(tasks, key=lambda t: t.trashed_at or datetime.now(UTC), reverse=True)],
    }


# ── Restore ──────────────────────────────────────────────────────────────────

@router.post("/goal/{goal_id}/restore")
def restore_goal(goal_id: str, db: Session = Depends(get_db)):
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(404, "Goal not found")
    goal.trashed_at = None
    db.commit()
    return {"ok": True, "id": goal_id}


@router.post("/task/{task_id}/restore")
def restore_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    if task.goal and task.goal.trashed_at is not None:
        raise HTTPException(400, "Restore the parent goal first")
    task.trashed_at = None
    for sub in db.query(Task).filter(Task.parent_task_id == task_id).all():
        sub.trashed_at = None
    db.commit()
    return {"ok": True, "id": task_id}


# ── Delete forever ───────────────────────────────────────────────────────────

@router.delete("/goal/{goal_id}", status_code=204)
def purge_goal(goal_id: str, db: Session = Depends(get_db)):
    goal = db.query(Goal).filter(Goal.id == goal_id, Goal.trashed_at.isnot(None)).first()
    if not goal:
        raise HTTPException(404, "Not in trash")
    db.delete(goal)
    db.commit()


@router.delete("/task/{task_id}", status_code=204)
def purge_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.trashed_at.isnot(None)).first()
    if not task:
        raise HTTPException(404, "Not in trash")
    db.delete(task)
    db.commit()
