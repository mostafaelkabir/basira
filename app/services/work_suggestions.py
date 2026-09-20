"""Read-only "suggest existing work" service (ticket: Suggest existing work with
contextual search and ranking).

Given a partial query, rank existing work items — tickets, goal-linked tasks, and
work logs — so a planner can reuse one by its real ID instead of creating a
duplicate. Matches ticket references, normalized titles, clients, projects and
tags. Exact matches rank first, then contextual, then in-progress, then recent
unfinished work. Archived and completed items are excluded; blocked items are kept
but labeled. Never writes; results carry source-qualified IDs (``ticket:<id>`` …).
"""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.goal import Goal
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_ticket import WorkTicket

DONE_TICKET = {"done"}
DONE_LOG = {"done"}

# Score bands — exact wins decisively over contextual, which wins over recency.
S_REF_EXACT = 1000
S_TITLE_EXACT = 900
S_TITLE_PREFIX = 700
S_TITLE_CONTAINS = 500
S_TYPO = 320
S_CONTEXT = 200          # client / project / tag contains the query
B_IN_PROGRESS = 60       # context boost, additive
B_RECENT_UNFINISHED = 30


def _normalize(text: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (text or "").lower())).strip()


def _tokens(text: str) -> list[str]:
    return [t for t in _normalize(text).split(" ") if t]


