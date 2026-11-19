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


def _stop_session(s: WorkSession, db: Session, now: datetime, keep_seconds: int | None = None) -> dict:
    """End a running session and write the correct ledger entry for its source.

    ``keep_seconds`` is for a timer that was left running: record only that much
    (never more than really elapsed), ending the session where the work ended.
    Zero discards the session without recording anything."""
    started = s.started_at.replace(tzinfo=UTC) if s.started_at.tzinfo is None else s.started_at
    elapsed = max(1, int((now - started).total_seconds()))
    source, item_id = _session_source(s)
    if keep_seconds is not None:
        if keep_seconds <= 0:
            db.delete(s)
            return {"source": source, "item_id": item_id, "seconds": 0, "discarded_seconds": elapsed}
        if keep_seconds < elapsed:
            elapsed = keep_seconds
            now = started + timedelta(seconds=elapsed)
    s.ended_at = now
    s.duration_seconds = elapsed

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


def _stop_all_active(db: Session, now: datetime, keep_seconds: int | None = None) -> list[dict]:
    active = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).all()
    return [_stop_session(s, db, now, keep_seconds) for s in active]


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

class StopBody(BaseModel):
    keep_minutes: int | None = Field(default=None, ge=0, le=24 * 60)
    source: str | None = None     # with item_id: stop only that item's timer
    item_id: str | None = None


@router.post("/stop")
def stop(body: StopBody | None = None, db: Session = Depends(get_db)):
    """Stop whatever is running, writing each source's ledger. Safe to retry: with
    nothing active it simply reports zero stopped. ``keep_minutes`` records only
    that much of a timer that was left running (0 discards it)."""
    now = datetime.now(UTC)
    keep = body.keep_minutes * 60 if body and body.keep_minutes is not None else None
    if body and body.source and body.item_id:
        _check_source(body.source, body.item_id, db)
        running = _running_session(body.source, body.item_id, db)
        stopped = [_stop_session(running, db, now, keep)] if running else []
    else:
        stopped = _stop_all_active(db, now, keep)
    db.commit()
    return {"stopped": stopped}


# ── Manual log ───────────────────────────────────────────────────────────────

class LogBody(BaseModel):
    source: str
    item_id: str
    minutes: int = Field(ge=-24 * 60, le=24 * 60)   # negative takes time off (a correction)
    date: str | None = None   # YYYY-MM-DD; defaults to today
    note: str = ""


@router.post("/log")
def log_time(body: LogBody, db: Session = Depends(get_db)):
    """Record a missed session against a source, by date + duration. Manual records
    keep only duration/date — no fabricated precise start/end for the ledger."""
    if body.source not in SOURCES:
        raise HTTPException(400, f"Unknown source: {body.source}")
    _verify_exists(body.source, body.item_id, db)
    if body.minutes == 0:
        raise HTTPException(400, "Enter the minutes to log, or a minus number to take time off")
    now = datetime.now(UTC)
    day = body.date or now.strftime("%Y-%m-%d")
    seconds = body.minutes * 60
    if body.minutes < 0:
        # A correction: take the time off what was recorded most recently.
        _take_off(body.source, body.item_id, -seconds, db)
        db.commit()
        return {"ok": True, "source": body.source, "item_id": body.item_id, "seconds": seconds, "date": day}

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


# ── Corrections: a timer left running, or a session that should not count ─────
#
# Each source keeps its own ledger (see the module docstring), so a correction is
# made on that ledger, newest record first, and never leaves a negative row behind.

def _fmt(seconds: int) -> str:
    h, m = seconds // 3600, (seconds % 3600) // 60
    return f"{h}h {m}m" if h and m else f"{h}h" if h else f"{m}m"


def _entry_seconds(e: WorkTimeEntry) -> int:
    return int(e.duration_seconds or (e.duration_minutes or 0) * 60)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return (dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt).isoformat()


def _ended_sessions(source: str, item_id: str, db: Session) -> list[WorkSession]:
    task_id, work_log_id = _namespace(source, item_id)
    q = db.query(WorkSession).filter(WorkSession.ended_at.isnot(None))
    q = q.filter(WorkSession.task_id == task_id) if task_id else q.filter(WorkSession.work_log_id == work_log_id)
    return q.order_by(WorkSession.ended_at.desc()).all()


def _running_session(source: str, item_id: str, db: Session) -> WorkSession | None:
    task_id, work_log_id = _namespace(source, item_id)
    q = db.query(WorkSession).filter(WorkSession.ended_at.is_(None))
    q = q.filter(WorkSession.task_id == task_id) if task_id else q.filter(WorkSession.work_log_id == work_log_id)
    return q.first()


def _ticket_entries(ticket_id: str, db: Session) -> list[WorkTimeEntry]:
    return (db.query(WorkTimeEntry).filter(WorkTimeEntry.ticket_id == ticket_id)
            .order_by(WorkTimeEntry.created_at.desc()).all())


def _resize_session(s: WorkSession, seconds: int, db: Session) -> None:
    """Shrink a saved session to ``seconds`` (it ended earlier), or drop it at zero."""
    if seconds <= 0:
        db.delete(s)
        return
    s.duration_seconds = seconds
    s.ended_at = s.started_at + timedelta(seconds=seconds)


