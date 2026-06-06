from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.goal import Goal
from app.models.task import Task
from app.schemas.goal import GoalCreate, GoalDetail, GoalRead, GoalUpdate

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
        "task_count": len(goal.tasks),
        "done_count": sum(1 for t in goal.tasks if t.status == "done"),
    }


@router.get("", response_model=list[GoalRead])
def list_goals(archived: bool = False, db: Session = Depends(get_db)) -> list[dict]:
    q = db.query(Goal).options(joinedload(Goal.tasks))
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
    if not goal:
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

    # Separate top-level tasks and sub-tasks (sorted by sort_order)
    top_level = sorted([t for t in goal.tasks if not t.parent_task_id], key=lambda t: t.sort_order or 0)
    task_ids   = {t.id for t in top_level}
    sub_tasks_rows = (
        db.query(Task)
        .filter(Task.parent_task_id.in_(list(task_ids)))
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
        "tasks": [_enrich(t) for t in top_level],
        "sub_goals": [_goal_to_dict(sg) for sg in sub_goals],
    }


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
    goal.archived_at = None
    db.commit()
    db.refresh(goal)
    return _goal_to_dict(goal)


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: str, db: Session = Depends(get_db)) -> None:
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    db.delete(goal)
    db.commit()
