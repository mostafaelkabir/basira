from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DailySnapshot(Base):
    __tablename__ = "daily_snapshots"

    date: Mapped[str] = mapped_column(String, primary_key=True)  # YYYY-MM-DD
    tasks_total: Mapped[int] = mapped_column(Integer, default=0)
    tasks_done: Mapped[int] = mapped_column(Integer, default=0)
    habits_total: Mapped[int] = mapped_column(Integer, default=0)
    habits_done: Mapped[int] = mapped_column(Integer, default=0)
    score_pct: Mapped[float] = mapped_column(Float, default=0.0)   # combined
    task_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=True)
    habit_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=True)
