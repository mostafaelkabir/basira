from datetime import UTC, datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, default="#2D7A6B")   # hex color for badge
    role: Mapped[str] = mapped_column(String, default="")           # your role at this company
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    work_logs: Mapped[list["WorkLog"]] = relationship("WorkLog", back_populates="company", cascade="all, delete-orphan")
