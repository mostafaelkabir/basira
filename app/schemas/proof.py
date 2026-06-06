from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class ProofType(StrEnum):
    text = "text"
    link = "link"
    image = "image"
    file = "file"


class ProofCreate(BaseModel):
    type: ProofType
    content: str = Field(..., min_length=1)
    date: str | None = None  # YYYY-MM-DD, for habit proofs


class ProofRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    type: str
    content: str
    date: str | None = None
