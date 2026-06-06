import json
import os
from datetime import datetime, UTC, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.company import Company
from app.models.work_log import WorkLog
from app.models.work_session import WorkSession
from app.models.work_ticket import WorkTicket, WorkTimeEntry

router = APIRouter(prefix="/work-logs", tags=["work-logs"])

# ─── Schemas ──────────────────────────────────────────────────────────────────

class ProofItem(BaseModel):
    url: str
    label: str = ""   # auto-derived if empty


class WorkLogCreate(BaseModel):
    company_id: str
    title: str
    type: str = "code"      # code | research | planning | review | meeting
    status: str = "todo"    # todo | in_progress | done | blocked
    notes: str = ""
    tags: list[str] = []
    proofs: list[ProofItem] = []
    duration_minutes: int = 0
    logged_at: str           # YYYY-MM-DD
    linked_goal_id: str | None = None


class WorkLogUpdate(BaseModel):
    title: str | None = None
    type: str | None = None
    status: str | None = None
    notes: str | None = None
    tags: list[str] | None = None
    proofs: list[ProofItem] | None = None
    duration_minutes: int | None = None
    logged_at: str | None = None
    linked_goal_id: str | None = None


class WorkLogRead(BaseModel):
    id: str
    company_id: str
    company_name: str
    company_color: str
    linked_goal_id: str | None
    title: str
    type: str
    status: str
    notes: str
    tags: list[str]
    proofs: list[dict]
    duration_minutes: int
    logged_at: str
    created_at: str
    timer_running: bool = False

    model_config = {"from_attributes": True}


class AIQueryBody(BaseModel):
    mode: str = "standup"   # standup | weekly_summary | research_digest | payment_report
    date_from: str | None = None   # YYYY-MM-DD
    date_to: str | None = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _derive_label(url: str) -> str:
    """Auto-derive a human label from a URL."""
    if not url:
        return url
    if "jira" in url.lower():
        # Try to extract ticket ID e.g. PROJ-123
        parts = url.rstrip("/").split("/")
        for p in reversed(parts):
            if "-" in p and p.split("-")[0].isupper():
                return p
    if "github.com" in url:
        parts = url.rstrip("/").split("/")
        if "pull" in parts:
            idx = parts.index("pull")
            if idx + 1 < len(parts):
                return f"PR #{parts[idx+1]}"
        if "issues" in parts:
            idx = parts.index("issues")
            if idx + 1 < len(parts):
                return f"Issue #{parts[idx+1]}"
    if "linear.app" in url:
        parts = url.rstrip("/").split("/")
        return parts[-1] if parts else url
    # Generic: return domain + last path segment
    try:
        from urllib.parse import urlparse
        p = urlparse(url)
        last = p.path.rstrip("/").split("/")[-1]
        return last or p.netloc
    except Exception:
        return url


def _serialize(log: WorkLog, db: Session) -> dict:
    running = db.query(WorkSession).filter(
        WorkSession.work_log_id == log.id,
        WorkSession.ended_at.is_(None),
    ).first()
    return {
        "id": log.id,
        "company_id": log.company_id,
        "company_name": log.company.name if log.company else "",
        "company_color": log.company.color if log.company else "#2D7A6B",
        "linked_goal_id": log.linked_goal_id,
        "title": log.title,
        "type": log.type,
        "status": log.status,
        "notes": log.notes or "",
        "tags": json.loads(log.tags or "[]"),
        "proofs": json.loads(log.proofs or "[]"),
        "duration_minutes": log.duration_minutes,
        "logged_at": log.logged_at,
        "created_at": str(log.created_at),
        "timer_running": running is not None,
    }


# ─── CRUD routes ──────────────────────────────────────────────────────────────

