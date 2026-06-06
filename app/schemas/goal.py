from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.task import TaskWithProofs


class GoalCreate(BaseModel):
    title: str = Field(..., min_length=1)
    description: str = Field(default="")
    type: str | None = None
    icon: str | None = None
    cover: bool = False
    parent_id: str | None = None


class GoalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    type: str | None = None
    icon: str | None = None
    cover: bool | None = None
    parent_id: str | None = None


class GoalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    description: str
    type: str | None = None
    icon: str | None = None
    cover: bool = False
    created_at: datetime
    archived_at: datetime | None = None
    task_count: int = 0
    done_count: int = 0
    parent_id: str | None = None


class GoalDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    description: str
    type: str | None = None
    icon: str | None = None
    cover: bool = False
    created_at: datetime
    archived_at: datetime | None = None
    parent_id: str | None = None
    parent_title: str | None = None
    tasks: list[TaskWithProofs] = []
    sub_goals: list[GoalRead] = []
