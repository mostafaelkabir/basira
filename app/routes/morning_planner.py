"""Morning-planning suggestions.

GET is read-only (it never writes). Snooze is a separate explicit POST. Note: only
these morning suggestions honour snooze — GET /work-suggestions (the composer
search) is intentionally unaffected.
"""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.morning_planner import morning_suggestions, snooze

router = APIRouter(prefix="/morning-suggestions", tags=["morning planner"])


@router.get("")
def get_morning_suggestions(
    date: date | None = None,
    timezone: str = "UTC",
    include_older: bool = False,
    db: Session = Depends(get_db),
):
    try:
        tz = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(400, f"Unknown timezone: {timezone}")
    day = date or datetime.now(UTC).astimezone(tz).date()
    return morning_suggestions(db, day, include_older=include_older)


class SnoozeBody(BaseModel):
    source: str
    item_id: str
    until: str | None = None   # YYYY-MM-DD; defaults to tomorrow (browser tz)
    timezone: str = "UTC"


@router.post("/snooze")
def snooze_suggestion(body: SnoozeBody, db: Session = Depends(get_db)):
    if body.source not in ("task", "ticket"):
        raise HTTPException(400, "source must be task or ticket")
    until = body.until
    if not until:
        try:
            tz = ZoneInfo(body.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            tz = ZoneInfo("UTC")
        until = (datetime.now(UTC).astimezone(tz).date() + timedelta(days=1)).isoformat()
    result = snooze(db, body.source, body.item_id, until)
    if not result.get("ok"):
        raise HTTPException(404, result.get("error", "not found"))
    return result
