"""Read-only morning-planning suggestions (ticket: Group, cap and snooze).

Answers "what should I plan today?" as four ordered groups, each with an explicit
reason, so the first thing seen in the morning is resumable and current work — not
the oldest overdue failures:

  resume     — in-progress tickets/tasks
  yesterday  — carried from a plan date within the last 7 days
  due        — due within the next 7 days, including overdue up to 14 days
  older      — overdue/carried more than 14/7 days, and blocked tickets (collapsed)

Purely read-only: it never moves a record. Items snoozed via the (separate) snooze
endpoint are excluded until their date passes; already-planned/done/archived items
are omitted. Visible groups cap at 8; `older` returns its first 3 unless
`include_older` is set.
"""

from __future__ import annotations

from datetime import date as date_cls, timedelta

from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.goal import Goal
from app.models.task import Task
from app.models.work_ticket import WorkTicket

DONE = {"done"}
CAP = 8
OLDER_PREVIEW = 3
GROUP_LABELS = {
    "resume": "Resume", "yesterday": "Yesterday's plan",
    "due": "Due this week", "older": "Older",
}


def _suggested_minutes(estimated: int | None) -> int:
    return estimated if estimated and estimated > 0 else 30


def morning_suggestions(db: Session, day: date_cls, include_older: bool = False) -> dict:
    today = day.isoformat()
    d7 = (day - timedelta(days=7)).isoformat()     # carried "recently" cutoff
    d14 = (day - timedelta(days=14)).isoformat()   # overdue "recently" cutoff
    due_horizon = (day + timedelta(days=7)).isoformat()

    goal_titles = {g.id: g.title for g in db.query(Goal.id, Goal.title).all()}
    archived = {g.id for g in db.query(Goal.id).filter(
        (Goal.archived_at.isnot(None)) | (Goal.trashed_at.isnot(None))).all()}
    habit_goals = {g.id for g in db.query(Goal.id).filter(Goal.type == "resolution").all()}
    company_names = {c.id: c.name for c in db.query(Company.id, Company.name).all()}

    groups: dict[str, list[dict]] = {"resume": [], "yesterday": [], "due": [], "older": []}

    def base(source, item_id, title, project_title, company_name, minutes):
        return {
            "key": f"{source}:{item_id}", "source": source, "item_id": item_id,
            "title": title, "project_title": project_title, "company_name": company_name,
            "suggested_minutes": minutes, "reasons": [],
        }

    # ── Tickets (no due_date) ────────────────────────────────────────────────
    for t in db.query(WorkTicket).filter(WorkTicket.status.notin_(DONE)).all():
        if t.plan_date == today:
            continue
        if t.snoozed_until and t.snoozed_until > today:
            continue
        b = base("ticket", t.id, t.title, goal_titles.get(t.linked_goal_id, "Unassigned"),
                 company_names.get(t.company_id), _suggested_minutes(t.estimated_minutes))
        if t.status == "blocked":
            b["reasons"] = ["Blocked"]; groups["older"].append(b); continue
        if t.status == "in_progress":
            b["reasons"] = ["In progress"]; groups["resume"].append(b); continue
        if t.plan_date and d7 <= t.plan_date < today:
            b["reasons"] = [f"Carried over from {t.plan_date}"]; groups["yesterday"].append(b); continue
        if t.plan_date and t.plan_date < d7:
            b["reasons"] = [f"Carried over from {t.plan_date}"]; groups["older"].append(b); continue
        # Not in progress, not carried, no due date -> not suggested.

    # ── Tasks ────────────────────────────────────────────────────────────────
    for task in db.query(Task).filter(Task.status.notin_(DONE), Task.trashed_at.is_(None)).all():
        if task.goal_id in archived or task.goal_id in habit_goals or task.parent_task_id or task.plan_date == today:
            continue
        if task.deferred_until and task.deferred_until > today:
            continue
        b = base("task", task.id, task.title, goal_titles.get(task.goal_id, "Unassigned"),
                 None, _suggested_minutes(task.estimated_minutes))
        due, plan = task.due_date, task.plan_date
        if task.status == "in_progress":
            b["reasons"] = ["In progress"]; groups["resume"].append(b); continue
        if plan and d7 <= plan < today:
            b["reasons"] = [f"Carried over from {plan}"]; groups["yesterday"].append(b); continue
        if due and d14 <= due <= due_horizon:
            b["reasons"] = [f"Overdue since {due}" if due < today else ("Due today" if due == today else f"Due {due}")]
            groups["due"].append(b); continue
        older_reasons = []
        if due and due < d14:
            older_reasons.append(f"Overdue since {due}")
        if plan and plan < d7:
            older_reasons.append(f"Carried over from {plan}")
        if older_reasons:
            b["reasons"] = older_reasons; groups["older"].append(b)

    # Intra-group ordering: soonest/most-recent first where it helps.
    groups["yesterday"].sort(key=lambda i: (i["reasons"][0], i["title"]), reverse=True)
    groups["due"].sort(key=lambda i: (i["reasons"][0], i["title"]))
    groups["resume"].sort(key=lambda i: (i["source"] != "ticket", i["title"]))
    groups["older"].sort(key=lambda i: i["title"])

    out = []
    for key in ("resume", "yesterday", "due", "older"):
        items = groups[key]
        if key == "older":
            shown = items if include_older else items[:OLDER_PREVIEW]
            out.append({"key": key, "label": GROUP_LABELS[key], "items": shown,
                        "total": len(items), "collapsed": not include_older and len(items) > OLDER_PREVIEW})
        else:
            out.append({"key": key, "label": GROUP_LABELS[key], "items": items[:CAP],
                        "total": len(items), "collapsed": False})
    return {"date": today, "groups": out}


def snooze(db: Session, source: str, item_id: str, until: str | None) -> dict:
    """Hide an item from morning suggestions. Never changes its title, estimate,
    status or due date."""
    if source == "task":
        task = db.query(Task).filter(Task.id == item_id).first()
        if not task:
            return {"ok": False, "error": "not found"}
        task.deferred_until = until
        task.plan_date = None
    elif source == "ticket":
        ticket = db.query(WorkTicket).filter(WorkTicket.id == item_id).first()
        if not ticket:
            return {"ok": False, "error": "not found"}
        ticket.snoozed_until = until
        ticket.plan_date = None
    else:
        return {"ok": False, "error": "bad source"}
    db.commit()
    return {"ok": True, "source": source, "item_id": item_id, "until": until}
