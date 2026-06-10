import json
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.periodic_reflection import PeriodicReflection

router = APIRouter(prefix="/reflections", tags=["reflections"])


def _serialize(r: PeriodicReflection):
    return {
        "id": r.id,
        "period_type": r.period_type,
        "period_start": r.period_start,
        "proud_of": r.proud_of,
        "held_back": r.held_back,
        "energy_rating": r.energy_rating,
        "values_alignment": r.values_alignment,
        "do_differently": r.do_differently,
        "monthly_answers": json.loads(r.monthly_answers or "{}"),
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


class ReflectionIn(BaseModel):
    period_type: str           # 'weekly' | 'monthly'
    period_start: str          # YYYY-MM-DD
    proud_of: str | None = None
    held_back: str | None = None
    energy_rating: int | None = None
    values_alignment: int | None = None
    do_differently: str | None = None
    monthly_answers: dict = {}


@router.get("")
def list_reflections(limit: int = 20, db: Session = Depends(get_db)):
    rows = (
        db.query(PeriodicReflection)
        .order_by(PeriodicReflection.period_start.desc())
        .limit(limit)
        .all()
    )
    return [_serialize(r) for r in rows]


@router.get("/{period_type}/{period_start}")
def get_reflection(period_type: str, period_start: str, db: Session = Depends(get_db)):
    r = db.query(PeriodicReflection).filter(
        PeriodicReflection.period_type == period_type,
        PeriodicReflection.period_start == period_start,
    ).first()
    if not r:
        return None
    return _serialize(r)


@router.post("")
def save_reflection(body: ReflectionIn, db: Session = Depends(get_db)):
    # Upsert by period_start (one reflection per period)
    r = db.query(PeriodicReflection).filter(
        PeriodicReflection.period_start == body.period_start
    ).first()
    now = datetime.now(UTC)
    if not r:
        r = PeriodicReflection(id=str(uuid4()), created_at=now, updated_at=now)
        db.add(r)
    r.period_type = body.period_type
    r.period_start = body.period_start
    r.proud_of = body.proud_of
    r.held_back = body.held_back
    r.energy_rating = body.energy_rating
    r.values_alignment = body.values_alignment
    r.do_differently = body.do_differently
    r.monthly_answers = json.dumps(body.monthly_answers)
    r.updated_at = now
    db.commit()
    db.refresh(r)
    return _serialize(r)


@router.patch("/{reflection_id}")
def update_reflection(reflection_id: str, body: ReflectionIn, db: Session = Depends(get_db)):
    r = db.get(PeriodicReflection, reflection_id)
    if not r:
        raise HTTPException(404, "Reflection not found")
    r.proud_of = body.proud_of
    r.held_back = body.held_back
    r.energy_rating = body.energy_rating
    r.values_alignment = body.values_alignment
    r.do_differently = body.do_differently
    r.monthly_answers = json.dumps(body.monthly_answers)
    r.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(r)
    return _serialize(r)
