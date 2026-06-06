from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Proof(Base):
    __tablename__ = "proofs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    task_id: Mapped[str] = mapped_column(String, ForeignKey("tasks.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False)
    date: Mapped[str | None] = mapped_column(String, nullable=True)  # YYYY-MM-DD, set for habit proofs

    task: Mapped["Task"] = relationship("Task", back_populates="proofs")
