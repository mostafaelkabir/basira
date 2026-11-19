from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.goal import CLOSED_STATUSES, GOAL_STATUSES, REASON_REQUIRED, Goal, GoalStatusLog
from app.models.task import Task
from app.schemas.goal import GoalCreate, GoalDetail, GoalRead, GoalStatusUpdate, GoalUpdate
from app.services.goal_stats import goal_stats

router = APIRouter(prefix="/goals", tags=["goals"])


def _goal_to_dict(goal: Goal) -> dict:
    return {
        "id": goal.id,
        "title": goal.title,
        "description": goal.description,
        "type": goal.type,
        "icon": goal.icon,
        "cover": goal.cover or False,
        "created_at": goal.created_at,
        "archived_at": goal.archived_at,
        "parent_id": goal.parent_id,
        "status": goal.status or "active",
        "status_reason": goal.status_reason,
        "status_changed_at": goal.status_changed_at,
        "task_count": len(goal.tasks),
        "done_count": sum(1 for t in goal.tasks if t.status == "done"),
    }


def _history(db: Session, goal_id: str) -> list[dict]:
    rows = (db.query(GoalStatusLog).filter(GoalStatusLog.goal_id == goal_id)
            .order_by(GoalStatusLog.created_at.desc()).all())
    return [{"id": r.id, "from_status": r.from_status, "to_status": r.to_status,
             "reason": r.reason or "", "created_at": str(r.created_at)} for r in rows]


def _set_status(db: Session, goal: Goal, status: str, reason: str) -> None:
    """Change the outcome and log it. Closing statuses archive the goal; the others reopen it."""
    now = datetime.now(UTC)
    db.add(GoalStatusLog(id=str(uuid4()), goal_id=goal.id, from_status=goal.status or "active",
                         to_status=status, reason=reason, created_at=now))
    goal.status = status
    goal.status_reason = reason or None
    goal.status_changed_at = now
    goal.archived_at = now if status in CLOSED_STATUSES else None


@router.get("", response_model=list[GoalRead])
def list_goals(archived: bool = False, db: Session = Depends(get_db)) -> list[dict]:
    q = db.query(Goal).options(joinedload(Goal.tasks)).filter(Goal.trashed_at.is_(None))
    goals = q.filter(Goal.archived_at.isnot(None) if archived else Goal.archived_at.is_(None)).all()
    return [_goal_to_dict(g) for g in goals]


