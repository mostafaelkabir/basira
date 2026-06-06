from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class WorkSession(Base):
    __tablename__ = "work_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    task_id: Mapped[str | None] = mapped_column(String, ForeignKey("tasks.id"), nullable=True)
    work_log_id: Mapped[str | None] = mapped_column(String, nullable=True)  # FK to work_logs (nullable)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)   # null = currently running
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)            # 0 while running

    task: Mapped["Task"] = relationship("Task", foreign_keys=[task_id])
