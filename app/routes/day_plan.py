"""Durable day-planning blocks (Step 4).

Blocks are additive planning objects stored server-side. Creating or moving a
block never touches Tasks, tickets, work logs, estimates or recorded time — it only
reserves a slot. Confirmed plans live here; the client keeps only recoverable drafts.
"""

from datetime import UTC, date as date_cls, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.company import Company
from app.models.day_block import (
    ALLOWED_KINDS, CONTAINER_KINDS, FREE_KINDS, ITEM_KINDS, DayBlock,
)
from app.models.goal import Goal
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_ticket import WorkTicket

router = APIRouter(prefix="/day-plan", tags=["day plan"])

# source_ref prefix -> (kind group, model, label)
_SOURCE_MODELS = {
    "task": Task, "ticket": WorkTicket, "worklog": WorkLog,
    "goal": Goal, "company": Company,
}


def _serialize(b: DayBlock) -> dict:
    return {
        "id": b.id, "date": b.date, "start_time": b.start_time,
        "duration_minutes": b.duration_minutes, "kind": b.kind,
        "source_ref": b.source_ref, "title": b.title, "note": b.note,
        "revision": b.revision,
    }


def _validate_reference(kind: str, source_ref: str | None, title: str, db: Session) -> None:
    """A block's kind dictates what it may reference; references must resolve to an
    existing row. Never create goals or guess projects from titles."""
    if kind not in ALLOWED_KINDS:
        raise HTTPException(400, f"Unknown block kind: {kind}")

    if kind in FREE_KINDS:
        if source_ref:
            raise HTTPException(400, f"A {kind} block cannot reference a work item")
        if not title.strip():
            raise HTTPException(400, f"A {kind} block needs a title")
        return

    if not source_ref or ":" not in source_ref:
        raise HTTPException(400, f"A {kind} block needs a source_ref like 'task:<id>'")
    prefix, ident = source_ref.split(":", 1)

    expected = (
        {"goal"} if kind == "project"
        else {"company"} if kind == "client"
        else {kind}  # task | ticket | worklog
    )
    if prefix not in expected:
        raise HTTPException(400, f"A {kind} block must reference {'/'.join(expected)}:<id>, got '{prefix}'")

    model = _SOURCE_MODELS[prefix]
    if not db.query(model.id).filter(model.id == ident).first():
        raise HTTPException(404, f"Referenced {prefix} '{ident}' does not exist")


def _overlaps(a_start: int, a_dur: int, b_start: int, b_dur: int) -> bool:
    return a_start < b_start + b_dur and b_start < a_start + a_dur


def _to_minutes(hhmm: str | None) -> int | None:
    if not hhmm:
        return None
    try:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        raise HTTPException(400, f"Invalid start_time: {hhmm}")


def _conflicts_for(db: Session, date: str, start_time: str | None,
                   duration: int, exclude_id: str | None) -> list[dict]:
    """Scheduled blocks on the same day whose time ranges overlap this one.
    Unscheduled reservations (no start_time) never conflict."""
    start = _to_minutes(start_time)
    if start is None:
        return []
    rows = db.query(DayBlock).filter(DayBlock.date == date, DayBlock.start_time.isnot(None)).all()
    hits = []
    for other in rows:
        if other.id == exclude_id:
            continue
        o_start = _to_minutes(other.start_time)
        if o_start is not None and _overlaps(start, duration, o_start, other.duration_minutes):
            hits.append(_serialize(other))
    return hits


# ── Read ─────────────────────────────────────────────────────────────────────

@router.get("")
def list_blocks(date: date_cls, db: Session = Depends(get_db)):
    day = date.isoformat()
    blocks = db.query(DayBlock).filter(DayBlock.date == day).all()
    blocks.sort(key=lambda b: (b.start_time is None, b.start_time or "", b.title))
    planned = sum(b.duration_minutes for b in blocks)
    return {"date": day, "blocks": [_serialize(b) for b in blocks], "planned_minutes": planned}


# ── Create ───────────────────────────────────────────────────────────────────

class BlockCreate(BaseModel):
    date: str
    kind: str
    source_ref: str | None = None
    start_time: str | None = None
    duration_minutes: int = Field(default=30, ge=1, le=24 * 60)
    title: str = ""
    note: str = ""


@router.post("/preview")
def preview_block(body: BlockCreate, db: Session = Depends(get_db)):
    """Dry-run: validate the reference and report conflicts WITHOUT saving."""
    _validate_reference(body.kind, body.source_ref, body.title, db)
    conflicts = _conflicts_for(db, body.date, body.start_time, body.duration_minutes, None)
    return {"ok": True, "conflicts": conflicts}


@router.post("", status_code=201)
def create_block(body: BlockCreate, db: Session = Depends(get_db)):
    _validate_reference(body.kind, body.source_ref, body.title, db)
    block = DayBlock(
        id=str(uuid4()), date=body.date, kind=body.kind, source_ref=body.source_ref,
        start_time=body.start_time, duration_minutes=body.duration_minutes,
        title=body.title.strip(), note=body.note,
    )
    db.add(block)
    db.commit()
    db.refresh(block)
    return _serialize(block)


# ── Move / resize ────────────────────────────────────────────────────────────

class BlockMove(BaseModel):
    start_time: str | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=24 * 60)
    revision: int  # the revision the client last saw; a mismatch means someone else moved it

@router.patch("/{block_id}")
def move_block(block_id: str, body: BlockMove, db: Session = Depends(get_db)):
    block = db.query(DayBlock).filter(DayBlock.id == block_id).first()
    if not block:
        raise HTTPException(404, "Block not found")
    if block.revision != body.revision:
        raise HTTPException(409, {
            "detail": "This block changed since you loaded it",
            "current": _serialize(block),
        })
    # Moving changes the schedule only — never the referenced item's estimate/time.
    if "start_time" in body.model_fields_set:
        block.start_time = body.start_time
    if body.duration_minutes is not None:
        block.duration_minutes = body.duration_minutes
    block.revision += 1
    block.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(block)
    return _serialize(block)


# ── Delete ───────────────────────────────────────────────────────────────────

@router.delete("/{block_id}", status_code=204)
def delete_block(block_id: str, db: Session = Depends(get_db)):
    block = db.query(DayBlock).filter(DayBlock.id == block_id).first()
    if not block:
        raise HTTPException(404, "Block not found")
    db.delete(block)
    db.commit()
