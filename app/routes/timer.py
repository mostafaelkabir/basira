from datetime import UTC, datetime, date, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.goal import Goal
from app.models.task import Task
from app.models.work_session import WorkSession

router = APIRouter(prefix="/timer", tags=["timer"])


def _end_session(session: WorkSession, now: datetime) -> None:
    started = session.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=UTC)
    session.duration_seconds = max(0, int((now - started).total_seconds()))
    session.ended_at = now


# ── Active session ─────────────────────────────────────────────────────────────

@router.get("/active")
def get_active(db: Session = Depends(get_db)):
    # Only return task-based sessions here; work_log sessions handled separately
    active = db.query(WorkSession).filter(
        WorkSession.ended_at.is_(None),
        WorkSession.task_id.isnot(None),
    ).first()
    if not active:
        return None
    task = db.query(Task).filter(Task.id == active.task_id).first()
    goal = db.query(Goal).filter(Goal.id == task.goal_id).first() if task else None
    # Sum of all previously completed sessions for this task
    prior = db.query(func.coalesce(func.sum(WorkSession.duration_seconds), 0)).filter(
        WorkSession.task_id == active.task_id,
        WorkSession.ended_at.isnot(None),
    ).scalar() or 0
    return {
        "session_id": active.id,
        "task_id": active.task_id,
        "task_title": task.title if task else "Unknown",
        "goal_title": goal.title if goal else "",
        "started_at": active.started_at.replace(tzinfo=UTC).isoformat(),
        "prior_seconds": prior,
    }


# ── Start ──────────────────────────────────────────────────────────────────────

class StartBody(BaseModel):
    task_id: str


@router.post("/start")
def start_timer(body: StartBody, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == body.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    now = datetime.now(UTC)

    # Stop any currently running session (different task → pause it)
    active = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).first()
    if active:
        if active.task_id == body.task_id:
            # Already timing this task — return existing session
            goal = db.query(Goal).filter(Goal.id == task.goal_id).first()
            prior = db.query(func.coalesce(func.sum(WorkSession.duration_seconds), 0)).filter(
                WorkSession.task_id == body.task_id,
                WorkSession.ended_at.isnot(None),
            ).scalar() or 0
            return {
                "session_id": active.id,
                "task_id": task.id,
                "task_title": task.title,
                "goal_title": goal.title if goal else "",
                "started_at": active.started_at.replace(tzinfo=UTC).isoformat(),
                "prior_seconds": prior,
            }
        _end_session(active, now)

    session = WorkSession(
        id=str(uuid4()),
        task_id=body.task_id,
        started_at=now,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    goal = db.query(Goal).filter(Goal.id == task.goal_id).first()
    prior = db.query(func.coalesce(func.sum(WorkSession.duration_seconds), 0)).filter(
        WorkSession.task_id == body.task_id,
        WorkSession.ended_at.isnot(None),
    ).scalar() or 0
    return {
        "session_id": session.id,
        "task_id": task.id,
        "task_title": task.title,
        "goal_title": goal.title if goal else "",
        "started_at": session.started_at.replace(tzinfo=UTC).isoformat(),
        "prior_seconds": prior,
    }


# ── Pause ──────────────────────────────────────────────────────────────────────

@router.post("/pause")
def pause_timer(db: Session = Depends(get_db)):
    active = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).first()
    if not active:
        return {"ok": True, "duration_seconds": 0}
    now = datetime.now(UTC)
    _end_session(active, now)
    db.commit()
    return {"ok": True, "duration_seconds": active.duration_seconds}


# ── Manual time log ───────────────────────────────────────────────────────────

class LogManualBody(BaseModel):
    task_id: str
    duration_minutes: int

@router.post("/log")
def log_manual_time(body: LogManualBody, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == body.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    duration_seconds = body.duration_minutes * 60
    now = datetime.now(UTC)
    session = WorkSession(
        id=str(uuid4()),
        task_id=body.task_id,
        started_at=now - timedelta(seconds=duration_seconds),
        ended_at=now,
        duration_seconds=duration_seconds,
    )
    db.add(session)
    db.commit()
    return {"ok": True, "duration_seconds": duration_seconds}


# ── Task time summary ──────────────────────────────────────────────────────────

@router.get("/task/{task_id}")
def get_task_time(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    sessions = db.query(WorkSession).filter(WorkSession.task_id == task_id).all()
    now = datetime.now(UTC)
    total = 0
    for s in sessions:
        if s.ended_at:
            total += s.duration_seconds
        else:
            started = s.started_at if s.started_at.tzinfo else s.started_at.replace(tzinfo=UTC)
            total += int((now - started).total_seconds())

    return {
        "task_id": task_id,
        "total_seconds": total,
        "session_count": len(sessions),
        "sessions": [
            {
                "id": s.id,
                "started_at": s.started_at.isoformat(),
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
                "duration_seconds": s.duration_seconds,
            }
            for s in sessions
        ],
    }


# ── Daily / goal summaries ─────────────────────────────────────────────────────

@router.get("/summary/today")
def get_today_summary(db: Session = Depends(get_db)):
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=UTC)
    sessions = db.query(WorkSession).filter(
        WorkSession.started_at >= today_start,
        WorkSession.task_id.isnot(None),   # exclude work_log sessions
    ).all()
    now = datetime.now(UTC)
    by_task: dict[str, int] = {}
    for s in sessions:
        if not s.task_id:
            continue
        secs = s.duration_seconds if s.ended_at else int((now - s.started_at.replace(tzinfo=UTC)).total_seconds())
        by_task[s.task_id] = by_task.get(s.task_id, 0) + secs

    result = []
    for task_id, secs in sorted(by_task.items(), key=lambda x: -x[1]):
        task = db.query(Task).filter(Task.id == task_id).first()
        goal = db.query(Goal).filter(Goal.id == task.goal_id).first() if task else None
        result.append({
            "task_id": task_id,
            "task_title": task.title if task else task_id,
            "goal_title": goal.title if goal else "",
            "seconds": secs,
        })
    total = sum(by_task.values())
    return {"total_seconds": total, "tasks": result}
