from datetime import UTC, datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, default="")
    type: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    trashed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # soft-delete; purged after 30 days

    icon: Mapped[str | None] = mapped_column(String, nullable=True)
    cover: Mapped[bool] = mapped_column(default=False)

    parent_id: Mapped[str | None] = mapped_column(String, ForeignKey("goals.id"), nullable=True)

    # Outcome: active | blocked | achieved | moved_out | cancelled. The last three close the goal
    # (they also set archived_at, so it leaves every active list); blocked keeps it open.
    status: Mapped[str] = mapped_column(String, default="active", nullable=True)
    status_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Measure: the one number that says how close the goal is ("Weight 92 → 82 kg by 30 Jun").
    # Set when metric_target is not null; progress, pace and projection come from
    # app/services/goal_measure.py. metric_source: manual (weekly check-ins) or counted by
    # the app since metric_start_date — checkins (habit check-ins) | tasks (completed) | hours (logged).
    metric_name: Mapped[str | None] = mapped_column(String, nullable=True)
    metric_unit: Mapped[str | None] = mapped_column(String, nullable=True)
    metric_source: Mapped[str | None] = mapped_column(String, nullable=True)
    metric_start: Mapped[float | None] = mapped_column(Float, nullable=True)
    metric_target: Mapped[float | None] = mapped_column(Float, nullable=True)
    metric_start_date: Mapped[str | None] = mapped_column(String, nullable=True)    # YYYY-MM-DD
    metric_target_date: Mapped[str | None] = mapped_column(String, nullable=True)   # YYYY-MM-DD, optional

    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="goal", cascade="all, delete-orphan")
    checkins: Mapped[list["GoalCheckin"]] = relationship("GoalCheckin", cascade="all, delete-orphan")


GOAL_STATUSES = ("active", "blocked", "achieved", "moved_out", "cancelled")
CLOSED_STATUSES = ("achieved", "moved_out", "cancelled")
REASON_REQUIRED = ("blocked", "moved_out", "cancelled")


class GoalStatusLog(Base):
    """One line per status change: what it moved from and to, and why."""
    __tablename__ = "goal_status_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    goal_id: Mapped[str] = mapped_column(String, ForeignKey("goals.id"), nullable=False)
    from_status: Mapped[str] = mapped_column(String, default="active")
    to_status: Mapped[str] = mapped_column(String, nullable=False)
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


METRIC_SOURCES = ("manual", "checkins", "tasks", "hours")


class GoalCheckin(Base):
    """The goal's number for one week (Monday-based). Checking in again the same week replaces it."""
    __tablename__ = "goal_checkins"
    __table_args__ = (UniqueConstraint("goal_id", "week_start", name="uq_goal_checkin_week"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    goal_id: Mapped[str] = mapped_column(String, ForeignKey("goals.id"), nullable=False)
    week_start: Mapped[str] = mapped_column(String, nullable=False)   # YYYY-MM-DD (Monday)
    date: Mapped[str] = mapped_column(String, nullable=False)         # the day it was measured
    value: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
