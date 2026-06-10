from datetime import datetime

from sqlalchemy import String, Text, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PeriodicReflection(Base):
    __tablename__ = "periodic_reflections"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    period_type: Mapped[str] = mapped_column(String, nullable=False)    # 'weekly' | 'monthly'
    period_start: Mapped[str] = mapped_column(String, nullable=False, unique=True)  # YYYY-MM-DD
    proud_of: Mapped[str | None] = mapped_column(Text, nullable=True)
    held_back: Mapped[str | None] = mapped_column(Text, nullable=True)
    energy_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)     # 1–5
    values_alignment: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1–5
    do_differently: Mapped[str | None] = mapped_column(Text, nullable=True)
    monthly_answers: Mapped[str] = mapped_column(Text, default="{}")     # JSON blob
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
