import re
from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.company import Company
from app.models.execution_log import ExecutionLog
from app.models.goal import Goal
from app.models.habit_log import HabitLog
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_ticket import WorkTicket

router = APIRouter(prefix="/today/schedule", tags=["schedule"])

KIND_TASK = "task"
KIND_HABIT = "habit"
KIND_TICKET = "ticket"
KIND_WORKLOG = "worklog"


def _today() -> str:
    return date.today().isoformat()


def _per_day(frequency: str | None) -> int:
    m = re.match(r"^(\d+)x_day$", frequency or "")
    return int(m.group(1)) if m else 1


def _not_deferred(task: Task, today: str) -> bool:
    return task.deferred_until is None or task.deferred_until <= today


def _sort_key(item: dict):
    # Items with a scheduled_time come first, ordered by clock time;
    # items without one follow, ordered by their manual sort_order.
    return (0, item["scheduled_time"]) if item["scheduled_time"] else (1, item["sort_order"])


def _serialize_task(t: Task, is_daily: bool = False) -> dict:
    return {
        "id": t.id,
        "kind": KIND_TASK,
        "title": t.title,
        "done": t.status == "done",
        "type": None,
        "estimated_minutes": t.estimated_minutes,
        "company_name": None,
        "company_color": None,
        "goal_title": t.goal.title if t.goal else None,
        "is_urgent": bool(t.is_urgent),
        "is_important": bool(t.is_important),
        "sort_order": t.sort_order or 0,
        "scheduled_time": t.scheduled_time,
        "is_daily": is_daily,
    }


def _serialize_habit(t: Task, db: Session, today: str) -> dict:
    per_day = _per_day(t.habit_frequency)
    log = db.query(HabitLog).filter(HabitLog.task_id == t.id, HabitLog.date == today).first()
    today_count = log.count if log else 0
    return {
        "id": t.id,
        "kind": KIND_HABIT,
        "title": t.title,
        "done": today_count >= per_day,
        "type": None,
        "estimated_minutes": t.estimated_minutes,
        "company_name": None,
        "company_color": None,
        "goal_title": t.goal.title if t.goal else None,
        "is_urgent": False,
        "is_important": False,
        "sort_order": t.sort_order or 0,
        "scheduled_time": t.scheduled_time,
        "is_daily": False,
    }


def _serialize_ticket(t: WorkTicket) -> dict:
    return {
        "id": t.id,
        "kind": KIND_TICKET,
        "title": t.title,
        "done": t.status == "done",
        "type": t.type,
        "estimated_minutes": t.estimated_minutes,
        "company_name": t.company.name if t.company else None,
        "company_color": t.company.color if t.company else None,
        "goal_title": None,
        "is_urgent": t.priority in ("high", "urgent"),
        "is_important": t.priority == "urgent",
        "sort_order": t.schedule_order or 0,
        "scheduled_time": t.scheduled_time,
        "is_daily": False,
    }


def _serialize_worklog(l: WorkLog) -> dict:
    return {
        "id": l.id,
        "kind": KIND_WORKLOG,
        "title": l.title,
        "done": l.status == "done",
        "type": l.type,
        "estimated_minutes": l.duration_minutes,
        "company_name": l.company.name if l.company else None,
        "company_color": l.company.color if l.company else None,
        "goal_title": None,
        "is_urgent": False,
        "is_important": False,
        "sort_order": l.schedule_order or 0,
        "scheduled_time": l.scheduled_time,
        "is_daily": False,
    }


@router.get("")
def get_schedule(db: Session = Depends(get_db)):
    today = _today()
    ACTIVE = Goal.archived_at.is_(None)

    # Daily-goal tasks are inherently "today's" regardless of plan_date
    daily_tasks = (
        db.query(Task).join(Goal, Task.goal_id == Goal.id)
        .filter(Goal.type == "daily", ACTIVE, Task.status == "todo",
                Task.parent_task_id.is_(None),
                (Task.pinned_date.is_(None)) | (Task.pinned_date != today))
        .all()
    )
    daily_tasks = [t for t in daily_tasks if _not_deferred(t, today)]

    # Project tasks explicitly planned for today
    project_tasks = (
        db.query(Task).join(Goal, Task.goal_id == Goal.id)
        .filter(Goal.type == "project", ACTIVE, Task.plan_date == today,
                Task.parent_task_id.is_(None),
                (Task.pinned_date.is_(None)) | (Task.pinned_date != today))
        .all()
    )

    # Habits explicitly planned for today
    habit_tasks = (
        db.query(Task).join(Goal, Task.goal_id == Goal.id)
        .filter(Goal.type == "resolution", ACTIVE, Task.plan_date == today, Task.status == "todo")
        .all()
    )

    tickets = db.query(WorkTicket).filter(WorkTicket.plan_date == today).all()
    worklogs = db.query(WorkLog).filter(WorkLog.plan_date == today).all()

    items = (
        [_serialize_task(t, is_daily=True) for t in daily_tasks]
        + [_serialize_task(t, is_daily=False) for t in project_tasks]
        + [_serialize_habit(t, db, today) for t in habit_tasks]
        + [_serialize_ticket(t) for t in tickets]
        + [_serialize_worklog(l) for l in worklogs]
    )
    items.sort(key=_sort_key)
    return items