@router.post("", response_model=GoalRead, status_code=201)
def create_goal(goal_data: GoalCreate, db: Session = Depends(get_db)) -> dict:
    if goal_data.parent_id:
        parent = db.query(Goal).filter(Goal.id == goal_data.parent_id).first()
        if not parent:
            raise HTTPException(status_code=400, detail="Parent project not found")
        if parent.parent_id:
            raise HTTPException(status_code=400, detail="Cannot nest more than one level deep")
    goal = Goal(
        id=str(uuid4()),
        title=goal_data.title,
        description=goal_data.description,
        type=goal_data.type,
        icon=goal_data.icon,
        cover=goal_data.cover,
        parent_id=goal_data.parent_id,
        created_at=datetime.now(UTC),
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return {**_goal_to_dict(goal), "task_count": 0, "done_count": 0}


@router.get("/{goal_id}", response_model=GoalDetail)
def get_goal(goal_id: str, db: Session = Depends(get_db)) -> dict:
    goal = (
        db.query(Goal)
        .options(
            joinedload(Goal.tasks).joinedload(Task.proofs),
            joinedload(Goal.tasks).joinedload(Task.comments),
        )
        .filter(Goal.id == goal_id)
        .first()
    )
    if not goal or goal.trashed_at is not None:
        raise HTTPException(status_code=404, detail="Goal not found")

    parent_title = None
    if goal.parent_id:
        parent = db.query(Goal).filter(Goal.id == goal.parent_id).first()
        parent_title = parent.title if parent else None

    sub_goals = (
        db.query(Goal)
        .options(joinedload(Goal.tasks))
        .filter(Goal.parent_id == goal_id, Goal.archived_at.is_(None))
        .all()
    )

    # Separate top-level tasks and sub-tasks (sorted by sort_order); hide trashed.
    top_level = sorted([t for t in goal.tasks if not t.parent_task_id and t.trashed_at is None], key=lambda t: t.sort_order or 0)
    task_ids   = {t.id for t in top_level}
    sub_tasks_rows = (
        db.query(Task)
        .filter(Task.parent_task_id.in_(list(task_ids)), Task.trashed_at.is_(None))
        .all()
    ) if task_ids else []
    sub_tasks_by_parent: dict = {}
    for st in sub_tasks_rows:
        sub_tasks_by_parent.setdefault(st.parent_task_id, []).append(st)

    def _enrich(t: Task) -> dict:
        return {
            "id": t.id, "title": t.title, "goal_id": t.goal_id,
            "status": t.status, "requires_proof": t.requires_proof,
            "due_date": t.due_date, "habit_frequency": t.habit_frequency or "daily",
            "pinned_date": t.pinned_date, "deferred_until": t.deferred_until,
            "plan_date": t.plan_date, "parent_task_id": t.parent_task_id,
            "is_urgent": t.is_urgent or False,
            "is_important": t.is_important or False,
            "sort_order": t.sort_order or 0,
            "estimated_minutes": t.estimated_minutes, "kind": t.kind,
            "scheduled_time": t.scheduled_time,
            "routine_days": [d for d in (t.routine_days or "").split(",") if d],
            "proofs": t.proofs, "comments": t.comments,
            "sub_tasks": sub_tasks_by_parent.get(t.id, []),
        }

    return {
        "id": goal.id,
        "title": goal.title,
        "description": goal.description,
        "type": goal.type,
        "icon": goal.icon,
        "cover": goal.cover or False,
        "created_at": goal.created_at,
        "archived_at": goal.archived_at,
        "parent_id": goal.parent_id,
        "parent_title": parent_title,
        "status": goal.status or "active",
        "status_reason": goal.status_reason,
        "status_changed_at": goal.status_changed_at,
        "status_history": _history(db, goal.id),
        "tasks": [_enrich(t) for t in top_level],
        "sub_goals": [_goal_to_dict(sg) for sg in sub_goals],
    }


@router.get("/{goal_id}/stats")
def get_goal_stats(goal_id: str, db: Session = Depends(get_db)) -> dict:
    """Read-only streaks, consistency, heatmap and per-habit stats for a goal."""
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal or goal.trashed_at is not None:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal_stats(db, goal)


@router.patch("/{goal_id}", response_model=GoalRead)
def update_goal(goal_id: str, data: GoalUpdate, db: Session = Depends(get_db)) -> dict:
    goal = db.query(Goal).options(joinedload(Goal.tasks)).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return _goal_to_dict(goal)


@router.post("/{goal_id}/status", response_model=GoalRead)
def set_goal_status(goal_id: str, body: GoalStatusUpdate, db: Session = Depends(get_db)) -> dict:
    """Mark a goal achieved, blocked, moved out or cancelled (or active again), with the reason.
    Blocked, moved out and cancelled need a reason so the shift in priorities is on record."""
    goal = db.query(Goal).options(joinedload(Goal.tasks)).filter(Goal.id == goal_id).first()
    if not goal or goal.trashed_at is not None:
        raise HTTPException(status_code=404, detail="Goal not found")
    if body.status not in GOAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(GOAL_STATUSES)}")
    reason = body.reason.strip()
    if body.status in REASON_REQUIRED and not reason:
        raise HTTPException(status_code=400, detail="Add a reason so the change is on record")
    if body.status == (goal.status or "active") and reason == (goal.status_reason or ""):
        return _goal_to_dict(goal)
    _set_status(db, goal, body.status, reason)
    db.commit()
    db.refresh(goal)
    return _goal_to_dict(goal)


@router.post("/{goal_id}/archive", response_model=GoalRead)
def archive_goal(goal_id: str, db: Session = Depends(get_db)) -> dict:
    goal = db.query(Goal).options(joinedload(Goal.tasks)).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    goal.archived_at = datetime.now(UTC)
    db.commit()
    db.refresh(goal)
    return _goal_to_dict(goal)


@router.post("/{goal_id}/unarchive", response_model=GoalRead)
def unarchive_goal(goal_id: str, db: Session = Depends(get_db)) -> dict:
    goal = db.query(Goal).options(joinedload(Goal.tasks)).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    if (goal.status or "active") in CLOSED_STATUSES:
        _set_status(db, goal, "active", "Reopened")   # a closed goal comes back as active, on record
    goal.archived_at = None
    db.commit()
    db.refresh(goal)
    return _goal_to_dict(goal)


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: str, db: Session = Depends(get_db)) -> None:
    """Soft-delete: move the goal to the trash. Its tasks are hidden with it and
    it is permanently removed after 30 days (or via the trash). Restorable."""
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    goal.trashed_at = datetime.now(UTC)
    db.commit()
