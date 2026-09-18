"""Unified timer adapter across task, ticket, and work-log sources (Step 5).

Additive: the existing per-source timer endpoints are unchanged. This module adds
one place that understands all three source ledgers, so a single UI can start,
switch, stop, and manually log time without ever silently dropping a source's time.

Ledger by source (preserved exactly as each source already records it):
  task     -> the WorkSession's own saved duration_seconds
  ticket   -> a WorkTimeEntry row (exact seconds) + recomputed ticket totals
  worklog  -> accumulated into WorkLog.duration_minutes (whole minutes)

Server-enforced single-active: starting/switching first stops EVERY running
session correctly (which also reconciles any legacy multiple-active state), then
starts the requested one. Visiting a page never stops a session — only these
explicit actions do.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_session import WorkSession
from app.models.work_ticket import WorkTicket, WorkTimeEntry

router = APIRouter(prefix="/day-timer", tags=["day timer"])

SOURCES = {"task", "ticket", "worklog"}


def _namespace(source: str, item_id: str) -> tuple[str | None, str | None]:
    """Map (source, id) to the WorkSession identity columns (task_id, work_log_id)."""
    if source == "task":
        return item_id, None
    if source == "ticket":
        return None, f"ticket:{item_id}"
    return None, item_id  # worklog


def _session_source(s: WorkSession) -> tuple[str, str]:
    if s.task_id:
        return "task", s.task_id
    wl = s.work_log_id or ""
    if wl.startswith("ticket:"):
        return "ticket", wl.split(":", 1)[1]
    return "worklog", wl


def _recalc_ticket(ticket: WorkTicket, db: Session) -> None:
    total = db.query(func.coalesce(func.sum(
        func.coalesce(WorkTimeEntry.duration_seconds,
                      func.coalesce(WorkTimeEntry.duration_minutes, 0) * 60)
    ), 0)).filter(WorkTimeEntry.ticket_id == ticket.id).scalar() or 0
    ticket.logged_seconds = int(total)
    ticket.logged_minutes = int(total) // 60


def _stop_session(s: WorkSession, db: Session, now: datetime) -> dict:
    """End a running session and write the correct ledger entry for its source."""
    started = s.started_at.replace(tzinfo=UTC) if s.started_at.tzinfo is None else s.started_at
    elapsed = max(1, int((now - started).total_seconds()))
    s.ended_at = now
    s.duration_seconds = elapsed
    source, item_id = _session_source(s)

    if source == "ticket":
        db.add(WorkTimeEntry(
            id=str(uuid4()), ticket_id=item_id, duration_seconds=elapsed,
            duration_minutes=elapsed // 60, logged_at=now.strftime("%Y-%m-%d"), note="",
        ))
        db.flush()
        ticket = db.get(WorkTicket, item_id)
        if ticket:
            _recalc_ticket(ticket, db)
    elif source == "worklog":
        log = db.get(WorkLog, item_id)
        if log:
            log.duration_minutes = (log.duration_minutes or 0) + max(1, elapsed // 60)
    # task: the WorkSession's own duration_seconds is the ledger; nothing else to write.

    return {"source": source, "item_id": item_id, "seconds": elapsed}


def _stop_all_active(db: Session, now: datetime) -> list[dict]:
    active = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).all()
    return [_stop_session(s, db, now) for s in active]


def _verify_exists(source: str, item_id: str, db: Session) -> None:
    model = {"task": Task, "ticket": WorkTicket, "worklog": WorkLog}[source]
    if not db.query(model.id).filter(model.id == item_id).first():
        raise HTTPException(404, f"{source} '{item_id}' not found")


# ── Active ───────────────────────────────────────────────────────────────────

@router.get("/active")
def active(db: Session = Depends(get_db)):
    """Every running session across all sources (usually 0 or 1)."""
    now = datetime.now(UTC)
    rows = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).all()
    out = []
    for s in rows:
        source, item_id = _session_source(s)
        started = s.started_at.replace(tzinfo=UTC) if s.started_at.tzinfo is None else s.started_at
        out.append({
            "session_id": s.id, "source": source, "item_id": item_id,
            "started_at": started.isoformat(),
            "elapsed_seconds": max(0, int((now - started).total_seconds())),
        })
    return {"active": out, "count": len(out)}


# ── Switch / start ───────────────────────────────────────────────────────────

class SwitchBody(BaseModel):
    source: str
    item_id: str


@router.post("/switch")
def switch(body: SwitchBody, db: Session = Depends(get_db)):
    if body.source not in SOURCES:
        raise HTTPException(400, f"Unknown source: {body.source}")
    _verify_exists(body.source, body.item_id, db)
    now = datetime.now(UTC)

    task_id, work_log_id = _namespace(body.source, body.item_id)
    # Already timing exactly this item? No-op, so a double click can't lose time.
    already = db.query(WorkSession).filter(
        WorkSession.ended_at.is_(None),
        WorkSession.task_id == task_id if task_id else WorkSession.work_log_id == work_log_id,
    ).first()
    if already:
        started = already.started_at.replace(tzinfo=UTC) if already.started_at.tzinfo is None else already.started_at
        return {"session_id": already.id, "source": body.source, "item_id": body.item_id,
                "started_at": started.isoformat(), "stopped": [], "already_running": True}

    stopped = _stop_all_active(db, now)
    session = WorkSession(id=str(uuid4()), task_id=task_id, work_log_id=work_log_id,
                          started_at=now, ended_at=None, duration_seconds=0)
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"session_id": session.id, "source": body.source, "item_id": body.item_id,
            "started_at": now.isoformat(), "stopped": stopped, "already_running": False}


# ── Stop ─────────────────────────────────────────────────────────────────────

@router.post("/stop")
def stop(db: Session = Depends(get_db)):
    """Stop whatever is running, writing each source's ledger. Safe to retry: with
    nothing active it simply reports zero stopped."""
    now = datetime.now(UTC)
    stopped = _stop_all_active(db, now)
    db.commit()
    return {"stopped": stopped}


# ── Manual log ───────────────────────────────────────────────────────────────

class LogBody(BaseModel):
    source: str
    item_id: str
    minutes: int = Field(ge=1, le=24 * 60)
    date: str | None = None   # YYYY-MM-DD; defaults to today
    note: str = ""


@router.post("/log")
def log_time(body: LogBody, db: Session = Depends(get_db)):
    """Record a missed session against a source, by date + duration. Manual records
    keep only duration/date — no fabricated precise start/end for the ledger."""
    if body.source not in SOURCES:
        raise HTTPException(400, f"Unknown source: {body.source}")
    _verify_exists(body.source, body.item_id, db)
    now = datetime.now(UTC)
    day = body.date or now.strftime("%Y-%m-%d")
    seconds = body.minutes * 60

    if body.source == "task":
        # Task time is timestamp-based; anchor a manual entry at midday of the chosen
        # date so it allocates to that local day without inventing a real session time.
        start = datetime.fromisoformat(f"{day}T12:00:00")
        db.add(WorkSession(id=str(uuid4()), task_id=body.item_id,
                           started_at=start, ended_at=start + timedelta(seconds=seconds),
                           duration_seconds=seconds))
    elif body.source == "ticket":
        db.add(WorkTimeEntry(id=str(uuid4()), ticket_id=body.item_id, duration_seconds=seconds,
                             duration_minutes=body.minutes, logged_at=day, note=body.note))
        db.flush()
        _recalc_ticket(db.get(WorkTicket, body.item_id), db)
    else:  # worklog is single-dated; accumulate minutes onto it (its own date stands)
        log = db.get(WorkLog, body.item_id)
        log.duration_minutes = (log.duration_minutes or 0) + body.minutes

    db.commit()
    return {"ok": True, "source": body.source, "item_id": body.item_id, "seconds": seconds, "date": day}
