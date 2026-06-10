from datetime import datetime

from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WeeklyPlan(Base):
    __tablename__ = "weekly_plans"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    week_start: Mapped[str] = mapped_column(String, nullable=False, unique=True)  # YYYY-MM-DD (Monday)
    plan_json: Mapped[str] = mapped_column(Text, nullable=False)   # JSON: { mon:[task_ids], tue:[...], ... }
    ai_rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
