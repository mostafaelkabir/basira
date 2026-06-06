import re
from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.habit_log import HabitLog
from app.models.task import Task

router = APIRouter(prefix="/tasks", tags=["habits"])


def _per_day(frequency: str | None) -> int:
    m = re.match(r"^(\d+)x_day$", frequency or "")
    return int(m.group(1)) if m else 1


@router.post("/{task_id}/checkin", status_code=201)
def checkin_habit(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    per_day = _per_day(task.habit_frequency)
    today = date.today().isoformat()
    existing = db.query(HabitLog).filter(
        HabitLog.task_id == task_id, HabitLog.date == today
    ).first()

    if existing:
        if existing.count < per_day:
            existing.count += 1
            db.commit()
        return {"checked": existing.count >= per_day, "count": existing.count}

    log = HabitLog(id=str(uuid4()), task_id=task_id, date=today, count=1)
    db.add(log)
    db.commit()
    return {"checked": per_day == 1, "count": 1}


@router.delete("/{task_id}/checkin", status_code=200)
def uncheckin_habit(task_id: str, db: Session = Depends(get_db)):
    today = date.today().isoformat()
    log = db.query(HabitLog).filter(
        HabitLog.task_id == task_id, HabitLog.date == today
    ).first()
    if log:
        if log.count > 1:
            log.count -= 1
            db.commit()
            return {"checked": False, "count": log.count}
        db.delete(log)
        db.commit()
    return {"checked": False, "count": 0}
