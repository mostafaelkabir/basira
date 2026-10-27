from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class WorkMilestone(Base):
    """A dated checkpoint for a client's work (launch, demo, review). Tickets point
    at a milestone through work_tickets.milestone_id; progress is derived from them."""
    __tablename__ = "work_milestones"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    company_id: Mapped[str] = mapped_column(String, ForeignKey("companies.id"), nullable=False)
    linked_goal_id: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    due_date: Mapped[str | None] = mapped_column(String, nullable=True)      # YYYY-MM-DD
    status: Mapped[str] = mapped_column(String, default="open")               # open | done
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    company: Mapped["Company"] = relationship("Company")
