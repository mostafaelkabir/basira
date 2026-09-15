"""Read-only reporting over saved work time. Never migrate or rewrite history."""

from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.work_log import WorkLog
from app.models.work_ticket import WorkTicket, WorkTimeEntry


def work_entries(db: Session, date_from: str, date_to: str, company_id: str | None = None) -> list[dict]:
    # Select only reporting columns; this also works before optional schedule
    # columns have been added to an older database.
    tickets = db.query(
        WorkTimeEntry.id, WorkTimeEntry.ticket_id, WorkTimeEntry.logged_at,
        WorkTimeEntry.duration_seconds, WorkTimeEntry.duration_minutes, WorkTimeEntry.note,
        WorkTicket.title, WorkTicket.ticket_ref, WorkTicket.type, WorkTicket.status,
        Company.id.label("company_id"), Company.name.label("company_name"),
        Company.color.label("company_color"),
    ).join(WorkTicket, WorkTimeEntry.ticket_id == WorkTicket.id).join(
        Company, WorkTicket.company_id == Company.id,
    ).filter(WorkTimeEntry.logged_at >= date_from, WorkTimeEntry.logged_at <= date_to)
    logs = db.query(
        WorkLog.id, WorkLog.logged_at, WorkLog.duration_minutes,
        WorkLog.title, WorkLog.type, WorkLog.status,
        Company.id.label("company_id"), Company.name.label("company_name"),
        Company.color.label("company_color"),
    ).join(Company, WorkLog.company_id == Company.id).filter(
        WorkLog.logged_at >= date_from, WorkLog.logged_at <= date_to,
    )
    if company_id:
        tickets = tickets.filter(WorkTicket.company_id == company_id)
        logs = logs.filter(WorkLog.company_id == company_id)

    entries = []
    for row in tickets.all():
        # Old entries may have minutes only. Interpret them without updating DB.
        seconds = row.duration_seconds or (row.duration_minutes or 0) * 60
        entries.append({
            "id": row.id, "source": "ticket", "item_id": row.ticket_id,
            "date": row.logged_at, "seconds": seconds, "title": row.title,
            "ticket_ref": row.ticket_ref or "", "note": row.note or "",
            "type": row.type or "other", "current_status": row.status,
            "company_id": row.company_id, "company_name": row.company_name,
            "company_color": row.company_color,
        })
    for row in logs.all():
        entries.append({
            "id": row.id, "source": "worklog", "item_id": row.id,
            "date": row.logged_at, "seconds": (row.duration_minutes or 0) * 60,
            "title": row.title, "ticket_ref": "", "note": "",
            "type": row.type or "other", "current_status": row.status,
            "company_id": row.company_id, "company_name": row.company_name,
            "company_color": row.company_color,
        })
    # Timer sessions already feed these entries/totals. Adding them again would
    # double-count. Unstopped timers have not yet become saved time.
    return sorted(entries, key=lambda e: (e["date"], e["company_name"], e["title"], e["id"]))


def summarize_work(entries: list[dict], date_from: date, date_to: date) -> dict:
    days = {}
    cursor = date_from
    while cursor <= date_to:
        days[cursor.isoformat()] = {"date": cursor.isoformat(), "seconds": 0, "by_type": {}}
        cursor += timedelta(days=1)
    companies, types = {}, {}
    for entry in entries:
        seconds, kind = entry["seconds"], entry["type"]
        day = days[entry["date"]]
        day["seconds"] += seconds
        day["by_type"][kind] = day["by_type"].get(kind, 0) + seconds
        types[kind] = types.get(kind, 0) + seconds
        company = companies.setdefault(entry["company_id"], {
            "company_id": entry["company_id"], "company_name": entry["company_name"],
            "company_color": entry["company_color"], "seconds": 0,
        })
        company["seconds"] += seconds

    weeks = {}
    for day in days.values():
        day_date = date.fromisoformat(day["date"])
        monday = day_date - timedelta(days=day_date.weekday())
        week = weeks.setdefault(monday.isoformat(), {
            "date_from": max(monday, date_from).isoformat(),
            "date_to": min(monday + timedelta(days=6), date_to).isoformat(),
            "seconds": 0, "by_type": {},
        })
        week["seconds"] += day["seconds"]
        for kind, seconds in day["by_type"].items():
            week["by_type"][kind] = week["by_type"].get(kind, 0) + seconds
    return {
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
        "total_seconds": sum(e["seconds"] for e in entries),
        "by_day": list(days.values()), "by_week": list(weeks.values()),
        "by_company": sorted(companies.values(), key=lambda c: -c["seconds"]),
        "by_type": types, "entries": entries,
    }
