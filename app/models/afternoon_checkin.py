from datetime import datetime

from sqlalchemy import String, Text, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AfternoonCheckin(Base):
    __tablename__ = "afternoon_checkins"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    date: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    energy: Mapped[int] = mapped_column(Integer, nullable=False)          # 1–3
    working_on: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
