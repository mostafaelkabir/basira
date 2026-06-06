from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    goal_id: Mapped[str] = mapped_column(String, ForeignKey("goals.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, default="todo")
    requires_proof: Mapped[bool] = mapped_column(Boolean, default=True)
    due_date: Mapped[str | None] = mapped_column(String, nullable=True)  # YYYY-MM-DD
    habit_frequency: Mapped[str] = mapped_column(String, default="daily", nullable=True)
    pinned_date: Mapped[str | None] = mapped_column(String, nullable=True)    # YYYY-MM-DD focus pin
    deferred_until: Mapped[str | None] = mapped_column(String, nullable=True)  # YYYY-MM-DD defer
    plan_date: Mapped[str | None] = mapped_column(String, nullable=True)       # YYYY-MM-DD plan for today

    parent_task_id: Mapped[str | None] = mapped_column(String, ForeignKey("tasks.id"), nullable=True)
    is_urgent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=True)
    is_important: Mapped[bool] = mapped_column(Boolean, default=False, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=True)
    created_at: Mapped[str | None] = mapped_column(String, nullable=True)  # YYYY-MM-DD
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    goal: Mapped["Goal"] = relationship("Goal", back_populates="tasks")
    proofs: Mapped[list["Proof"]] = relationship("Proof", back_populates="task", cascade="all, delete-orphan")
    comments: Mapped[list["Comment"]] = relationship("Comment", back_populates="task", cascade="all, delete-orphan", order_by="Comment.created_at")
    execution_logs: Mapped[list["ExecutionLog"]] = relationship("ExecutionLog", back_populates="task", cascade="all, delete-orphan")
