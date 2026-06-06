from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ExecutionLog(Base):
    __tablename__ = "execution_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    task_id: Mapped[str] = mapped_column(String, ForeignKey("tasks.id"), nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    notes: Mapped[str] = mapped_column(String, default="")

    task: Mapped["Task"] = relationship("Task", back_populates="execution_logs")
