from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# A RhythmBlock is the repeating SHAPE of the day: "Mon–Fri 09:00, 2h, HaramBlur".
# Each day is the template instantiated for that weekday; a change to one day is a
# DayBlock row carrying rhythm_id (moved, resized, or skipped), never a change here.
# kinds: project (goal:<id>) | client (company:<id>) | routine (habits) | personal |
#        break | free — the last four reference nothing.
RHYTHM_KINDS = ("project", "client", "routine", "personal", "break", "free")
WORK_KINDS = {"project", "client"}


class RhythmBlock(Base):
    __tablename__ = "rhythm_blocks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, default="")
    kind: Mapped[str] = mapped_column(String, nullable=False)
    target_ref: Mapped[str | None] = mapped_column(String, nullable=True)   # goal:<id> | company:<id>
    days: Mapped[str] = mapped_column(String, default="mon,tue,wed,thu,fri")  # weekday tokens
    start_time: Mapped[str] = mapped_column(String, nullable=False)          # HH:MM
    duration_minutes: Mapped[int] = mapped_column(Integer, default=60)
    color: Mapped[str | None] = mapped_column(String, nullable=True)         # optional hex override
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
