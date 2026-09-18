"""Read-only morning-planning suggestions endpoint. Never writes."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.morning_planner import morning_suggestions

router = APIRouter(prefix="/morning-suggestions", tags=["morning planner"])


@router.get("")
def get_morning_suggestions(
    date: date | None = None,
    timezone: str = "UTC",
    db: Session = Depends(get_db),
):
    try:
        tz = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(400, f"Unknown timezone: {timezone}")
    day = date or datetime.now(UTC).astimezone(tz).date()
    return morning_suggestions(db, day)
