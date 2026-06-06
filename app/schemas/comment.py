from pydantic import BaseModel, ConfigDict, Field


class CommentCreate(BaseModel):
    type: str = "text"
    content: str = Field(..., min_length=1)


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    type: str = "text"
    content: str
    created_at: str
