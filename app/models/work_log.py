from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class WorkLog(Base):
    """A single unit of professional work: a ticket, research session, planning block, etc."""
    __tablename__ = "work_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    company_id: Mapped[str] = mapped_column(String, ForeignKey("companies.id"), nullable=False)
    linked_goal_id: Mapped[str | None] = mapped_column(String, ForeignKey("goals.id"), nullable=True)

    title: Mapped[str] = mapped_column(String, nullable=False)
    # type: code | research | planning | review | meeting
    type: Mapped[str] = mapped_column(String, default="code")
    # status: todo | in_progress | done | blocked
    status: Mapped[str] = mapped_column(String, default="todo")

    notes: Mapped[str] = mapped_column(Text, default="")     # rich markdown notes / research findings
    tags: Mapped[str] = mapped_column(Text, default="[]")    # JSON array of strings
    proofs: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of {type, url, label}

    duration_minutes: Mapped[int] = mapped_column(Integer, default=0)  # total logged minutes (manual + timer)
    logged_at: Mapped[str] = mapped_column(String, nullable=False)      # YYYY-MM-DD

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    company: Mapped["Company"] = relationship("Company", back_populates="work_logs")
    work_sessions: Mapped[list["WorkSession"]] = relationship(
        "WorkSession",
        primaryjoin="WorkLog.id == foreign(WorkSession.work_log_id)",
        uselist=True,
    )
