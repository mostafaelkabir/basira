"""Day rhythm: the repeating template of blocks, and per-day changes to it."""

from datetime import UTC, date as date_cls, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.day_block import DayBlock
from app.models.rhythm_block import RhythmBlock
from app.routes.settings_route import get_all_settings
from app.services.day_rhythm import (
    MAX_BLOCK, MIN_BLOCK, _targets, ensure_override, parse_days, resolve_day, shift_day, suggest,
    template_blocks, to_hhmm, to_minutes, validate_kind_and_target,
)

router = APIRouter(prefix="/rhythm", tags=["rhythm"])


def _bad(e: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


def _serialize(b: RhythmBlock, targets: dict[str, dict]) -> dict:
    t = targets.get(b.target_ref or "", {})
    s = to_minutes(b.start_time) or 0
    return {
        "id": b.id, "title": b.title or t.get("title") or b.kind.title(), "kind": b.kind,
        "target_ref": b.target_ref, "target_title": t.get("title"),
        "color": b.color or t.get("color"),
        "days": parse_days(b.days), "start_time": b.start_time,
        "end_time": to_hhmm(s + b.duration_minutes), "duration_minutes": b.duration_minutes,
        "sort_order": b.sort_order,
    }


def _list(db: Session) -> dict:
    blocks = template_blocks(db)
    targets = _targets(db, {b.target_ref for b in blocks if b.target_ref})
    settings = get_all_settings(db)
    return {"blocks": [_serialize(b, targets) for b in blocks],
            "day_start": settings.get("day_start", "09:00"), "day_end": settings.get("day_end", "18:00")}


class RhythmCreate(BaseModel):
    title: str = ""
    kind: str
    target_ref: str | None = None
    days: list[str] = Field(default_factory=lambda: ["mon", "tue", "wed", "thu", "fri"])
    start_time: str
    duration_minutes: int = Field(default=60, ge=MIN_BLOCK, le=MAX_BLOCK)
    color: str | None = None


class RhythmUpdate(BaseModel):
    title: str | None = None
    kind: str | None = None
    target_ref: str | None = None
    days: list[str] | None = None
    start_time: str | None = None
    duration_minutes: int | None = Field(default=None, ge=MIN_BLOCK, le=MAX_BLOCK)
    color: str | None = None
    sort_order: int | None = None


def _overlapping(db: Session, days: list[str], start: str, dur: int, exclude: str | None) -> list[dict]:
    s = to_minutes(start) or 0
    hits = []
    for b in template_blocks(db):
        if b.id == exclude or not (set(days) & set(parse_days(b.days))):
            continue
        o = to_minutes(b.start_time) or 0
        if s < o + b.duration_minutes and o < s + dur:
            hits.append({"id": b.id, "title": b.title, "start_time": b.start_time, "duration_minutes": b.duration_minutes,
                         "days": sorted(set(days) & set(parse_days(b.days)))})
    return hits


@router.get("")
def list_rhythm(db: Session = Depends(get_db)):
    return _list(db)


@router.get("/suggest")
def suggest_rhythm(db: Session = Depends(get_db)):
    """A starting template from the user's own projects, clients and habits. Not saved."""
    return {"blocks": suggest(db)}


def _create(db: Session, body: RhythmCreate, order: int) -> RhythmBlock:
    try:
        days = parse_days(body.days)
        if not days:
            raise ValueError("Pick at least one day")
        to_minutes(body.start_time)
        validate_kind_and_target(db, body.kind, body.target_ref)
    except ValueError as e:
        raise _bad(e)
    clash = _overlapping(db, days, body.start_time, body.duration_minutes, None)
    if clash:
        raise HTTPException(status_code=409, detail={"message": "Overlaps another block on the same day", "conflicts": clash})
    b = RhythmBlock(id=str(uuid4()), title=body.title.strip(), kind=body.kind, target_ref=body.target_ref,
                    days=",".join(days), start_time=body.start_time, duration_minutes=body.duration_minutes,
                    color=body.color, sort_order=order)
    db.add(b)
    return b


@router.post("", status_code=201)
def create_rhythm_block(body: RhythmCreate, db: Session = Depends(get_db)):
    b = _create(db, body, db.query(RhythmBlock).count())
    db.commit()
    db.refresh(b)
    return _serialize(b, _targets(db, {b.target_ref} if b.target_ref else set()))


class BatchCreate(BaseModel):
    blocks: list[RhythmCreate]


@router.post("/batch", status_code=201)
def create_many(body: BatchCreate, db: Session = Depends(get_db)):
    """Create a whole rhythm at once (the setup flow). All or nothing."""
    base = db.query(RhythmBlock).count()
    for i, item in enumerate(body.blocks):
        _create(db, item, base + i)
        db.flush()
    db.commit()
    return _list(db)


@router.patch("/{block_id}")
def update_rhythm_block(block_id: str, body: RhythmUpdate, db: Session = Depends(get_db)):
    b = db.get(RhythmBlock, block_id)
    if not b:
        raise HTTPException(status_code=404, detail="Block not found")
    data = body.model_dump(exclude_unset=True)
    kind = data.get("kind", b.kind)
    target = data.get("target_ref", b.target_ref) if ("target_ref" in data or "kind" not in data) else None
    if "kind" in data and "target_ref" not in data and kind not in ("project", "client"):
        target = None
    try:
        validate_kind_and_target(db, kind, target)
        days = parse_days(data["days"]) if "days" in data else parse_days(b.days)
        if not days:
            raise ValueError("Pick at least one day")
        start = data.get("start_time", b.start_time)
        to_minutes(start)
    except ValueError as e:
        raise _bad(e)
    dur = data.get("duration_minutes", b.duration_minutes)
    clash = _overlapping(db, days, start, dur, b.id)
    if clash:
        raise HTTPException(status_code=409, detail={"message": "Overlaps another block on the same day", "conflicts": clash})
    b.kind, b.target_ref, b.days, b.start_time, b.duration_minutes = kind, target, ",".join(days), start, dur
    if "title" in data:
        b.title = (data["title"] or "").strip()
    if "color" in data:
        b.color = data["color"]
    if "sort_order" in data and data["sort_order"] is not None:
        b.sort_order = data["sort_order"]
    b.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(b)
    return _serialize(b, _targets(db, {b.target_ref} if b.target_ref else set()))


@router.delete("/{block_id}", status_code=204)
def delete_rhythm_block(block_id: str, db: Session = Depends(get_db)):
    b = db.get(RhythmBlock, block_id)
    if not b:
        raise HTTPException(status_code=404, detail="Block not found")
    db.query(DayBlock).filter(DayBlock.rhythm_id == block_id).delete()
    db.delete(b)
    db.commit()


# ── A day ────────────────────────────────────────────────────────────────────

@router.get("/day")
def rhythm_day(date: date_cls, db: Session = Depends(get_db)):
    return resolve_day(db, date)


class OverrideBody(BaseModel):
    rhythm_id: str
    date: str
    start_time: str | None = None
    duration_minutes: int | None = Field(default=None, ge=MIN_BLOCK, le=MAX_BLOCK)
    skipped: bool | None = None


def _day(value: str) -> date_cls:
    try:
        return date_cls.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")


@router.post("/day/override")
def override_day(body: OverrideBody, db: Session = Depends(get_db)):
    """Move, resize or skip one template block on one day only."""
    rhythm = db.get(RhythmBlock, body.rhythm_id)
    if not rhythm:
        raise HTTPException(status_code=404, detail="Block not found")
    day = _day(body.date)
    try:
        if body.start_time is not None:
            to_minutes(body.start_time)
    except ValueError as e:
        raise _bad(e)
    row = ensure_override(db, rhythm, day.isoformat())
    if body.start_time is not None:
        row.start_time = body.start_time
    if body.duration_minutes is not None:
        row.duration_minutes = body.duration_minutes
    if body.skipped is not None:
        row.skipped = body.skipped
    row.revision = (row.revision or 0) + 1
    row.updated_at = datetime.now(UTC)
    db.commit()
    return resolve_day(db, day)


class RestoreBody(BaseModel):
    rhythm_id: str
    date: str


@router.post("/day/restore")
def restore_day(body: RestoreBody, db: Session = Depends(get_db)):
    """Drop the day's change so the block follows the template again."""
    day = _day(body.date)
    db.query(DayBlock).filter(DayBlock.rhythm_id == body.rhythm_id, DayBlock.date == day.isoformat()).delete()
    db.commit()
    return resolve_day(db, day)


class ShiftBody(BaseModel):
    date: str
    from_time: str
    minutes: int = Field(ge=-12 * 60, le=12 * 60)


@router.post("/day/shift")
def shift(body: ShiftBody, db: Session = Depends(get_db)):
    """Running late: push everything from a time onwards by some minutes, today only."""
    day = _day(body.date)
    try:
        to_minutes(body.from_time)
    except ValueError as e:
        raise _bad(e)
    return shift_day(db, day, body.from_time, body.minutes)
