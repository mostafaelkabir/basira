from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.daily_checkin import DailyCheckin
from app.models.afternoon_checkin import AfternoonCheckin

router = APIRouter(prefix="/checkins", tags=["checkins"])


def _today():
    return date.today().isoformat()


def _serialize(c: DailyCheckin):
    return {
        "id": c.id,
        "date": c.date,
        "morning_energy": c.morning_energy,
        "morning_intention": c.morning_intention,
        "evening_mood": c.evening_mood,
        "evening_rating": c.evening_rating,
        "evening_reflection": c.evening_reflection,
    }


@router.get("/today")
def get_today(db: Session = Depends(get_db)):
    today = _today()
    c = db.query(DailyCheckin).filter(DailyCheckin.date == today).first()
    return _serialize(c) if c else {"date": today}


@router.get("/{date_str}")
def get_by_date(date_str: str, db: Session = Depends(get_db)):
    c = db.query(DailyCheckin).filter(DailyCheckin.date == date_str).first()
    return _serialize(c) if c else {"date": date_str}


class MorningIn(BaseModel):
    energy: int           # 1–5
    intention: str = ""


@router.post("/morning")
def save_morning(body: MorningIn, db: Session = Depends(get_db)):
    today = _today()
    c = db.query(DailyCheckin).filter(DailyCheckin.date == today).first()
    if not c:
        c = DailyCheckin(date=today)
        db.add(c)
    c.morning_energy = body.energy
    c.morning_intention = body.intention
    db.commit()
    db.refresh(c)
    return _serialize(c)


class EveningIn(BaseModel):
    mood: int             # 1–5
    rating: int           # 1–5
    reflection: str = ""


@router.post("/evening")
def save_evening(body: EveningIn, db: Session = Depends(get_db)):
    today = _today()
    c = db.query(DailyCheckin).filter(DailyCheckin.date == today).first()
    if not c:
        c = DailyCheckin(date=today)
        db.add(c)
    c.evening_mood = body.mood
    c.evening_rating = body.rating
    c.evening_reflection = body.reflection
    db.commit()
    db.refresh(c)
    return _serialize(c)


# ── Afternoon pulse ────────────────────────────────────────────────────────────

class AfternoonIn(BaseModel):
    energy: int          # 1–3
    working_on: str = ""


def _serialize_afternoon(a: AfternoonCheckin):
    return {
        "id": a.id,
        "date": a.date,
        "energy": a.energy,
        "working_on": a.working_on,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@router.get("/afternoon/{date_str}")
def get_afternoon(date_str: str, db: Session = Depends(get_db)):
    a = db.query(AfternoonCheckin).filter(AfternoonCheckin.date == date_str).first()
    return _serialize_afternoon(a) if a else {"date": date_str}


@router.post("/afternoon")
def save_afternoon(body: AfternoonIn, db: Session = Depends(get_db)):
    today = _today()
    a = db.query(AfternoonCheckin).filter(AfternoonCheckin.date == today).first()
    if not a:
        a = AfternoonCheckin(id=str(uuid4()), date=today, created_at=datetime.now(UTC))
        db.add(a)
    a.energy = body.energy
    a.working_on = body.working_on or None
    db.commit()
    db.refresh(a)
    return _serialize_afternoon(a)
