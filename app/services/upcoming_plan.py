"""Read-only overview of the next few days' plans (BAS-046).

One row per local day: what is planned (from the same plan_date fields Today
reads), planned minutes against the configured capacity, and a short item list.
It reuses the day workspace's agenda and capacity rules so a day's numbers here
always match what Today shows when that day arrives. Never writes.

Calendar events (BAS-047) are meant to join each day here as fixed, busy time.
"""

from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.services.day_workspace import _agenda, _capacity

MAX_DAYS = 31


def upcoming_days(db: Session, start: date, days: int = 7) -> dict:
    days = max(1, min(days, MAX_DAYS))
    cap = _capacity(db)
    out = []
    for n in range(days):
        day = start + timedelta(days=n)
        scheduled, unscheduled, planned_minutes = _agenda(db, day, {}, {})
        items = scheduled + unscheduled
        out.append({
            "date": day.isoformat(),
            "planned_minutes": planned_minutes,
            "available_minutes": cap["available_minutes"],
            "over_minutes": max(0, planned_minutes - cap["available_minutes"]),
            "item_count": len(items),
            "done_count": sum(1 for i in items if i["status"] == "done"),
            "items": [
                {k: i[k] for k in ("key", "source", "item_id", "title", "scheduled_time",
                                   "planned_minutes", "status", "project_title", "company_name")}
                for i in items
            ],
        })
    return {"start": start.isoformat(), "days": out,
            "day_start": cap["day_start"], "day_end": cap["day_end"]}