def _levenshtein_le1(a: str, b: str) -> bool:
    """True when edit distance between a and b is at most 1 (cheap early-outs)."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:  # single substitution
        return sum(1 for x, y in zip(a, b) if x != y) == 1
    # one insertion/deletion: walk the shorter against the longer
    if la > lb:
        a, b, la, lb = b, a, lb, la
    i = j = 0
    skipped = False
    while i < la and j < lb:
        if a[i] == b[j]:
            i += 1
            j += 1
        elif skipped:
            return False
        else:
            skipped = True
            j += 1
    return True


def _title_score(query_norm: str, query_tokens: list[str], title: str) -> tuple[int, str | None]:
    tnorm = _normalize(title)
    if not query_norm:
        return 0, None
    if tnorm == query_norm:
        return S_TITLE_EXACT, "Exact title match"
    if tnorm.startswith(query_norm):
        return S_TITLE_PREFIX, "Title starts with your text"
    if query_norm in tnorm:
        return S_TITLE_CONTAINS, "Title contains your text"
    # Modest typo tolerance: a query token within edit-distance 1 of a title token.
    ttokens = set(_tokens(title))
    for q in query_tokens:
        if len(q) >= 4 and any(_levenshtein_le1(q, t) for t in ttokens):
            return S_TYPO, "Close title match"
    return 0, None


def _context_score(query_norm: str, *fields: str | None) -> str | None:
    if not query_norm:
        return None
    for f in fields:
        if f and query_norm in _normalize(f):
            return f
    return None


def _candidate(source, item_id, title, score, reasons, *, project, client,
               status, blocked=False, ref=None) -> dict:
    return {
        "key": f"{source}:{item_id}", "source": source, "item_id": item_id,
        "title": title, "score": score, "reasons": reasons,
        "project_title": project, "company_name": client,
        "status": status, "blocked": blocked, "ticket_ref": ref or "",
    }


BROWSE_BASE = {"in_progress": 60, "todo": 40, "review": 40, "backlog": 20, "blocked": 10}
BROWSE_REASON = {"in_progress": "In progress", "todo": "To do", "review": "In review",
                 "blocked": "Blocked", "backlog": "Backlog"}


def _browse(status: str) -> tuple[int, list[str]]:
    return BROWSE_BASE.get(status, 30), [BROWSE_REASON.get(status, "To do")]


def suggest_work(db: Session, query: str, limit: int = 5, show_all: bool = False,
                 source: str | None = None) -> dict:
    """Rank existing work for `query`. With an empty query it *browses*: every
    non-done item of the requested `source` (or all sources), ordered by status —
    so the picker can list, say, all tasks without typing."""
    q = query.strip()
    qnorm = _normalize(q)
    qtokens = _tokens(q)
    qlower = q.lower()
    browse = not qnorm
    candidates: list[dict] = []

    goal_titles = {g.id: g.title for g in db.query(Goal.id, Goal.title).all()}
    archived_goal_ids = {g.id for g in db.query(Goal.id).filter(Goal.archived_at.isnot(None)).all()}
    # Habits (resolution-goal tasks) are check marks, not plannable work items.
    habit_goal_ids = {g.id for g in db.query(Goal.id).filter(Goal.type == "resolution").all()}
    company_names = {c.id: c.name for c in db.query(Company.id, Company.name).all()}

    # ── Tickets (primary: ref, tags, status incl. blocked, client, project) ──
    for t in db.query(WorkTicket).filter(WorkTicket.status.notin_(DONE_TICKET)).all() if source in (None, "ticket") else []:
        reasons: list[str] = []
        score = 0
        if t.ticket_ref and t.ticket_ref.lower() == qlower and qlower:
            score = max(score, S_REF_EXACT)
            reasons.append(f"Matches reference {t.ticket_ref}")
        ts, treason = _title_score(qnorm, qtokens, t.title)
        if ts:
            score = max(score, ts)
            reasons.append(treason)
        project = goal_titles.get(t.linked_goal_id)
        client = company_names.get(t.company_id)
        try:
            tags = re.findall(r'"([^"]+)"', t.tags or "[]")
        except Exception:
            tags = []
        ctx = _context_score(qnorm, client, project, *tags)
        if ctx and score < S_TITLE_CONTAINS:
            score = max(score, S_CONTEXT)
            reasons.append(f"Related to {ctx}")
        blocked = t.status == "blocked"
        if score <= 0:
            if not browse:
                continue
            score, reasons = _browse(t.status)
        elif t.status == "in_progress":
            score += B_IN_PROGRESS
            reasons.append("In progress")
        elif t.status in ("todo", "review"):
            score += B_RECENT_UNFINISHED
        if blocked and "Blocked" not in reasons:
            reasons.append("Blocked")
        candidates.append(_candidate(
            "ticket", t.id, t.title, score, reasons,
            project=project or "Unassigned", client=client, status=t.status,
            blocked=blocked, ref=t.ticket_ref,
        ))

    # ── Goal-linked tasks (title + project; skip archived goals & done) ──
    for task in db.query(Task).filter(Task.status != "done").all() if source in (None, "task") else []:
        if task.goal_id in archived_goal_ids or task.goal_id in habit_goal_ids or task.parent_task_id:
            continue
        ts, treason = _title_score(qnorm, qtokens, task.title)
        project = goal_titles.get(task.goal_id, "Unassigned")
        score, reasons = 0, []
        if ts:
            score, reasons = ts, [treason]
        else:
            ctx = _context_score(qnorm, project)
            if ctx:
                score, reasons = S_CONTEXT, [f"Related to {ctx}"]
        if score <= 0:
            if not browse:
                continue
            score, reasons = _browse(task.status)
        candidates.append(_candidate(
            "task", task.id, task.title, score, reasons,
            project=project, client=None, status=task.status,
        ))

    # ── Work logs (title + client/project) ──
    for log in db.query(WorkLog).filter(WorkLog.status.notin_(DONE_LOG)).all() if source in (None, "worklog") else []:
        ts, treason = _title_score(qnorm, qtokens, log.title)
        project = goal_titles.get(log.linked_goal_id, "Unassigned")
        client = company_names.get(log.company_id)
        score, reasons = 0, []
        if ts:
            score, reasons = ts, [treason]
        else:
            ctx = _context_score(qnorm, client, project)
            if ctx:
                score, reasons = S_CONTEXT, [f"Related to {ctx}"]
        if score <= 0:
            if not browse:
                continue
            score, reasons = _browse(log.status)
        candidates.append(_candidate(
            "worklog", log.id, log.title, score, reasons,
            project=project, client=client, status=log.status,
        ))

    # Highest score first; stable tie-break keeps distinct IDs distinct.
    candidates.sort(key=lambda c: (-c["score"], c["title"], c["key"]))
    total = len(candidates)
    shown = candidates if show_all else candidates[:max(1, limit)]
    return {
        "query": q,
        "suggestions": shown,
        "total": total,
        "has_more": total > len(shown),
    }
