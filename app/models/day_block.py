from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# A DayBlock is a PLANNING object — a reserved slot on a specific day. It is NOT a
# Task and NOT an ExecutionLog: it never carries recorded time and never changes a
# task's or ticket's estimate. A "DayPlan" is simply the set of blocks for a date.
#
# kinds:
#   task | ticket | worklog  -> a concrete work item is scheduled (source_ref set)
#   project                   -> a reservation against an existing goal   (goal:<id>)
#   client                    -> client-only reservation for a company    (company:<id>)
#   break | personal | free   -> non-work time; occupies the day, no source_ref
ITEM_KINDS = {"task", "ticket", "worklog"}
CONTAINER_KINDS = {"project", "client"}
FREE_KINDS = {"break", "personal", "free"}
ALLOWED_KINDS = ITEM_KINDS | CONTAINER_KINDS | FREE_KINDS


class DayBlock(Base):
    __tablename__ = "day_blocks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    date: Mapped[str] = mapped_column(String, nullable=False, index=True)  # YYYY-MM-DD
    start_time: Mapped[str | None] = mapped_column(String, nullable=True)  # HH:MM; null = unscheduled reservation
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    source_ref: Mapped[str | None] = mapped_column(String, nullable=True)  # e.g. task:<id>, goal:<id>, company:<id>
    title: Mapped[str] = mapped_column(String, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    # Optimistic-concurrency version; bumped on every edit so a stale move is a 409.
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
