from datetime import UTC, datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Board(Base):
    """A free-form planning whiteboard: one tldraw document, scoped to a goal,
    a client, all work, or nothing. The board stores drawing and placement only;
    linked cards read live ticket/task/goal data through /boards/entities."""
    __tablename__ = "boards"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    # scope_type: global | work | goal | company
    scope_type: Mapped[str] = mapped_column(String, default="global", nullable=False)
    scope_id: Mapped[str | None] = mapped_column(String, nullable=True)   # goal id or company id
    document: Mapped[str] = mapped_column(Text, default="{}", nullable=False)   # tldraw store snapshot (JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
