from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class WorkTicket(Base):
    """A persistent work item (like a Jira ticket) that accumulates logged time."""
    __tablename__ = "work_tickets"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    company_id: Mapped[str] = mapped_column(String, ForeignKey("companies.id"), nullable=False)
    linked_goal_id: Mapped[str | None] = mapped_column(String, ForeignKey("goals.id"), nullable=True)

    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")

    # type: code | research | planning | review | meeting
    type: Mapped[str] = mapped_column(String, default="code")
    # status: backlog | todo | in_progress | review | done | blocked
    status: Mapped[str] = mapped_column(String, default="todo")
    # priority: low | medium | high | urgent
    priority: Mapped[str] = mapped_column(String, default="medium")

    estimated_minutes: Mapped[int] = mapped_column(Integer, default=0)   # 0 = no estimate
    logged_minutes: Mapped[int] = mapped_column(Integer, default=0)       # accumulated (rounded, for display)
    logged_seconds: Mapped[int] = mapped_column(Integer, default=0)       # exact accumulated seconds

    ticket_ref: Mapped[str] = mapped_column(String, default="")   # external ID e.g. JIRA-123
    tags: Mapped[str] = mapped_column(Text, default="[]")          # JSON array
    proofs: Mapped[str] = mapped_column(Text, default="[]")        # JSON [{url, label}]
    notes: Mapped[str] = mapped_column(Text, default="")           # running notes / description

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    company: Mapped["Company"] = relationship("Company")
    time_entries: Mapped[list["WorkTimeEntry"]] = relationship(
        "WorkTimeEntry", back_populates="ticket", cascade="all, delete-orphan",
        order_by="WorkTimeEntry.logged_at.desc()"
    )
    activity_comments: Mapped[list["WorkTicketComment"]] = relationship(
        "WorkTicketComment", back_populates="ticket", cascade="all, delete-orphan",
        order_by="WorkTicketComment.created_at.desc()"
    )


class WorkTicketComment(Base):
    """A note, finding, or link dropped on a ticket at any point."""
    __tablename__ = "work_ticket_comments"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String, ForeignKey("work_tickets.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # type: note | proof
    type: Mapped[str] = mapped_column(String, default="note")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    ticket: Mapped["WorkTicket"] = relationship("WorkTicket", back_populates="activity_comments")


class WorkTimeEntry(Base):
    """A single logged time session against a ticket."""
    __tablename__ = "work_time_entries"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String, ForeignKey("work_tickets.id"), nullable=False)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)   # exact seconds
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)  # floor(seconds/60), for display
    logged_at: Mapped[str] = mapped_column(String, nullable=False)   # YYYY-MM-DD
    note: Mapped[str] = mapped_column(String, default="")            # what was done in this session
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    ticket: Mapped["WorkTicket"] = relationship("WorkTicket", back_populates="time_entries")