def _resize_entry(e: WorkTimeEntry, seconds: int, db: Session) -> None:
    """Shrink a ticket time entry, keeping the timer session it came from in step."""
    old = _entry_seconds(e)
    twin = next((s for s in _ended_sessions("ticket", e.ticket_id, db) if s.duration_seconds == old), None)
    if twin:
        _resize_session(twin, seconds, db)
    if seconds <= 0:
        db.delete(e)
    else:
        e.duration_seconds = seconds
        e.duration_minutes = seconds // 60


def _recorded_total(source: str, item_id: str, db: Session) -> int:
    if source == "task":
        return sum(s.duration_seconds or 0 for s in _ended_sessions(source, item_id, db))
    if source == "ticket":
        return sum(_entry_seconds(e) for e in _ticket_entries(item_id, db))
    return (db.get(WorkLog, item_id).duration_minutes or 0) * 60


def _take_off(source: str, item_id: str, seconds: int, db: Session) -> None:
    total = _recorded_total(source, item_id, db)
    if total <= 0:
        raise HTTPException(400, "No time is recorded on this yet")
    if seconds > total:
        raise HTTPException(400, f"Only {_fmt(total)} is recorded on this — cannot take off {_fmt(seconds)}")

    left = seconds
    if source == "task":
        for s in _ended_sessions(source, item_id, db):
            if left <= 0:
                break
            cut = min(left, s.duration_seconds or 0)
            _resize_session(s, (s.duration_seconds or 0) - cut, db)
            left -= cut
    elif source == "ticket":
        for e in _ticket_entries(item_id, db):
            if left <= 0:
                break
            cut = min(left, _entry_seconds(e))
            _resize_entry(e, _entry_seconds(e) - cut, db)
            left -= cut
        db.flush()
        _recalc_ticket(db.get(WorkTicket, item_id), db)
    else:
        log = db.get(WorkLog, item_id)
        log.duration_minutes = max(0, (log.duration_minutes or 0) - seconds // 60)
        for s in _ended_sessions(source, item_id, db):
            if left <= 0:
                break
            cut = min(left, s.duration_seconds or 0)
            _resize_session(s, (s.duration_seconds or 0) - cut, db)
            left -= cut


def _check_source(source: str, item_id: str, db: Session) -> None:
    if source not in SOURCES:
        raise HTTPException(400, f"Unknown source: {source}")
    _verify_exists(source, item_id, db)


@router.get("/item")
def item_time(source: str, item_id: str, db: Session = Depends(get_db)):
    """What a correction would act on: the running session (if any), the most
    recent recorded one, and the total recorded on the item."""
    _check_source(source, item_id, db)
    now = datetime.now(UTC)
    running = _running_session(source, item_id, db)
    last = None
    if source == "ticket":
        entries = _ticket_entries(item_id, db)
        if entries:
            e = entries[0]
            twin = next((s for s in _ended_sessions(source, item_id, db)
                         if s.duration_seconds == _entry_seconds(e)), None)
            last = {"seconds": _entry_seconds(e), "ended_at": _iso(twin.ended_at) if twin else None,
                    "date": e.logged_at}
    else:
        sessions = _ended_sessions(source, item_id, db)
        if sessions:
            s = sessions[0]
            last = {"seconds": s.duration_seconds or 0, "ended_at": _iso(s.ended_at), "date": None}
    started = _iso(running.started_at) if running else None
    return {
        "source": source, "item_id": item_id,
        "running": {"started_at": started,
                    "elapsed_seconds": max(0, int((now - datetime.fromisoformat(started)).total_seconds()))}
        if running else None,
        "last": last,
        "total_seconds": _recorded_total(source, item_id, db),
    }


class ItemBody(BaseModel):
    source: str
    item_id: str


@router.post("/undo-last")
def undo_last(body: ItemBody, db: Session = Depends(get_db)):
    """Throw away the latest session on an item: the one still running if there is
    one (nothing is recorded), otherwise the most recent recorded one."""
    _check_source(body.source, body.item_id, db)
    now = datetime.now(UTC)
    running = _running_session(body.source, body.item_id, db)
    if running:
        out = _stop_session(running, db, now, keep_seconds=0)
        db.commit()
        return {"ok": True, "was_running": True, "removed_seconds": out["discarded_seconds"]}

    if body.source == "ticket":
        entries = _ticket_entries(body.item_id, db)
        if not entries:
            raise HTTPException(404, "No session to undo")
        removed = _entry_seconds(entries[0])
        _resize_entry(entries[0], 0, db)
        db.flush()
        _recalc_ticket(db.get(WorkTicket, body.item_id), db)
    else:
        sessions = _ended_sessions(body.source, body.item_id, db)
        if not sessions:
            raise HTTPException(404, "No session to undo")
        removed = sessions[0].duration_seconds or 0
        if body.source == "worklog":   # undo exactly what stopping the timer added
            log = db.get(WorkLog, body.item_id)
            log.duration_minutes = max(0, (log.duration_minutes or 0) - max(1, removed // 60))
        db.delete(sessions[0])
    db.commit()
    return {"ok": True, "was_running": False, "removed_seconds": removed}
