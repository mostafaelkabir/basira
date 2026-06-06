from datetime import datetime, UTC
from uuid import uuid4
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Integer, Text, DateTime
from app.database import Base


class DailyCheckin(Base):
    __tablename__ = "daily_checkins"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    date: Mapped[str] = mapped_column(String, unique=True, nullable=False)  # YYYY-MM-DD

    # Morning
    morning_energy: Mapped[int | None] = mapped_column(Integer, nullable=True)   # 1–5
    morning_intention: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Evening
    evening_mood: Mapped[int | None] = mapped_column(Integer, nullable=True)     # 1–5
    evening_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)   # 1–5
    evening_reflection: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))
