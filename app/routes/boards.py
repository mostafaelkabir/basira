"""Planning whiteboards.

A board is one tldraw document. It stores drawing and card placement only:
ticket, task and goal fields stay in their own tables, and the linked card
shapes on a board render from the compact data served by GET /boards/entities.
"""
import json
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.board import Board
from app.models.company import Company
from app.models.goal import Goal
from app.models.task import Task, is_habit
from app.models.work_ticket import WorkTicket
from app.models.work_milestone import WorkMilestone
from app.routes.work_milestones import serialize_milestone, ticket_counts

router = APIRouter(prefix="/boards", tags=["boards"])

SCOPE_TYPES = ("global", "work", "goal", "company")
SCOPED = ("goal", "company")          # scope types that carry a scope_id
CANDIDATE_LIMIT = 300


class BoardCreate(BaseModel):
    title: str = ""
    scope_type: str = "global"
    scope_id: str | None = None


class BoardEnsure(BaseModel):
    scope_type: str
    scope_id: str | None = None


class BoardUpdate(BaseModel):
    title: str | None = None


class BoardDocument(BaseModel):
    document: dict


# ─── Scope helpers ────────────────────────────────────────────────────────────

def _resolve_scope(db: Session, scope_type: str, scope_id: str | None) -> str | None:
    """Validate a scope; return the goal title / company name it points at."""
    if scope_type not in SCOPE_TYPES:
        raise HTTPException(400, f"scope_type must be one of: {', '.join(SCOPE_TYPES)}")
    if scope_type not in SCOPED:
        return None
    if not scope_id:
        raise HTTPException(400, f"scope_id is required for a {scope_type} board")
    if scope_type == "goal":
        goal = db.get(Goal, scope_id)
        if not goal or goal.trashed_at is not None:
            raise HTTPException(404, "Goal not found")
        return goal.title
    company = db.get(Company, scope_id)
    if not company:
        raise HTTPException(404, "Company not found")
    return company.name


def _default_title(scope_type: str, scope_title: str | None) -> str:
    if scope_type == "work":
        return "Work board"
    if scope_title:
        return f"{scope_title} board"
    return "Untitled board"


def _scope_title(db: Session, b: Board) -> str | None:
    if b.scope_type == "goal":
        g = db.get(Goal, b.scope_id)
        return g.title if g else None
    if b.scope_type == "company":
        c = db.get(Company, b.scope_id)
        return c.name if c else None
    return None


def _shape_count(document_json: str) -> int:
    try:
        store = json.loads(document_json or "{}").get("store") or {}
    except (ValueError, AttributeError):
        return 0
    return sum(1 for r in store.values() if isinstance(r, dict) and r.get("typeName") == "shape")


def _summary(b: Board, db: Session) -> dict:
    return {
        "id": b.id,
        "title": b.title,
        "scope_type": b.scope_type,
        "scope_id": b.scope_id,
        "scope_title": _scope_title(db, b),
        "shape_count": _shape_count(b.document),
        "created_at": str(b.created_at),
        "updated_at": str(b.updated_at),
    }


def _full(b: Board, db: Session) -> dict:
    out = _summary(b, db)
    try:
        out["document"] = json.loads(b.document or "{}")
    except ValueError:
        out["document"] = {}
    return out


def _get(db: Session, board_id: str) -> Board:
    b = db.get(Board, board_id)
    if not b:
        raise HTTPException(404, "Board not found")
    return b


# ─── Compact cards (what a linked shape renders from) ─────────────────────────

def _ticket_card(t: WorkTicket, milestones: dict | None = None) -> dict:
    milestones = milestones or {}
    return {
        "due_date": t.due_date, "milestone_id": t.milestone_id,
        "milestone_title": milestones.get(t.milestone_id, "") if t.milestone_id else "",
        "id": t.id, "title": t.title, "status": t.status, "priority": t.priority, "type": t.type,
        "ticket_ref": t.ticket_ref or "",
        "company_id": t.company_id,
        "company_name": t.company.name if t.company else "",
        "company_color": t.company.color if t.company else "#2D7A6B",
        "estimated_minutes": t.estimated_minutes or 0,
        "logged_minutes": t.logged_minutes or 0,
        "linked_goal_id": t.linked_goal_id,
        "plan_date": t.plan_date,
    }


def _task_card(t: Task, goal: Goal | None) -> dict:
    return {
        "id": t.id, "title": t.title, "status": t.status,
        "goal_id": t.goal_id, "goal_title": goal.title if goal else "",
        "due_date": t.due_date, "plan_date": t.plan_date,
        "is_urgent": bool(t.is_urgent), "is_important": bool(t.is_important),
        "estimated_minutes": t.estimated_minutes, "kind": t.kind,
        "parent_task_id": t.parent_task_id,
        "is_habit": is_habit(t, goal.type if goal else None),
    }


