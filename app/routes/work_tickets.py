import json
import os
from datetime import datetime, UTC
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.company import Company
from app.models.work_log import WorkLog
from app.models.work_session import WorkSession
from app.models.work_ticket import WorkTicket, WorkTimeEntry, WorkTicketComment

router = APIRouter(prefix="/work-tickets", tags=["work-tickets"])

# ─── Schemas ──────────────────────────────────────────────────────────────────

class TicketCreate(BaseModel):
    company_id: str
    title: str
    description: str = ""
    type: str = "code"
    status: str = "todo"
    priority: str = "medium"
    estimated_minutes: int = 0
    ticket_ref: str = ""
    tags: list[str] = []
    proofs: list[dict] = []   # [{url, label}]
    notes: str = ""
    linked_goal_id: str | None = None


class TicketUpdate(BaseModel):
    company_id: str | None = None
    title: str | None = None
    description: str | None = None
    type: str | None = None
    status: str | None = None
    priority: str | None = None
    estimated_minutes: int | None = None
    ticket_ref: str | None = None
    tags: list[str] | None = None
    proofs: list[dict] | None = None
    notes: str | None = None
    linked_goal_id: str | None = None


class CommentCreate(BaseModel):
    body: str
    type: str = "note"   # note | proof


class TimeEntryCreate(BaseModel):
    duration_minutes: int
    duration_seconds: int = 0   # if 0, will derive from duration_minutes * 60
    logged_at: str              # YYYY-MM-DD
    note: str = ""


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _serialize_entry(e: WorkTimeEntry) -> dict:
    return {
        "id": e.id,
        "ticket_id": e.ticket_id,
        "duration_minutes": e.duration_minutes,
        "logged_at": e.logged_at,
        "note": e.note,
        "created_at": str(e.created_at),
    }


def _serialize(t: WorkTicket, db: Session, include_entries: bool = False) -> dict:
    running = db.query(WorkSession).filter(
        WorkSession.work_log_id == f"ticket:{t.id}",
        WorkSession.ended_at.is_(None),
    ).first()

    pct = 0
    if t.estimated_minutes and t.estimated_minutes > 0:
        pct = min(100, round((t.logged_minutes / t.estimated_minutes) * 100))

    result = {
        "id": t.id,
        "company_id": t.company_id,
        "company_name": t.company.name if t.company else "",
        "company_color": t.company.color if t.company else "#2D7A6B",
        "linked_goal_id": t.linked_goal_id,
        "title": t.title,
        "description": t.description or "",
        "type": t.type,
        "status": t.status,
        "priority": t.priority,
        "estimated_minutes": t.estimated_minutes or 0,
        "logged_minutes": t.logged_minutes or 0,
        "logged_seconds": t.logged_seconds or 0,
        "progress_pct": pct,
        "ticket_ref": t.ticket_ref or "",
        "tags": json.loads(t.tags or "[]"),
        "proofs": json.loads(t.proofs or "[]"),
        "notes": t.notes or "",
        "created_at": str(t.created_at),
        "started_at": str(t.started_at) if t.started_at else None,
        "completed_at": str(t.completed_at) if t.completed_at else None,
        "timer_running": running is not None,
        "timer_started_at": str(running.started_at) if running else None,
    }
    if include_entries:
        result["time_entries"] = [_serialize_entry(e) for e in t.time_entries]
        result["comments"] = [
            {
                "id": c.id,
                "body": c.body,
                "body_original": c.body_original if hasattr(c, 'body_original') else None,
                "type": c.type,
                "created_at": str(c.created_at),
            }
            for c in t.activity_comments
        ]
    return result


def _recalc_logged(ticket: WorkTicket, db: Session):
    """Recompute logged_seconds (and logged_minutes) from all time entries."""
    total_secs = sum(e.duration_seconds for e in ticket.time_entries)
    ticket.logged_seconds = total_secs
    ticket.logged_minutes = total_secs // 60


# ─── CRUD ─────────────────────────────────────────────────────────────────────

