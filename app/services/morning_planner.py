"""Read-only morning-planning suggestions (ticket: Design a single morning planning
workspace).

Answers "what should I plan today?" by surfacing existing work that has a reason to
be on today's list — in-progress tickets, items carried over from a past plan, and
work that is due — each with an explicit, human reason. Purely read-only: it never
moves a record or writes a plan; carry-forward only happens when the user adds an
item. Items already planned for today are omitted (they are on the agenda already).
"""

from __future__ import annotations

from datetime import date as date_cls

from sqlalchemy.orm import Session

from app.models.goal import Goal
from app.models.task import Task
from app.models.work_ticket import WorkTicket

DONE = {"done"}

# Reason weights drive ranking: the most time-sensitive reason wins.
W_OVERDUE = 4
W_DUE_TODAY = 3
W_IN_PROGRESS = 2
W_CARRIED = 1


def _add(bucket: dict, key: str, base: dict, reason: str, weight: int) -> None:
    entry = bucket.get(key)
    if entry is None:
        bucket[key] = {**base, "reasons": [reason], "_weight": weight}
    else:
        if reason not in entry["reasons"]:
            entry["reasons"].append(reason)
        entry["_weight"] = max(entry["_weight"], weight)


def morning_suggestions(db: Session, day: date_cls) -> dict:
    today = day.isoformat()
    bucket: dict[str, dict] = {}

    goal_titles = {g.id: g.title for g in db.query(Goal.id, Goal.title).all()}
    archived = {g.id for g in db.query(Goal.id).filter(Goal.archived_at.isnot(None)).all()}

    # ── Tickets: in-progress, or carried over from a past plan date ──
    for t in db.query(WorkTicket).filter(WorkTicket.status.notin_(DONE)).all():
        if t.plan_date == today:
            continue  # already on today's plan
        base = {
            "key": f"ticket:{t.id}", "source": "ticket", "item_id": t.id, "title": t.title,
            "project_title": goal_titles.get(t.linked_goal_id, "Unassigned"),
            "status": t.status, "due_date": None, "plan_date": t.plan_date,
        }
        if t.status == "in_progress":
            _add(bucket, base["key"], base, "In progress", W_IN_PROGRESS)
        if t.plan_date and t.plan_date < today:
            _add(bucket, base["key"], base, f"Carried over from {t.plan_date}", W_CARRIED)

    # ── Tasks: carried over, or due (overdue / due today) ──
    for task in db.query(Task).filter(Task.status.notin_(DONE)).all():
        if task.goal_id in archived or task.parent_task_id or task.plan_date == today:
            continue
        base = {
            "key": f"task:{task.id}", "source": "task", "item_id": task.id, "title": task.title,
            "project_title": goal_titles.get(task.goal_id, "Unassigned"),
            "status": task.status, "due_date": task.due_date, "plan_date": task.plan_date,
        }
        if task.plan_date and task.plan_date < today:
            _add(bucket, base["key"], base, f"Carried over from {task.plan_date}", W_CARRIED)
        if task.due_date:
            if task.due_date < today:
                _add(bucket, base["key"], base, f"Overdue since {task.due_date}", W_OVERDUE)
            elif task.due_date == today:
                _add(bucket, base["key"], base, "Due today", W_DUE_TODAY)

    suggestions = sorted(bucket.values(), key=lambda e: (-e["_weight"], e["title"], e["key"]))
    for s in suggestions:
        s.pop("_weight", None)
    return {
        "date": today,
        "suggestions": suggestions,
        "counts": {
            "in_progress": sum(1 for s in suggestions if any("progress" in r for r in s["reasons"])),
            "carried_over": sum(1 for s in suggestions if any("Carried" in r for r in s["reasons"])),
            "due": sum(1 for s in suggestions if any(("Due" in r or "Overdue" in r) for r in s["reasons"])),
        },
    }
