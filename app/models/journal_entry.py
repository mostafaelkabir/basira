from datetime import datetime, UTC
from uuid import uuid4
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Integer, Text, DateTime
from app.database import Base


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    date: Mapped[str] = mapped_column(String, nullable=False)   # YYYY-MM-DD (one per day)

    mood: Mapped[int | None] = mapped_column(Integer, nullable=True)     # 1–5
    energy: Mapped[int | None] = mapped_column(Integer, nullable=True)   # 1=low 2=medium 3=high

    body: Mapped[str | None] = mapped_column(Text, nullable=True)        # main freeform entry
    wins: Mapped[str | None] = mapped_column(Text, nullable=True)        # what went well
    improve: Mapped[str | None] = mapped_column(Text, nullable=True)     # what to do differently
    gratitude: Mapped[str | None] = mapped_column(Text, nullable=True)   # gratitude note
    tags: Mapped[str | None] = mapped_column(Text, nullable=True)        # JSON array of strings

    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))
