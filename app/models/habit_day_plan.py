from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


# A habit placed on one day's schedule (BAS-050). Habits are recurring, so this is
# per day rather than the habit's single plan_date: the same habit can sit on today
# and Thursday. scheduled_time overrides the habit's default time for that day only.
# Checking it off is still a HabitLog check-in; the habit itself is never "done".
class HabitDayPlan(Base):
    __tablename__ = "habit_day_plans"
    __table_args__ = (UniqueConstraint("task_id", "date"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    task_id: Mapped[str] = mapped_column(String, ForeignKey("tasks.id"), nullable=False)
    date: Mapped[str] = mapped_column(String, nullable=False, index=True)  # YYYY-MM-DD
    scheduled_time: Mapped[str | None] = mapped_column(String, nullable=True)  # HH:MM
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
