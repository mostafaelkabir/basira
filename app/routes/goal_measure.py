"""A goal's measure: the target number, the weekly check-in, and the read-out
(progress, pace, projection, system adherence, diagnosis) from app/services/goal_measure.py."""
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.goal import METRIC_SOURCES, Goal, GoalCheckin
from app.services.goal_measure import measure, measures

router = APIRouter(prefix="/goals", tags=["goal-measure"])


class MeasureIn(BaseModel):
    name: str = Field(..., min_length=1)
    unit: str = ""
    source: str = "manual"
    start: float
    target: float
    start_date: str | None = None     # defaults to the existing start date, else today
    target_date: str | None = None


class CheckinIn(BaseModel):
    value: float
    note: str = ""
    date: str | None = None           # defaults to today


def _goal(db: Session, goal_id: str) -> Goal:
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal or goal.trashed_at is not None:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal


def _day(value: str | None, label: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} must be a date (YYYY-MM-DD)")


@router.get("/measures")
def list_measures(db: Session = Depends(get_db)) -> list[dict]:
    return measures(db)


@router.get("/{goal_id}/measure")
def get_measure(goal_id: str, db: Session = Depends(get_db)) -> dict:
    return measure(db, _goal(db, goal_id))


@router.put("/{goal_id}/measure")
def set_measure(goal_id: str, body: MeasureIn, db: Session = Depends(get_db)) -> dict:
    goal = _goal(db, goal_id)
    if body.source not in METRIC_SOURCES:
        raise HTTPException(status_code=400, detail=f"source must be one of: {', '.join(METRIC_SOURCES)}")
    if body.target == body.start:
        raise HTTPException(status_code=400, detail="The target must differ from the starting value")
    start_date = _day(body.start_date, "Start date") or _day(goal.metric_start_date, "Start date") or date.today()
    target_date = _day(body.target_date, "Target date")
    if target_date and target_date <= start_date:
        raise HTTPException(status_code=400, detail="The target date must be after the start date")
    goal.metric_name = body.name.strip()
    goal.metric_unit = body.unit.strip()
    goal.metric_source = body.source
    goal.metric_start = body.start
    goal.metric_target = body.target
    goal.metric_start_date = start_date.isoformat()
    goal.metric_target_date = target_date.isoformat() if target_date else None
    db.commit()
    return measure(db, goal)


@router.delete("/{goal_id}/measure")
def clear_measure(goal_id: str, db: Session = Depends(get_db)) -> dict:
    """Remove the measure and its check-ins; the goal itself is untouched."""
    goal = _goal(db, goal_id)
    db.query(GoalCheckin).filter(GoalCheckin.goal_id == goal.id).delete()
    for col in ("metric_name", "metric_unit", "metric_source", "metric_start", "metric_target",
                "metric_start_date", "metric_target_date"):
        setattr(goal, col, None)
    db.commit()
    return measure(db, goal)


@router.post("/{goal_id}/measure/checkins")
def check_in(goal_id: str, body: CheckinIn, db: Session = Depends(get_db)) -> dict:
    """Record the number for a week. A second check-in in the same week replaces the first."""
    goal = _goal(db, goal_id)
    if goal.metric_target is None:
        raise HTTPException(status_code=400, detail="Set a target for this goal first")
    if (goal.metric_source or "manual") != "manual":
        raise HTTPException(status_code=400, detail="This number is counted automatically")
    day = _day(body.date, "Date") or date.today()
    if day > date.today():
        raise HTTPException(status_code=400, detail="A check-in cannot be in the future")
    if goal.metric_start_date and day.isoformat() < goal.metric_start_date:
        raise HTTPException(status_code=400, detail="A check-in cannot be before the start date")
    week = (day - timedelta(days=day.weekday())).isoformat()
    row = db.query(GoalCheckin).filter(GoalCheckin.goal_id == goal.id, GoalCheckin.week_start == week).first()
    if row is None:
        row = GoalCheckin(id=str(uuid4()), goal_id=goal.id, week_start=week, created_at=datetime.now(UTC))
        db.add(row)
    row.date, row.value, row.note = day.isoformat(), body.value, body.note.strip()
    db.commit()
    return measure(db, goal)


@router.delete("/{goal_id}/measure/checkins/{checkin_id}")
def delete_checkin(goal_id: str, checkin_id: str, db: Session = Depends(get_db)) -> dict:
    goal = _goal(db, goal_id)
    row = db.query(GoalCheckin).filter(GoalCheckin.id == checkin_id, GoalCheckin.goal_id == goal.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Check-in not found")
    db.delete(row)
    db.commit()
    return measure(db, goal)
