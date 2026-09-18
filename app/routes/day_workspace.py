"""Read-only unified day workspace endpoint.

Deliberately separate from ``/today``: that route commits daily snapshots as a
side effect, so it must never be reused for a read-only day model. This endpoint
only issues SELECTs.
"""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.day_workspace import build_day_workspace

router = APIRouter(prefix="/day-workspace", tags=["day workspace"])


@router.get("")
def get_day_workspace(
    date: date | None = None,
    timezone: str = "UTC",
    db: Session = Depends(get_db),
):
    try:
        tz = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(400, f"Unknown timezone: {timezone}")

    as_of = datetime.now(UTC)
    day = date or as_of.astimezone(tz).date()
    return build_day_workspace(db, day, tz, as_of)