def _goal_card(g: Goal) -> dict:
    live = [t for t in g.tasks if t.trashed_at is None]
    return {
        "id": g.id, "title": g.title, "type": g.type, "icon": g.icon, "parent_id": g.parent_id,
        "task_count": len(live),
        "done_count": sum(1 for t in live if t.status == "done"),
        "archived": g.archived_at is not None,
    }


def _milestone_card(m: WorkMilestone, counts) -> dict:
    out = serialize_milestone(m, counts)
    return {k: out[k] for k in ("id", "title", "due_date", "status", "company_id", "company_name", "company_color",
                                 "ticket_count", "done_count", "progress_pct", "days_left", "overdue", "description")}


def _titles(db: Session, tickets) -> dict[str, str]:
    ids = {t.milestone_id for t in tickets if t.milestone_id}
    return dict(db.query(WorkMilestone.id, WorkMilestone.title).filter(WorkMilestone.id.in_(ids)).all()) if ids else {}


def _ids(raw: str | None) -> list[str]:
    return [s for s in (raw or "").split(",") if s]


# ─── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_boards(scope_type: str | None = None, scope_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Board)
    if scope_type:
        q = q.filter(Board.scope_type == scope_type)
    if scope_id:
        q = q.filter(Board.scope_id == scope_id)
    return [_summary(b, db) for b in q.order_by(Board.updated_at.desc()).all()]


