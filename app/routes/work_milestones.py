"""Milestones: dated checkpoints a client's tickets roll up to."""
from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.company import Company
from app.models.work_milestone import WorkMilestone
from app.models.work_ticket import WorkTicket

router = APIRouter(prefix="/work-milestones", tags=["work-milestones"])

STATUSES = ("open", "done")


class MilestoneCreate(BaseModel):
    company_id: str
    title: str
    description: str = ""
    due_date: str | None = None
    linked_goal_id: str | None = None
    status: str = "open"


class MilestoneUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    due_date: str | None = None        # "" clears the date
    linked_goal_id: str | None = None
    status: str | None = None
    sort_order: int | None = None


def _check_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        raise HTTPException(400, "due_date must be YYYY-MM-DD")
    return value


def ticket_counts(db: Session, milestone_ids: list[str]) -> dict[str, tuple[int, int]]:
    """{milestone id: (tickets, done tickets)} in one query."""
    if not milestone_ids:
        return {}
    rows = (
        db.query(WorkTicket.milestone_id, func.count(WorkTicket.id),
                 func.sum(func.iif(WorkTicket.status == "done", 1, 0)))
        .filter(WorkTicket.milestone_id.in_(milestone_ids))
        .group_by(WorkTicket.milestone_id).all()
    )
    return {mid: (int(total), int(done or 0)) for mid, total, done in rows}


def serialize_milestone(m: WorkMilestone, counts: tuple[int, int] = (0, 0), today: date | None = None) -> dict:
    today = today or date.today()
    total, done = counts
    days_left = None
    if m.due_date:
        try:
            days_left = (date.fromisoformat(m.due_date) - today).days
        except ValueError:
            days_left = None
    return {
        "id": m.id,
        "company_id": m.company_id,
        "company_name": m.company.name if m.company else "",
        "company_color": m.company.color if m.company else "#2D7A6B",
        "linked_goal_id": m.linked_goal_id,
        "title": m.title,
        "description": m.description or "",
        "due_date": m.due_date,
        "status": m.status,
        "sort_order": m.sort_order or 0,
        "ticket_count": total,
        "done_count": done,
        "progress_pct": round(done / total * 100) if total else 0,
        "days_left": days_left,
        "overdue": bool(m.status != "done" and days_left is not None and days_left < 0),
        "created_at": str(m.created_at),
        "completed_at": str(m.completed_at) if m.completed_at else None,
    }


def _ordered(q):
    # Open first, soonest due first, undated last, then manual order.
    return q.order_by(func.iif(WorkMilestone.status == "done", 1, 0).asc(), WorkMilestone.due_date.is_(None),
                      WorkMilestone.due_date.asc(), WorkMilestone.sort_order.asc(), WorkMilestone.created_at.asc())


@router.get("")
def list_milestones(company_id: str | None = None, linked_goal_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(WorkMilestone)
    if company_id:
        q = q.filter(WorkMilestone.company_id == company_id)
    if linked_goal_id:
        q = q.filter(WorkMilestone.linked_goal_id == linked_goal_id)
    rows = _ordered(q).all()
    counts = ticket_counts(db, [m.id for m in rows])
    return [serialize_milestone(m, counts.get(m.id, (0, 0))) for m in rows]


@router.post("", status_code=201)
def create_milestone(body: MilestoneCreate, db: Session = Depends(get_db)):
    if not db.get(Company, body.company_id):
        raise HTTPException(404, "Company not found")
    if body.status not in STATUSES:
        raise HTTPException(400, "status must be open or done")
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Title is required")
    m = WorkMilestone(id=str(uuid4()), company_id=body.company_id, title=title, description=body.description,
                      due_date=_check_date(body.due_date), linked_goal_id=body.linked_goal_id, status=body.status,
                      completed_at=datetime.now(UTC) if body.status == "done" else None)
    db.add(m)
    db.commit()
    db.refresh(m)
    return serialize_milestone(m)


@router.get("/{milestone_id}")
def get_milestone(milestone_id: str, db: Session = Depends(get_db)):
    m = db.get(WorkMilestone, milestone_id)
    if not m:
        raise HTTPException(404, "Milestone not found")
    tickets = db.query(WorkTicket).filter(WorkTicket.milestone_id == m.id).order_by(WorkTicket.created_at.desc()).all()
    out = serialize_milestone(m, (len(tickets), sum(1 for t in tickets if t.status == "done")))
    out["tickets"] = [{"id": t.id, "title": t.title, "status": t.status, "priority": t.priority,
                       "ticket_ref": t.ticket_ref or "", "due_date": t.due_date} for t in tickets]
    return out


@router.put("/{milestone_id}")
def update_milestone(milestone_id: str, body: MilestoneUpdate, db: Session = Depends(get_db)):
    m = db.get(WorkMilestone, milestone_id)
    if not m:
        raise HTTPException(404, "Milestone not found")
    if body.title is not None:
        if not body.title.strip():
            raise HTTPException(400, "Title is required")
        m.title = body.title.strip()
    if body.description is not None:
        m.description = body.description
    if body.due_date is not None:
        m.due_date = _check_date(body.due_date)
    if body.linked_goal_id is not None:
        m.linked_goal_id = body.linked_goal_id or None
    if body.sort_order is not None:
        m.sort_order = body.sort_order
    if body.status is not None:
        if body.status not in STATUSES:
            raise HTTPException(400, "status must be open or done")
        if body.status == "done" and m.status != "done":
            m.completed_at = datetime.now(UTC)
        if body.status != "done":
            m.completed_at = None
        m.status = body.status
    db.commit()
    db.refresh(m)
    return serialize_milestone(m, ticket_counts(db, [m.id]).get(m.id, (0, 0)))


@router.delete("/{milestone_id}", status_code=204)
def delete_milestone(milestone_id: str, db: Session = Depends(get_db)):
    """Deleting a milestone unlinks its tickets; the tickets stay."""
    m = db.get(WorkMilestone, milestone_id)
    if not m:
        raise HTTPException(404, "Milestone not found")
    db.query(WorkTicket).filter(WorkTicket.milestone_id == m.id).update({WorkTicket.milestone_id: None})
    db.delete(m)
    db.commit()
