"""Read-only unified day model: what was worked on today and where the time went.

This service NEVER writes. It does not commit, migrate, create snapshots, or
populate missing goals. It reuses the same source-selection rules as
``work_reports`` so the two can never disagree, and adds task time plus
goal/company attribution on top.

Accounting (exact seconds internally; round only for display):

* Task time     — saved task ``WorkSession`` durations, joined Task -> Goal.
* Ticket time   — ``WorkTimeEntry`` rows for the date. The stopped ``WorkSession``
                  representations of those same entries are deliberately NOT added
                  again (that is what ``work_reports`` avoids too).
* Work-log time — ``WorkLog.duration_minutes`` for the date. Its timer sessions are
                  likewise not double-counted.
* Live          — still-running ``WorkSession`` rows are an overlay only, computed at
                  one shared ``as_of`` timestamp, and never folded into recorded totals.

Day-allocation policy: ticket and work-log time carry an authoritative ``logged_at``
date string, so they need no timezone reasoning. Task sessions carry UTC
timestamps; a saved task session is allocated in full to the local day its
``started_at`` falls in (the requested timezone). A session that is still running,
or one whose span crosses the local midnight boundary, is surfaced as a warning
rather than silently reallocated — saved durations are preserved exactly.

Source-qualified keys (``task:<id>``, ``ticket:<id>``, ``worklog:<id>``) avoid id
collisions across the three tables.
"""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.goal import Goal
from app.models.habit_log import HabitLog
from app.models.setting import Setting
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_session import WorkSession
from app.models.work_ticket import WorkTicket, WorkTimeEntry

UNASSIGNED_PROJECT = "Unassigned"
PERSONAL_CLIENT = "Personal"


def _as_naive_utc(dt: datetime) -> datetime:
    """Stored session timestamps are naive UTC in SQLite; normalise for comparison."""
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC)
    return dt.replace(tzinfo=None)