class AddBody(BaseModel):
    kind: str
    id: str


def _next_order(db: Session) -> int:
    today = _today()
    max_ticket = db.query(WorkTicket).filter(WorkTicket.plan_date == today).count()
    max_log = db.query(WorkLog).filter(WorkLog.plan_date == today).count()
    max_proj = db.query(Task).filter(Task.plan_date == today).count()
    return (max_ticket + max_log + max_proj + 1) * 10


@router.post("/add")
def add_to_schedule(body: AddBody, db: Session = Depends(get_db)):
    today = _today()
    order = _next_order(db)

    if body.kind in (KIND_TASK, KIND_HABIT):
        task = db.query(Task).filter(Task.id == body.id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        task.plan_date = today
        task.sort_order = order
    elif body.kind == KIND_TICKET:
        ticket = db.query(WorkTicket).filter(WorkTicket.id == body.id).first()
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        ticket.plan_date = today
        ticket.schedule_order = order
    elif body.kind == KIND_WORKLOG:
        log = db.query(WorkLog).filter(WorkLog.id == body.id).first()
        if not log:
            raise HTTPException(status_code=404, detail="Work log not found")
        log.plan_date = today
        log.schedule_order = order
    else:
        raise HTTPException(status_code=400, detail="Invalid kind")

    db.commit()
    return {"ok": True}


@router.post("/remove")
def remove_from_schedule(body: AddBody, db: Session = Depends(get_db)):
    if body.kind in (KIND_TASK, KIND_HABIT):
        task = db.query(Task).filter(Task.id == body.id).first()
        if task:
            task.plan_date = None
            task.scheduled_time = None
    elif body.kind == KIND_TICKET:
        ticket = db.query(WorkTicket).filter(WorkTicket.id == body.id).first()
        if ticket:
            ticket.plan_date = None
            ticket.scheduled_time = None
    elif body.kind == KIND_WORKLOG:
        log = db.query(WorkLog).filter(WorkLog.id == body.id).first()
        if log:
            log.plan_date = None
            log.scheduled_time = None
    else:
        raise HTTPException(status_code=400, detail="Invalid kind")
    db.commit()
    return {"ok": True}


class CreateBody(BaseModel):
    kind: str
    title: str
    goal_id: str | None = None      # for task
    company_id: str | None = None   # for ticket / worklog
    type: str = "code"              # ticket / worklog type
    estimated_minutes: int | None = None
    scheduled_time: str | None = None  # "HH:MM"


@router.post("/create")
def create_schedule_item(body: CreateBody, db: Session = Depends(get_db)):
    today = _today()
    order = _next_order(db)
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    if body.kind == KIND_TASK:
        if not body.goal_id:
            raise HTTPException(status_code=400, detail="goal_id is required for tasks")
        goal = db.query(Goal).filter(Goal.id == body.goal_id).first()
        if not goal:
            raise HTTPException(status_code=400, detail="goal_id must reference an existing goal")
        task = Task(
            id=str(uuid4()),
            title=title,
            goal_id=body.goal_id,
            status="todo",
            requires_proof=False,
            plan_date=today,
            sort_order=order,
            created_at=today,
            estimated_minutes=body.estimated_minutes,
            scheduled_time=body.scheduled_time,
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        return _serialize_task(task, is_daily=(goal.type == "daily"))

    if body.kind == KIND_TICKET:
        if not body.company_id:
            raise HTTPException(status_code=400, detail="company_id is required for tickets")
        company = db.query(Company).filter(Company.id == body.company_id).first()
        if not company:
            raise HTTPException(status_code=400, detail="company_id must reference an existing company")
        ticket = WorkTicket(
            id=str(uuid4()),
            company_id=body.company_id,
            title=title,
            type=body.type,
            status="todo",
            plan_date=today,
            schedule_order=order,
            estimated_minutes=body.estimated_minutes,
            scheduled_time=body.scheduled_time,
        )
        db.add(ticket)
        db.commit()
        db.refresh(ticket)
        return _serialize_ticket(ticket)

    if body.kind == KIND_WORKLOG:
        if not body.company_id:
            raise HTTPException(status_code=400, detail="company_id is required for work logs")
        company = db.query(Company).filter(Company.id == body.company_id).first()
        if not company:
            raise HTTPException(status_code=400, detail="company_id must reference an existing company")
        log = WorkLog(
            id=str(uuid4()),
            company_id=body.company_id,
            title=title,
            type=body.type,
            status="todo",
            logged_at=today,
            plan_date=today,
            schedule_order=order,
            scheduled_time=body.scheduled_time,
        )
        db.add(log)
        db.commit()
        db.refresh(log)
        return _serialize_worklog(log)

    raise HTTPException(status_code=400, detail="Invalid kind")


class BatchCreateItem(BaseModel):
    title: str
    goal_id: str | None = None
    estimated_minutes: int | None = None
    scheduled_time: str | None = None


@router.post("/batch-create")
def batch_create_schedule(items: list[BatchCreateItem], db: Session = Depends(get_db)):
    today = _today()
    order = _next_order(db)
    created = []
    for item in items:
        title = item.title.strip()
        if not title:
            continue
        goal_id = item.goal_id
        if not goal_id:
            daily_goal = db.query(Goal).filter(Goal.type == "daily", Goal.archived_at.is_(None)).first()
            if not daily_goal:
                daily_goal = Goal(id=str(uuid4()), title="Daily Tasks", description="", type="daily")
                db.add(daily_goal)
                db.flush()
            goal_id = daily_goal.id
        task = Task(
            id=str(uuid4()),
            title=title,
            goal_id=goal_id,
            status="todo",
            requires_proof=False,
            plan_date=today,
            sort_order=order,
            created_at=today,
            estimated_minutes=item.estimated_minutes,
            scheduled_time=item.scheduled_time,
        )
        db.add(task)
        order += 10
        created.append(task)
    db.commit()
    for t in created:
        db.refresh(t)
    return [_serialize_task(t, is_daily=(t.goal and t.goal.type == "daily")) for t in created]


class CompleteBody(BaseModel):
    kind: str
    id: str
    done: bool = True


@router.post("/complete")
def complete_schedule_item(body: CompleteBody, db: Session = Depends(get_db)):
    if body.kind == KIND_TASK:
        task = db.query(Task).filter(Task.id == body.id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        task.status = "done" if body.done else "todo"
        if body.done:
            db.add(ExecutionLog(id=str(uuid4()), task_id=task.id, completed_at=datetime.now(UTC)))
    elif body.kind == KIND_HABIT:
        task = db.query(Task).filter(Task.id == body.id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        today = _today()
        per_day = _per_day(task.habit_frequency)
        log = db.query(HabitLog).filter(HabitLog.task_id == body.id, HabitLog.date == today).first()
        if body.done:
            if log:
                if log.count < per_day:
                    log.count += 1
            else:
                db.add(HabitLog(id=str(uuid4()), task_id=body.id, date=today, count=1))
        else:
            if log:
                if log.count > 1:
                    log.count -= 1
                else:
                    db.delete(log)
    elif body.kind == KIND_TICKET:
        ticket = db.query(WorkTicket).filter(WorkTicket.id == body.id).first()
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        ticket.status = "done" if body.done else "todo"
        ticket.completed_at = datetime.now(UTC) if body.done else None
    elif body.kind == KIND_WORKLOG:
        log = db.query(WorkLog).filter(WorkLog.id == body.id).first()
        if not log:
            raise HTTPException(status_code=404, detail="Work log not found")
        log.status = "done" if body.done else "todo"
    else:
        raise HTTPException(status_code=400, detail="Invalid kind")

    db.commit()
    return {"ok": True}


class TimeBody(BaseModel):
    kind: str
    id: str
    time: str | None = None   # "HH:MM" or null to clear


@router.post("/time")
def set_schedule_time(body: TimeBody, db: Session = Depends(get_db)):
    if body.time and not re.match(r"^\d{2}:\d{2}$", body.time):
        raise HTTPException(status_code=400, detail="time must be HH:MM")

    if body.kind in (KIND_TASK, KIND_HABIT):
        task = db.query(Task).filter(Task.id == body.id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        task.scheduled_time = body.time
    elif body.kind == KIND_TICKET:
        ticket = db.query(WorkTicket).filter(WorkTicket.id == body.id).first()
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        ticket.scheduled_time = body.time
    elif body.kind == KIND_WORKLOG:
        log = db.query(WorkLog).filter(WorkLog.id == body.id).first()
        if not log:
            raise HTTPException(status_code=404, detail="Work log not found")
        log.scheduled_time = body.time
    else:
        raise HTTPException(status_code=400, detail="Invalid kind")

    db.commit()
    return {"ok": True}


class ReorderItem(BaseModel):
    id: str
    kind: str
    sort_order: int


@router.post("/reorder")
def reorder_schedule(items: list[ReorderItem], db: Session = Depends(get_db)):
    for item in items:
        if item.kind in (KIND_TASK, KIND_HABIT):
            task = db.query(Task).filter(Task.id == item.id).first()
            if task:
                task.sort_order = item.sort_order
        elif item.kind == KIND_TICKET:
            ticket = db.query(WorkTicket).filter(WorkTicket.id == item.id).first()
            if ticket:
                ticket.schedule_order = item.sort_order
        elif item.kind == KIND_WORKLOG:
            log = db.query(WorkLog).filter(WorkLog.id == item.id).first()
            if log:
                log.schedule_order = item.sort_order
    db.commit()
    return {"ok": True}