@router.post("", status_code=201)
def create_board(body: BoardCreate, db: Session = Depends(get_db)):
    scope_title = _resolve_scope(db, body.scope_type, body.scope_id)
    b = Board(
        id=str(uuid4()),
        title=body.title.strip() or _default_title(body.scope_type, scope_title),
        scope_type=body.scope_type,
        scope_id=body.scope_id if body.scope_type in SCOPED else None,
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return _full(b, db)


@router.post("/ensure")
def ensure_board(body: BoardEnsure, db: Session = Depends(get_db)):
    """The board for a scope: return the existing one, or create it. Goal pages
    and the Work tab call this so a scope's board is always there to open."""
    scope_title = _resolve_scope(db, body.scope_type, body.scope_id)
    scope_id = body.scope_id if body.scope_type in SCOPED else None
    existing = (
        db.query(Board)
        .filter(Board.scope_type == body.scope_type, Board.scope_id == scope_id)
        .order_by(Board.updated_at.desc())
        .first()
    )
    if existing:
        return _full(existing, db)
    b = Board(id=str(uuid4()), title=_default_title(body.scope_type, scope_title),
              scope_type=body.scope_type, scope_id=scope_id)
    db.add(b)
    db.commit()
    db.refresh(b)
    return _full(b, db)


@router.get("/entities")
def board_entities(tickets: str | None = None, tasks: str | None = None, goals: str | None = None,
                   milestones: str | None = None, db: Session = Depends(get_db)):
    """Compact card data for linked shapes, keyed by id. Ids that no longer
    exist (or sit in the trash) are left out so the card can show as gone."""
    out: dict[str, dict] = {"tickets": {}, "tasks": {}, "goals": {}, "milestones": {}}
    ticket_ids, task_ids, goal_ids, milestone_ids = _ids(tickets), _ids(tasks), _ids(goals), _ids(milestones)
    if ticket_ids:
        rows = db.query(WorkTicket).options(joinedload(WorkTicket.company)).filter(WorkTicket.id.in_(ticket_ids)).all()
        titles = _titles(db, rows)
        out["tickets"] = {t.id: _ticket_card(t, titles) for t in rows}
    if milestone_ids:
        rows = db.query(WorkMilestone).options(joinedload(WorkMilestone.company)).filter(WorkMilestone.id.in_(milestone_ids)).all()
        counts = ticket_counts(db, [m.id for m in rows])
        out["milestones"] = {m.id: _milestone_card(m, counts.get(m.id, (0, 0))) for m in rows}
    if task_ids:
        rows = (db.query(Task).options(joinedload(Task.goal))
                .filter(Task.id.in_(task_ids), Task.trashed_at.is_(None)).all())
        out["tasks"] = {t.id: _task_card(t, t.goal) for t in rows}
    if goal_ids:
        rows = (db.query(Goal).options(joinedload(Goal.tasks))
                .filter(Goal.id.in_(goal_ids), Goal.trashed_at.is_(None)).all())
        out["goals"] = {g.id: _goal_card(g) for g in rows}
    return out


@router.get("/{board_id}")
def get_board(board_id: str, db: Session = Depends(get_db)):
    return _full(_get(db, board_id), db)


@router.get("/{board_id}/candidates")
def board_candidates(board_id: str, q: str | None = None, db: Session = Depends(get_db)):
    """What the side palette offers to drag onto this board, by scope:
    goal → its tasks, tickets linked to it, its sub-goals;
    company → that client's tickets and the goals they link to;
    work → every ticket;  global → tickets, open top-level tasks, live goals."""
    b = _get(db, board_id)
    needle = (q or "").strip().lower()
    tickets_q = db.query(WorkTicket).options(joinedload(WorkTicket.company))
    tasks_q = db.query(Task).options(joinedload(Task.goal)).filter(Task.trashed_at.is_(None))
    goals_q = db.query(Goal).options(joinedload(Goal.tasks)).filter(Goal.trashed_at.is_(None))
    milestones_q = db.query(WorkMilestone).options(joinedload(WorkMilestone.company))
    tickets: list[WorkTicket] = []
    tasks: list[Task] = []
    goals: list[Goal] = []
    milestones: list[WorkMilestone] = []

    if b.scope_type == "goal":
        tickets = tickets_q.filter(WorkTicket.linked_goal_id == b.scope_id).all()
        tasks = tasks_q.filter(Task.goal_id == b.scope_id).all()
        goals = goals_q.filter(Goal.parent_id == b.scope_id).all()
        milestones = milestones_q.filter(WorkMilestone.linked_goal_id == b.scope_id).all()
    elif b.scope_type == "company":
        tickets = tickets_q.filter(WorkTicket.company_id == b.scope_id).all()
        milestones = milestones_q.filter(WorkMilestone.company_id == b.scope_id).all()
        linked = {t.linked_goal_id for t in tickets if t.linked_goal_id}
        goals = goals_q.filter(Goal.id.in_(linked)).all() if linked else []
    elif b.scope_type == "work":
        tickets = tickets_q.all()
        milestones = milestones_q.all()
    else:
        tickets = tickets_q.all()
        milestones = milestones_q.all()
        tasks = tasks_q.filter(Task.status != "done", Task.parent_task_id.is_(None)).all()
        goals = goals_q.filter(Goal.archived_at.is_(None)).all()

    # Newest first, finished items last; stable sorts keep both orderings.
    tickets.sort(key=lambda t: str(t.created_at or ""), reverse=True)
    tickets.sort(key=lambda t: t.status == "done")
    tasks.sort(key=lambda t: (t.status == "done", t.sort_order or 0))
    goals.sort(key=lambda g: (g.archived_at is not None, (g.title or "").lower()))
    milestones.sort(key=lambda m: (m.status == "done", m.due_date is None, m.due_date or "", m.sort_order or 0))
    titles = _titles(db, tickets)
    counts = ticket_counts(db, [m.id for m in milestones])

    def keep(*texts: str | None) -> bool:
        return not needle or any(needle in (x or "").lower() for x in texts)

    return {
        "tickets": [_ticket_card(t, titles) for t in tickets if keep(t.title, t.ticket_ref)][:CANDIDATE_LIMIT],
        "milestones": [_milestone_card(m, counts.get(m.id, (0, 0))) for m in milestones if keep(m.title)][:CANDIDATE_LIMIT],
        "tasks": [_task_card(t, t.goal) for t in tasks if keep(t.title, t.goal.title if t.goal else "")][:CANDIDATE_LIMIT],
        "goals": [_goal_card(g) for g in goals if keep(g.title)][:CANDIDATE_LIMIT],
    }


@router.patch("/{board_id}")
def update_board(board_id: str, body: BoardUpdate, db: Session = Depends(get_db)):
    b = _get(db, board_id)
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(400, "Title cannot be empty")
        b.title = title
    b.updated_at = datetime.now(UTC)
    db.commit()
    return _summary(b, db)


@router.put("/{board_id}/document")
def save_document(board_id: str, body: BoardDocument, db: Session = Depends(get_db)):
    b = _get(db, board_id)
    b.document = json.dumps(body.document, separators=(",", ":"))
    b.updated_at = datetime.now(UTC)
    db.commit()
    return {"id": b.id, "updated_at": str(b.updated_at), "shape_count": _shape_count(b.document)}


@router.delete("/{board_id}", status_code=204)
def delete_board(board_id: str, db: Session = Depends(get_db)):
    b = _get(db, board_id)
    db.delete(b)
    db.commit()