@router.get("")
def list_tickets(
    company_id: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(WorkTicket)
    if company_id:
        q = q.filter(WorkTicket.company_id == company_id)
    if status:
        statuses = status.split(",")
        q = q.filter(WorkTicket.status.in_(statuses))
    tickets = q.order_by(WorkTicket.created_at.desc()).all()
    return [_serialize(t, db) for t in tickets]


@router.post("", status_code=201)
def create_ticket(body: TicketCreate, db: Session = Depends(get_db)):
    company = db.get(Company, body.company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    ticket = WorkTicket(
        id=str(uuid4()),
        company_id=body.company_id,
        linked_goal_id=body.linked_goal_id,
        title=body.title,
        description=body.description,
        type=body.type,
        status=body.status,
        priority=body.priority,
        estimated_minutes=body.estimated_minutes,
        ticket_ref=body.ticket_ref,
        tags=json.dumps(body.tags),
        proofs=json.dumps(body.proofs),
        notes=body.notes,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return _serialize(ticket, db, include_entries=True)


@router.get("/{ticket_id}")
def get_ticket(ticket_id: str, db: Session = Depends(get_db)):
    ticket = db.get(WorkTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _serialize(ticket, db, include_entries=True)


@router.put("/{ticket_id}")
def update_ticket(ticket_id: str, body: TicketUpdate, db: Session = Depends(get_db)):
    ticket = db.get(WorkTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if body.company_id is not None: ticket.company_id = body.company_id
    if body.title is not None: ticket.title = body.title
    if body.description is not None: ticket.description = body.description
    if body.type is not None: ticket.type = body.type
    if body.priority is not None: ticket.priority = body.priority
    if body.estimated_minutes is not None: ticket.estimated_minutes = body.estimated_minutes
    if body.ticket_ref is not None: ticket.ticket_ref = body.ticket_ref
    if body.tags is not None: ticket.tags = json.dumps(body.tags)
    if body.proofs is not None: ticket.proofs = json.dumps(body.proofs)
    if body.notes is not None: ticket.notes = body.notes
    if body.linked_goal_id is not None: ticket.linked_goal_id = body.linked_goal_id

    if body.status is not None:
        old_status = ticket.status
        ticket.status = body.status
        now = datetime.now(UTC)
        if body.status == "in_progress" and old_status != "in_progress" and not ticket.started_at:
            ticket.started_at = now
        if body.status == "done" and not ticket.completed_at:
            ticket.completed_at = now
        if body.status != "done":
            ticket.completed_at = None

    db.commit()
    db.refresh(ticket)
    return _serialize(ticket, db, include_entries=True)


@router.delete("/{ticket_id}", status_code=204)
def delete_ticket(ticket_id: str, db: Session = Depends(get_db)):
    ticket = db.get(WorkTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    db.delete(ticket)
    db.commit()


# ─── Time Entries ─────────────────────────────────────────────────────────────

@router.post("/{ticket_id}/log")
def log_time(ticket_id: str, body: TimeEntryCreate, db: Session = Depends(get_db)):
    ticket = db.get(WorkTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    secs = body.duration_seconds if body.duration_seconds else body.duration_minutes * 60
    entry = WorkTimeEntry(
        id=str(uuid4()),
        ticket_id=ticket_id,
        duration_seconds=secs,
        duration_minutes=secs // 60,
        logged_at=body.logged_at,
        note=body.note,
    )
    db.add(entry)

    # Auto-mark in_progress when first time is logged
    if ticket.status == "todo":
        ticket.status = "in_progress"
        if not ticket.started_at:
            ticket.started_at = datetime.now(UTC)

    db.flush()
    _recalc_logged(ticket, db)
    db.commit()
    db.refresh(ticket)
    return _serialize(ticket, db, include_entries=True)


@router.delete("/{ticket_id}/log/{entry_id}", status_code=204)
def delete_time_entry(ticket_id: str, entry_id: str, db: Session = Depends(get_db)):
    entry = db.get(WorkTimeEntry, entry_id)
    if not entry or entry.ticket_id != ticket_id:
        raise HTTPException(status_code=404, detail="Entry not found")
    ticket = db.get(WorkTicket, ticket_id)
    db.delete(entry)
    db.flush()
    if ticket:
        _recalc_logged(ticket, db)
    db.commit()


# ─── Comments / Activity ──────────────────────────────────────────────────────

@router.post("/{ticket_id}/comments")
def add_comment(ticket_id: str, body: CommentCreate, db: Session = Depends(get_db)):
    ticket = db.get(WorkTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    comment = WorkTicketComment(
        id=str(uuid4()),
        ticket_id=ticket_id,
        body=body.body.strip(),
        type=body.type,
    )
    db.add(comment)

    # If it's a proof URL, also append to the ticket's proofs JSON
    if body.type == "proof":
        proofs = json.loads(ticket.proofs or "[]")
        if not any(p.get("url") == body.body for p in proofs):
            proofs.append({"url": body.body.strip(), "label": ""})
            ticket.proofs = json.dumps(proofs)

    db.commit()
    db.refresh(ticket)
    return _serialize(ticket, db, include_entries=True)


@router.patch("/{ticket_id}/comments/{comment_id}")
def update_comment(ticket_id: str, comment_id: str, body: dict, db: Session = Depends(get_db)):
    comment = db.get(WorkTicketComment, comment_id)
    if not comment or comment.ticket_id != ticket_id:
        raise HTTPException(status_code=404, detail="Comment not found")
    if "body" in body:
        comment.body = body["body"].strip()
    db.commit()
    db.refresh(comment)
    ticket = db.get(WorkTicket, ticket_id)
    return _serialize(ticket, db, include_entries=True)


@router.delete("/{ticket_id}/comments/{comment_id}", status_code=204)
def delete_comment(ticket_id: str, comment_id: str, db: Session = Depends(get_db)):
    comment = db.get(WorkTicketComment, comment_id)
    if not comment or comment.ticket_id != ticket_id:
        raise HTTPException(status_code=404, detail="Comment not found")
    db.delete(comment)
    db.commit()


# ─── Timer (uses work_log_id field with "ticket:" prefix as a namespace) ───────

@router.post("/{ticket_id}/timer/start")
def start_ticket_timer(ticket_id: str, db: Session = Depends(get_db)):
    ticket = db.get(WorkTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    namespace = f"ticket:{ticket_id}"
    running = db.query(WorkSession).filter(
        WorkSession.work_log_id == namespace,
        WorkSession.ended_at.is_(None),
    ).first()
    if running:
        return {"message": "Already running", "session_id": running.id, "started_at": str(running.started_at)}

    now = datetime.now(UTC)
    session = WorkSession(
        id=str(uuid4()),
        task_id=None,
        work_log_id=namespace,
        started_at=now,
        ended_at=None,
        duration_seconds=0,
    )
    db.add(session)

    if ticket.status in ("todo", "backlog"):
        ticket.status = "in_progress"
        if not ticket.started_at:
            ticket.started_at = now

    db.commit()
    return {"session_id": session.id, "started_at": str(now)}


@router.post("/{ticket_id}/timer/stop")
def stop_ticket_timer(ticket_id: str, db: Session = Depends(get_db)):
    ticket = db.get(WorkTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    namespace = f"ticket:{ticket_id}"
    running = db.query(WorkSession).filter(
        WorkSession.work_log_id == namespace,
        WorkSession.ended_at.is_(None),
    ).first()
    if not running:
        raise HTTPException(status_code=400, detail="No running timer")

    now = datetime.now(UTC)
    started = running.started_at.replace(tzinfo=UTC) if running.started_at.tzinfo is None else running.started_at
    elapsed_secs = max(1, int((now - started).total_seconds()))

    running.ended_at = now
    running.duration_seconds = elapsed_secs

    # Create a time entry with exact seconds — no rounding
    today_str = now.strftime("%Y-%m-%d")
    entry = WorkTimeEntry(
        id=str(uuid4()),
        ticket_id=ticket_id,
        duration_seconds=elapsed_secs,
        duration_minutes=elapsed_secs // 60,
        logged_at=today_str,
        note="",
    )
    db.add(entry)
    db.flush()
    _recalc_logged(ticket, db)
    db.commit()
    db.refresh(ticket)
    return {
        "duration_seconds": elapsed_secs,
        "duration_minutes": elapsed_secs // 60,
        "logged_seconds": ticket.logged_seconds,
        "logged_minutes": ticket.logged_minutes,
    }


# ─── Weekly Report ─────────────────────────────────────────────────────────────

class WeeklyReportBody(BaseModel):
    company_id: str | None = None   # None = all companies
    date_from: str                  # YYYY-MM-DD (Monday)
    date_to: str                    # YYYY-MM-DD (Sunday)


@router.post("/report/weekly")
def weekly_report(body: WeeklyReportBody, db: Session = Depends(get_db)):
    """Generate a structured weekly work report for a company (or all companies)."""

    # ── Company display name ──
    if body.company_id:
        company = db.query(Company).filter(Company.id == body.company_id).first()
        company_name = company.name if company else "Unknown"
    else:
        company_name = "All Clients"

    # ── Work tickets active this week ──
    # A ticket "belongs" to this week if it was completed in range OR had time logged in range
    ticket_ids_with_time = {
        row[0] for row in db.execute(
            __import__("sqlalchemy").text(
                "SELECT DISTINCT ticket_id FROM work_time_entries WHERE logged_at >= :df AND logged_at <= :dt"
            ),
            {"df": body.date_from, "dt": body.date_to},
        ).fetchall()
    }

    ticket_query = db.query(WorkTicket)
    if body.company_id:
        ticket_query = ticket_query.filter(WorkTicket.company_id == body.company_id)

    all_tickets = ticket_query.all()

    # Filter to tickets relevant this week
    def ticket_in_range(t):
        if t.id in ticket_ids_with_time:
            return True
        completed_str = t.completed_at.strftime("%Y-%m-%d") if isinstance(t.completed_at, __import__("datetime").datetime) else (t.completed_at or "")[:10]
        if completed_str and body.date_from <= completed_str <= body.date_to:
            return True
        return False

    relevant_tickets = [t for t in all_tickets if ticket_in_range(t)]

    # Per-ticket logged seconds from time entries in range
    ticket_seconds: dict[str, int] = {}
    for row in db.execute(
        __import__("sqlalchemy").text(
            "SELECT ticket_id, SUM(duration_seconds) FROM work_time_entries "
            "WHERE logged_at >= :df AND logged_at <= :dt GROUP BY ticket_id"
        ),
        {"df": body.date_from, "dt": body.date_to},
    ).fetchall():
        ticket_seconds[row[0]] = int(row[1] or 0)

    # ── Work logs (standalone) in range ──
    log_query = db.query(WorkLog).filter(
        WorkLog.logged_at >= body.date_from,
        WorkLog.logged_at <= body.date_to,
    )
    if body.company_id:
        log_query = log_query.filter(WorkLog.company_id == body.company_id)
    standalone_logs = log_query.all()

    # ── Categorise tickets ──
    completed, in_progress, blocked = [], [], []
    type_seconds: dict[str, int] = {}

    for t in relevant_tickets:
        secs = ticket_seconds.get(t.id, t.logged_seconds or 0)
        entry = {
            "id": t.id,
            "title": t.title,
            "type": t.type,
            "priority": t.priority,
            "status": t.status,
            "logged_seconds": secs,
            "ticket_ref": t.ticket_ref or "",
        }
        # Accumulate type breakdown
        type_seconds[t.type] = type_seconds.get(t.type, 0) + secs

        if t.status == "done":
            completed.append(entry)
        elif t.status == "blocked":
            blocked.append(entry)
        else:
            in_progress.append(entry)

    # Add standalone log seconds to type breakdown
    log_seconds_total = 0
    for l in standalone_logs:
        secs = (l.duration_minutes or 0) * 60
        type_seconds[l.type] = type_seconds.get(l.type, 0) + secs
        log_seconds_total += secs

    total_ticket_secs = sum(ticket_seconds.get(t.id, t.logged_seconds or 0) for t in relevant_tickets)
    total_seconds = total_ticket_secs + log_seconds_total

    def fmt_hours(secs: int) -> str:
        h = secs / 3600
        return f"{h:.1f}h"

    # ── AI narrative ──
    def ticket_line(e):
        ref = f" [{e['ticket_ref']}]" if e['ticket_ref'] else ""
        return f"- {e['title']}{ref} ({fmt_hours(e['logged_seconds'])})"

    completed_lines = "\n".join(ticket_line(e) for e in completed) or "  (none)"
    in_progress_lines = "\n".join(ticket_line(e) for e in in_progress) or "  (none)"
    blocked_lines = "\n".join(ticket_line(e) for e in blocked) or "  (none)"
    type_lines = "\n".join(
        f"- {k.title()}: {fmt_hours(v)}" for k, v in sorted(type_seconds.items(), key=lambda x: -x[1])
    ) or "  (none)"
    log_lines = "\n".join(
        f"- [{l.logged_at}] {l.type.upper()}: {l.title} ({l.duration_minutes or 0} min)"
        for l in standalone_logs
    ) or "  (none)"

    prompt = f"""Write a professional weekly work report for {company_name}, week of {body.date_from} to {body.date_to}.

TOTAL TIME LOGGED: {fmt_hours(total_seconds)}
TICKETS COMPLETED ({len(completed)}):
{completed_lines}

IN PROGRESS ({len(in_progress)}):
{in_progress_lines}

BLOCKED ({len(blocked)}):
{blocked_lines}

TIME BY TYPE:
{type_lines}

STANDALONE WORK LOGS:
{log_lines}

Format the report exactly as:
## Summary
(2–3 sentence executive overview of the week's output)

## Completed Work
(bullet list with ticket refs and hours — be specific)

## In Progress
(what's actively being worked on heading into next week)

## Time Breakdown
(hours by type + total — be precise)

## Next Week
(priorities + any blockers to address)

Be specific and professional. Use actual ticket titles and hours. Do not invent anything not in the data."""

    ai_narrative = ""
    api_key = os.getenv("GROQ_API_KEY")
    if api_key and (relevant_tickets or standalone_logs):
        try:
            client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
            resp = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=600,
                temperature=0.3,
            )
            ai_narrative = resp.choices[0].message.content.strip()
        except Exception:
            ai_narrative = ""

    return {
        "company_name": company_name,
        "date_from": body.date_from,
        "date_to": body.date_to,
        "total_seconds": total_seconds,
        "tickets_completed": len(completed),
        "tickets_in_progress": len(in_progress),
        "tickets_blocked": len(blocked),
        "by_type": type_seconds,
        "completed_tickets": completed,
        "in_progress_tickets": in_progress,
        "blocked_tickets": blocked,
        "standalone_logs": [
            {"title": l.title, "type": l.type, "duration_minutes": l.duration_minutes or 0, "logged_at": l.logged_at}
            for l in standalone_logs
        ],
        "ai_narrative": ai_narrative,
    }
