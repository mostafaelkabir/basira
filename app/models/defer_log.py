from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DeferLog(Base):
    __tablename__ = "defer_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    task_id: Mapped[str] = mapped_column(String, ForeignKey("tasks.id"), nullable=False)
    deferred_on: Mapped[str] = mapped_column(String, nullable=False)    # YYYY-MM-DD
    deferred_until: Mapped[str] = mapped_column(String, nullable=True)  # YYYY-MM-DD

    task: Mapped["Task"] = relationship("Task")