def _local_day_bounds_utc(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start_local = datetime.combine(day, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return _as_naive_utc(start_local), _as_naive_utc(end_local)


def _time_bucket(scheduled_time: str | None) -> str:
    """Group a HH:MM into morning / afternoon / evening, or anytime when unset."""
    if not scheduled_time:
        return "anytime"
    try:
        hour = int(scheduled_time.split(":", 1)[0])
    except (ValueError, AttributeError):
        return "anytime"
    if hour < 12:
        return "morning"
    if hour < 17:
        return "afternoon"
    return "evening"


def _per_day(frequency: str | None) -> int:
    import re

    m = re.match(r"^(\d+)x_day$", frequency or "")
    return int(m.group(1)) if m else 1


def _recorded_entries(db: Session, day: date, tz: ZoneInfo) -> list[dict]:
    """One aggregated entry per work item that recorded saved time on ``day``."""
    day_iso = day.isoformat()
    start_utc, end_utc = _local_day_bounds_utc(day, tz)
    entries: list[dict] = []

    # ── Task time: saved task sessions whose local day is `day` ──────────────
    task_rows = (
        db.query(
            WorkSession.task_id.label("task_id"),
            func.coalesce(func.sum(WorkSession.duration_seconds), 0).label("seconds"),
        )
        .filter(
            WorkSession.task_id.isnot(None),
            WorkSession.ended_at.isnot(None),
            WorkSession.started_at >= start_utc,
            WorkSession.started_at < end_utc,
        )
        .group_by(WorkSession.task_id)
        .all()
    )
    if task_rows:
        task_ids = [r.task_id for r in task_rows]
        tasks = {
            t.id: t
            for t in db.query(Task).filter(Task.id.in_(task_ids)).all()
        }
        goal_ids = {t.goal_id for t in tasks.values() if t.goal_id}
        goals = (
            {g.id: g for g in db.query(Goal).filter(Goal.id.in_(goal_ids)).all()}
            if goal_ids
            else {}
        )
        for row in task_rows:
            if not row.seconds:
                continue
            task = tasks.get(row.task_id)
            goal = goals.get(task.goal_id) if task else None
            entries.append({
                "key": f"task:{row.task_id}",
                "source": "task",
                "item_id": row.task_id,
                "title": task.title if task else "Unknown task",
                "seconds": int(row.seconds),
                "project_id": goal.id if goal else None,
                "project_title": goal.title if goal else UNASSIGNED_PROJECT,
                "company_id": None,
                "company_name": PERSONAL_CLIENT,
                "status": task.status if task else None,
            })

    # ── Ticket time: WorkTimeEntry rows dated `day` ──────────────────────────
    ticket_rows = (
        db.query(
            WorkTimeEntry.ticket_id.label("ticket_id"),
            func.sum(
                func.coalesce(
                    WorkTimeEntry.duration_seconds,
                    func.coalesce(WorkTimeEntry.duration_minutes, 0) * 60,
                )
            ).label("seconds"),
            WorkTicket.title,
            WorkTicket.status,
            WorkTicket.linked_goal_id,
            Company.id.label("company_id"),
            Company.name.label("company_name"),
        )
        .join(WorkTicket, WorkTimeEntry.ticket_id == WorkTicket.id)
        .join(Company, WorkTicket.company_id == Company.id)
        .filter(WorkTimeEntry.logged_at == day_iso)
        .group_by(WorkTimeEntry.ticket_id)
        .all()
    )
    goal_titles = _goal_title_lookup(
        db, [r.linked_goal_id for r in ticket_rows if r.linked_goal_id]
    )
    for row in ticket_rows:
        if not row.seconds:
            continue
        entries.append({
            "key": f"ticket:{row.ticket_id}",
            "source": "ticket",
            "item_id": row.ticket_id,
            "title": row.title,
            "seconds": int(row.seconds),
            "project_id": row.linked_goal_id,
            "project_title": goal_titles.get(row.linked_goal_id, UNASSIGNED_PROJECT),
            "company_id": row.company_id,
            "company_name": row.company_name,
            "status": row.status,
        })

    # ── Work-log time: WorkLog rows dated `day` ──────────────────────────────
    log_rows = (
        db.query(
            WorkLog.id,
            WorkLog.title,
            WorkLog.status,
            WorkLog.linked_goal_id,
            func.coalesce(WorkLog.duration_minutes, 0).label("minutes"),
            Company.id.label("company_id"),
            Company.name.label("company_name"),
        )
        .join(Company, WorkLog.company_id == Company.id)
        .filter(WorkLog.logged_at == day_iso)
        .all()
    )
    log_goal_titles = _goal_title_lookup(
        db, [r.linked_goal_id for r in log_rows if r.linked_goal_id]
    )
    for row in log_rows:
        seconds = int(row.minutes) * 60
        if not seconds:
            continue
        entries.append({
            "key": f"worklog:{row.id}",
            "source": "worklog",
            "item_id": row.id,
            "title": row.title,
            "seconds": seconds,
            "project_id": row.linked_goal_id,
            "project_title": log_goal_titles.get(row.linked_goal_id, UNASSIGNED_PROJECT),
            "company_id": row.company_id,
            "company_name": row.company_name,
            "status": row.status,
        })

    return sorted(entries, key=lambda e: (-e["seconds"], e["title"], e["key"]))


def _goal_title_lookup(db: Session, goal_ids: list[str]) -> dict[str, str]:
    ids = {g for g in goal_ids if g}
    if not ids:
        return {}
    return {
        g.id: g.title
        for g in db.query(Goal.id, Goal.title).filter(Goal.id.in_(ids)).all()
    }


def _active_timers(db: Session, day: date, tz: ZoneInfo, as_of: datetime) -> list[dict]:
    """Every still-running session, with attribution and elapsed at one as_of."""
    running = db.query(WorkSession).filter(WorkSession.ended_at.is_(None)).all()
    as_of_naive = _as_naive_utc(as_of)
    timers: list[dict] = []
    for s in running:
        started = _as_naive_utc(s.started_at)
        elapsed = max(0, int((as_of_naive - started).total_seconds()))
        started_local_day = s.started_at.replace(tzinfo=UTC).astimezone(tz).date() \
            if s.started_at.tzinfo is None else s.started_at.astimezone(tz).date()
        info = {
            "session_id": s.id,
            "started_at": s.started_at.replace(tzinfo=UTC).isoformat(),
            "elapsed_seconds": elapsed,
            "crosses_midnight": started_local_day != day,
        }
        if s.task_id:
            task = db.query(Task).filter(Task.id == s.task_id).first()
            goal = db.query(Goal).filter(Goal.id == task.goal_id).first() if task else None
            info.update({
                "source": "task", "key": f"task:{s.task_id}", "item_id": s.task_id,
                "title": task.title if task else "Unknown task",
                "project_title": goal.title if goal else UNASSIGNED_PROJECT,
                "company_name": PERSONAL_CLIENT,
            })
        elif s.work_log_id and s.work_log_id.startswith("ticket:"):
            ticket_id = s.work_log_id.split(":", 1)[1]
            ticket = db.query(WorkTicket).filter(WorkTicket.id == ticket_id).first()
            company = db.query(Company).filter(Company.id == ticket.company_id).first() if ticket else None
            goal = db.query(Goal).filter(Goal.id == ticket.linked_goal_id).first() if ticket and ticket.linked_goal_id else None
            info.update({
                "source": "ticket", "key": f"ticket:{ticket_id}", "item_id": ticket_id,
                "title": ticket.title if ticket else "Unknown ticket",
                "project_title": goal.title if goal else UNASSIGNED_PROJECT,
                "company_name": company.name if company else None,
            })
        else:
            log = db.query(WorkLog).filter(WorkLog.id == s.work_log_id).first()
            company = db.query(Company).filter(Company.id == log.company_id).first() if log else None
            goal = db.query(Goal).filter(Goal.id == log.linked_goal_id).first() if log and log.linked_goal_id else None
            info.update({
                "source": "worklog", "key": f"worklog:{s.work_log_id}", "item_id": s.work_log_id,
                "title": log.title if log else "Work session",
                "project_title": goal.title if goal else UNASSIGNED_PROJECT,
                "company_name": company.name if company else PERSONAL_CLIENT,
            })
        timers.append(info)
    return timers


def _group(entries: list[dict], live: list[dict], id_key: str, name_key: str,
           fallback_name: str) -> list[dict]:
    """Sum recorded + live seconds by a grouping key; children sum to the total."""
    groups: dict[str | None, dict] = {}
    for e in entries:
        gid = e.get(id_key)
        g = groups.setdefault(gid, {
            id_key: gid, name_key: e.get(name_key) or fallback_name,
            "seconds": 0, "live_seconds": 0,
        })
        g["seconds"] += e["seconds"]
    for t in live:
        # Live timers only carry a name (not an id) for project/company; match by name.
        name = t.get(name_key) or fallback_name
        match = next((g for g in groups.values() if g[name_key] == name), None)
        if match is None:
            match = groups.setdefault(f"live:{name}", {
                id_key: None, name_key: name, "seconds": 0, "live_seconds": 0,
            })
        match["live_seconds"] += t["elapsed_seconds"]
    return sorted(groups.values(), key=lambda g: -(g["seconds"] + g["live_seconds"]))


def _agenda(db: Session, day: date, recorded_by_key: dict[str, int],
            live_by_key: dict[str, int]) -> tuple[list[dict], list[dict], int]:
    """Today's scheduled items (from existing plan_date fields), split by whether
    they carry a HH:MM. Returns (agenda, unscheduled, planned_minutes).

    No DayBlock model exists yet (that is Step 4); this reflects the single-block
    scheduling the current schema supports, and does not invent blocks.
    """
    day_iso = day.isoformat()
    items: list[dict] = []

    tasks = (
        db.query(Task).join(Goal, Task.goal_id == Goal.id)
        .filter(
            Goal.archived_at.is_(None),
            (Task.plan_date == day_iso) | (Task.pinned_date == day_iso),
            Task.parent_task_id.is_(None),
        ).all()
    )
    goal_titles = _goal_title_lookup(db, [t.goal_id for t in tasks])
    for t in tasks:
        key = f"task:{t.id}"
        items.append({
            "key": key, "source": "task", "item_id": t.id, "title": t.title,
            "scheduled_time": t.scheduled_time,
            "planned_minutes": t.estimated_minutes or 0,
            "recorded_seconds": recorded_by_key.get(key, 0),
            "live_seconds": live_by_key.get(key, 0),
            "status": t.status,
            "project_title": goal_titles.get(t.goal_id, UNASSIGNED_PROJECT),
            "company_name": PERSONAL_CLIENT,
        })

    tickets = (
        db.query(WorkTicket, Company.name)
        .join(Company, WorkTicket.company_id == Company.id)
        .filter(WorkTicket.plan_date == day_iso).all()
    )
    t_goal_titles = _goal_title_lookup(db, [tk.linked_goal_id for tk, _ in tickets])
    for tk, company_name in tickets:
        key = f"ticket:{tk.id}"
        items.append({
            "key": key, "source": "ticket", "item_id": tk.id, "title": tk.title,
            "scheduled_time": tk.scheduled_time,
            "planned_minutes": tk.estimated_minutes or 0,
            "recorded_seconds": recorded_by_key.get(key, 0),
            "live_seconds": live_by_key.get(key, 0),
            "status": tk.status,
            "project_title": t_goal_titles.get(tk.linked_goal_id, UNASSIGNED_PROJECT),
            "company_name": company_name,
        })

    logs = (
        db.query(WorkLog, Company.name)
        .join(Company, WorkLog.company_id == Company.id)
        .filter(WorkLog.plan_date == day_iso).all()
    )
    for lg, company_name in logs:
        key = f"worklog:{lg.id}"
        items.append({
            "key": key, "source": "worklog", "item_id": lg.id, "title": lg.title,
            "scheduled_time": lg.scheduled_time,
            "planned_minutes": (lg.duration_minutes or 0),
            "recorded_seconds": recorded_by_key.get(key, 0),
            "live_seconds": live_by_key.get(key, 0),
            "status": lg.status,
            "project_title": UNASSIGNED_PROJECT,
            "company_name": company_name,
        })

    planned_minutes = sum(i["planned_minutes"] for i in items)
    scheduled = sorted(
        [i for i in items if i["scheduled_time"]],
        key=lambda i: (i["scheduled_time"], i["title"]),
    )
    unscheduled = sorted(
        [i for i in items if not i["scheduled_time"]],
        key=lambda i: (-i["recorded_seconds"], i["title"]),
    )
    return scheduled, unscheduled, planned_minutes


def _routines(db: Session, day: date) -> dict[str, list[dict]]:
    """Active habits (resolution-goal tasks) grouped by time-of-day, with today's
    occurrence progress. Check-ins are date-scoped and read-only here."""
    day_iso = day.isoformat()
    buckets: dict[str, list[dict]] = {
        "morning": [], "afternoon": [], "evening": [], "anytime": [],
    }
    goals = (
        db.query(Goal).filter(Goal.type == "resolution", Goal.archived_at.is_(None)).all()
    )
    goal_task_ids = [t.id for g in goals for t in g.tasks if t.status != "done"]
    log_counts: dict[str, int] = {}
    if goal_task_ids:
        for row in (
            db.query(HabitLog.task_id, HabitLog.count)
            .filter(HabitLog.task_id.in_(goal_task_ids), HabitLog.date == day_iso).all()
        ):
            log_counts[row.task_id] = row.count or 0
    for g in goals:
        for t in g.tasks:
            if t.status == "done":
                continue
            target = _per_day(t.habit_frequency)
            count = log_counts.get(t.id, 0)
            buckets[_time_bucket(t.scheduled_time)].append({
                "id": t.id, "title": t.title, "goal_title": g.title,
                "scheduled_time": t.scheduled_time,
                "target": target, "count": count,
                "done": count >= target,
                "frequency": t.habit_frequency or "daily",
            })
    for items in buckets.values():
        items.sort(key=lambda h: (h["scheduled_time"] or "99:99", h["title"]))
    return buckets


def _hhmm_to_min(hhmm: str, fallback: int) -> int:
    try:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return fallback


def _capacity(db: Session) -> dict:
    """The configured day window and available minutes after the buffer (BAS-031)."""
    settings = {s.key: s.value for s in db.query(Setting).all()}
    day_start = settings.get("day_start", "09:00")
    day_end = settings.get("day_end", "18:00")
    start = _hhmm_to_min(day_start, 540)
    end = _hhmm_to_min(day_end, 1080)
    try:
        buffer_pct = float(settings.get("buffer_pct", "15"))
    except (ValueError, TypeError):
        buffer_pct = 15.0
    window = max(0, end - start)
    return {
        "available_minutes": int(round(window * (1 - buffer_pct / 100))),
        "day_start": day_start, "day_end": day_end, "buffer_pct": int(buffer_pct),
    }


def build_day_workspace(db: Session, day: date, tz: ZoneInfo, as_of: datetime) -> dict:
    entries = _recorded_entries(db, day, tz)
    timers = _active_timers(db, day, tz, as_of)

    recorded_by_key = {e["key"]: e["seconds"] for e in entries}
    live_by_key: dict[str, int] = {}
    for t in timers:
        live_by_key[t["key"]] = live_by_key.get(t["key"], 0) + t["elapsed_seconds"]

    by_project = _group(entries, timers, "project_id", "project_title", UNASSIGNED_PROJECT)
    by_client = _group(entries, timers, "company_id", "company_name", PERSONAL_CLIENT)
    agenda, unscheduled, planned_minutes = _agenda(db, day, recorded_by_key, live_by_key)
    routines = _routines(db, day)

    warnings: list[dict] = []
    if len(timers) > 1:
        warnings.append({
            "code": "multiple_active_timers",
            "message": f"{len(timers)} timers are running at once; totals show tracked "
                       "time, which may overlap.",
        })
    if any(t["crosses_midnight"] for t in timers):
        warnings.append({
            "code": "session_crosses_midnight",
            "message": "A running session started before today; its live time spans "
                       "the local midnight boundary.",
        })

    recorded_seconds = sum(e["seconds"] for e in entries)
    live_seconds = sum(t["elapsed_seconds"] for t in timers)
    cap = _capacity(db)

    return {
        "date": day.isoformat(),
        "timezone": str(tz),
        "as_of": as_of.astimezone(UTC).isoformat(),
        "totals": {
            "recorded_seconds": recorded_seconds,
            "live_seconds": live_seconds,
            "planned_minutes": planned_minutes,
            "available_minutes": cap["available_minutes"],
            "over_minutes": max(0, planned_minutes - cap["available_minutes"]),
            "day_start": cap["day_start"],
            "day_end": cap["day_end"],
            "buffer_pct": cap["buffer_pct"],
        },
        "recorded": entries,
        "by_project": by_project,
        "by_client": by_client,
        "agenda": agenda,
        "unscheduled": unscheduled,
        "routines": routines,
        "active_timers": timers,
        "warnings": warnings,
    }