@router.get("")
def list_work_logs(
    company_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(WorkLog)
    if company_id:
        q = q.filter(WorkLog.company_id == company_id)
    if date_from:
        q = q.filter(WorkLog.logged_at >= date_from)
    if date_to:
        q = q.filter(WorkLog.logged_at <= date_to)
    if status:
        q = q.filter(WorkLog.status == status)
    logs = q.order_by(WorkLog.logged_at.desc(), WorkLog.created_at.desc()).all()
    return [_serialize(l, db) for l in logs]


@router.post("", status_code=201)
def create_work_log(body: WorkLogCreate, db: Session = Depends(get_db)):
    company = db.get(Company, body.company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    proofs = [
        {"url": p.url, "label": p.label or _derive_label(p.url)}
        for p in body.proofs
    ]

    log = WorkLog(
        id=str(uuid4()),
        company_id=body.company_id,
        linked_goal_id=body.linked_goal_id,
        title=body.title,
        type=body.type,
        status=body.status,
        notes=body.notes,
        tags=json.dumps(body.tags),
        proofs=json.dumps(proofs),
        duration_minutes=body.duration_minutes,
        logged_at=body.logged_at,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return _serialize(log, db)


@router.get("/{log_id}")
def get_work_log(log_id: str, db: Session = Depends(get_db)):
    log = db.get(WorkLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Work log not found")
    return _serialize(log, db)


@router.put("/{log_id}")
def update_work_log(log_id: str, body: WorkLogUpdate, db: Session = Depends(get_db)):
    log = db.get(WorkLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Work log not found")
    if body.title is not None:
        log.title = body.title
    if body.type is not None:
        log.type = body.type
    if body.status is not None:
        log.status = body.status
    if body.notes is not None:
        log.notes = body.notes
    if body.tags is not None:
        log.tags = json.dumps(body.tags)
    if body.proofs is not None:
        proofs = [{"url": p.url, "label": p.label or _derive_label(p.url)} for p in body.proofs]
        log.proofs = json.dumps(proofs)
    if body.duration_minutes is not None:
        log.duration_minutes = body.duration_minutes
    if body.logged_at is not None:
        log.logged_at = body.logged_at
    if body.linked_goal_id is not None:
        log.linked_goal_id = body.linked_goal_id
    db.commit()
    db.refresh(log)
    return _serialize(log, db)


@router.delete("/{log_id}", status_code=204)
def delete_work_log(log_id: str, db: Session = Depends(get_db)):
    log = db.get(WorkLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Work log not found")
    db.delete(log)
    db.commit()


# ─── Timer ────────────────────────────────────────────────────────────────────

@router.post("/{log_id}/timer/start")
def start_work_timer(log_id: str, db: Session = Depends(get_db)):
    log = db.get(WorkLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Work log not found")
    # Stop any existing running session for this log
    running = db.query(WorkSession).filter(
        WorkSession.work_log_id == log_id,
        WorkSession.ended_at.is_(None),
    ).first()
    if running:
        return {"message": "Already running", "session_id": running.id}

    now = datetime.now(UTC)
    session = WorkSession(
        id=str(uuid4()),
        task_id=None,
        work_log_id=log_id,
        started_at=now,
        ended_at=None,
        duration_seconds=0,
    )
    db.add(session)
    # Update status to in_progress
    if log.status == "todo":
        log.status = "in_progress"
    db.commit()
    return {"session_id": session.id, "started_at": str(now)}


@router.post("/{log_id}/timer/stop")
def stop_work_timer(log_id: str, db: Session = Depends(get_db)):
    log = db.get(WorkLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Work log not found")
    running = db.query(WorkSession).filter(
        WorkSession.work_log_id == log_id,
        WorkSession.ended_at.is_(None),
    ).first()
    if not running:
        raise HTTPException(status_code=400, detail="No running timer for this log")
    now = datetime.now(UTC)
    elapsed = int((now - running.started_at.replace(tzinfo=UTC)).total_seconds())
    running.ended_at = now
    running.duration_seconds = elapsed
    # Accumulate into duration_minutes
    log.duration_minutes = (log.duration_minutes or 0) + max(1, elapsed // 60)
    db.commit()
    return {"duration_seconds": elapsed, "duration_minutes": log.duration_minutes}


# ─── Stats ────────────────────────────────────────────────────────────────────

@router.get("/stats/weekly")
def weekly_stats(
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
):
    """Returns hours per company per week — for payment reports."""
    from datetime import date
    today = date.today()
    # Default: current week Mon–Sun
    if not date_from:
        monday = today - timedelta(days=today.weekday())
        date_from = monday.isoformat()
    if not date_to:
        date_to = today.isoformat()

    today_str = today.isoformat()

    def _company_meta(db, cid):
        c = db.get(Company, cid)
        return c.name if c else cid, c.color if c else "#2D7A6B"

    def aggregate(date_from_s, date_to_s):
        by: dict[str, dict] = {}
        total = 0

        # Work logs
        logs = db.query(WorkLog).filter(
            WorkLog.logged_at >= date_from_s,
            WorkLog.logged_at <= date_to_s,
        ).all()
        for log in logs:
            cid = log.company_id
            if cid not in by:
                name, color = _company_meta(db, cid)
                by[cid] = {"company_id": cid, "company_name": name, "company_color": color, "minutes": 0, "seconds": 0}
            mins = log.duration_minutes or 0
            by[cid]["minutes"] += mins
            by[cid]["seconds"] += mins * 60
            total += mins

        # Ticket time entries
        entries = (
            db.query(WorkTimeEntry, WorkTicket.company_id)
            .join(WorkTicket, WorkTimeEntry.ticket_id == WorkTicket.id)
            .filter(WorkTimeEntry.logged_at >= date_from_s, WorkTimeEntry.logged_at <= date_to_s)
            .all()
        )
        for entry, cid in entries:
            if cid not in by:
                name, color = _company_meta(db, cid)
                by[cid] = {"company_id": cid, "company_name": name, "company_color": color, "minutes": 0, "seconds": 0}
            secs = entry.duration_seconds or 0
            by[cid]["seconds"] += secs
            by[cid]["minutes"] = by[cid]["seconds"] // 60
            total = sum(v["minutes"] for v in by.values())

        return list(by.values()), total

    week_by_company, total_minutes = aggregate(date_from, date_to)
    today_by_company, today_total = aggregate(today_str, today_str)

    # Daily breakdown (work logs only, for chart)
    logs_all = db.query(WorkLog).filter(
        WorkLog.logged_at >= date_from,
        WorkLog.logged_at <= date_to,
    ).all()
    by_day: dict[str, int] = {}
    for log in logs_all:
        d = log.logged_at
        by_day[d] = by_day.get(d, 0) + (log.duration_minutes or 0)

    return {
        "date_from": date_from,
        "date_to": date_to,
        "total_minutes": total_minutes,
        "today_total_minutes": today_total,
        "by_company": week_by_company,
        "today_by_company": today_by_company,
        "by_day": [{"date": d, "minutes": m} for d, m in sorted(by_day.items())],
    }


# ─── AI endpoints ─────────────────────────────────────────────────────────────

@router.post("/ai/generate")
def ai_generate(body: AIQueryBody, db: Session = Depends(get_db)):
    """Generate AI content from work logs: standup, weekly summary, research digest, payment report."""
    from datetime import date
    today = date.today()

    # Determine date range
    if body.mode == "standup":
        date_from = body.date_from or today.isoformat()
        date_to = body.date_to or today.isoformat()
        # Include yesterday too for "what did you do yesterday"
        yesterday = (today - timedelta(days=1)).isoformat()
        logs_yesterday = db.query(WorkLog).filter(WorkLog.logged_at == yesterday).all()
        logs_today = db.query(WorkLog).filter(WorkLog.logged_at == today.isoformat()).all()
        all_logs = logs_yesterday + logs_today
    elif body.mode == "payment_report":
        monday = today - timedelta(days=today.weekday())
        date_from = body.date_from or monday.isoformat()
        date_to = body.date_to or today.isoformat()
        all_logs = db.query(WorkLog).filter(
            WorkLog.logged_at >= date_from,
            WorkLog.logged_at <= date_to,
        ).all()
    else:
        monday = today - timedelta(days=today.weekday())
        date_from = body.date_from or monday.isoformat()
        date_to = body.date_to or today.isoformat()
        all_logs = db.query(WorkLog).filter(
            WorkLog.logged_at >= date_from,
            WorkLog.logged_at <= date_to,
        ).all()

    if not all_logs:
        return {"result": "No work logs found for the selected period."}

    # Build context string
    def fmt_log(l):
        tags = json.loads(l.tags or "[]")
        proofs = json.loads(l.proofs or "[]")
        proof_str = ", ".join(p.get("label") or p.get("url", "") for p in proofs)
        parts = [f"[{l.logged_at}] {l.type.upper()} — {l.title} ({l.duration_minutes or 0} min)"]
        if l.notes:
            parts.append(f"  Notes: {l.notes[:300]}")
        if tags:
            parts.append(f"  Tags: {', '.join(tags)}")
        if proof_str:
            parts.append(f"  Proofs: {proof_str}")
        return "\n".join(parts)

    context = "\n\n".join(fmt_log(l) for l in all_logs)

    # Build prompt per mode
    prompts = {
        "standup": f"""You are helping a developer write a daily standup update.
Based on their work logs, write a concise standup in this format:
**Yesterday:** (what was done)
**Today:** (what's planned — use in_progress/todo items)
**Blockers:** (any blocked items, or "None")

Work logs:
{context}

Keep it brief and professional. Use bullet points within each section.""",

        "weekly_summary": f"""You are summarizing a developer's work week for a personal review.
Write a structured weekly summary:
- **Key accomplishments** (what shipped/completed)
- **Research & findings** (key discoveries)
- **Hours breakdown** (by type if visible)
- **Next week priorities** (based on open/blocked items)

Work logs ({date_from} to {date_to}):
{context}

Be specific, mention ticket/PR references where visible. Max 300 words.""",

        "research_digest": f"""You are compiling research notes into a clean digest document.
Identify all research-type work logs and synthesize them into:
- **Key findings**
- **Decisions made**
- **Open questions**
- **Next steps**

Work logs:
{context}

Focus only on research/planning entries. Write in clear prose, not just bullet points.""",

        "payment_report": f"""You are generating a professional payment/timesheet report.
Summarize work done by company for billing purposes:

For each company, list:
- Total hours (duration_minutes ÷ 60)
- Breakdown by work type
- Key deliverables / tickets referenced

Format it as a clean text report suitable to send to a client.

Work logs ({date_from} to {date_to}):
{context}""",
    }

    prompt = prompts.get(body.mode, prompts["standup"])

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return {"result": "AI not configured (missing GROQ_API_KEY)."}

    client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=800,
        temperature=0.4,
    )
    result = resp.choices[0].message.content.strip()
    return {"result": result, "log_count": len(all_logs), "date_from": date_from, "date_to": date_to}
