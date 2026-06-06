from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.comment import CommentRead
from app.schemas.proof import ProofRead


class TaskStatus(StrEnum):
    todo = "todo"
    done = "done"


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1)
    goal_id: str
    status: TaskStatus = TaskStatus.todo
    requires_proof: bool = True
    due_date: str | None = None  # YYYY-MM-DD
    habit_frequency: str = "daily"
    parent_task_id: str | None = None
    is_urgent: bool = False
    is_important: bool = False
    estimated_minutes: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    goal_id: str | None = None
    due_date: str | None = None
    habit_frequency: str | None = None
    requires_proof: bool | None = None
    pinned_date: str | None = None
    deferred_until: str | None = None
    plan_date: str | None = None
    parent_task_id: str | None = None
    is_urgent: bool | None = None
    is_important: bool | None = None
    estimated_minutes: int | None = None


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    goal_id: str
    status: str
    requires_proof: bool
    due_date: str | None = None
    habit_frequency: str = "daily"
    parent_task_id: str | None = None
    pinned_date: str | None = None
    is_urgent: bool = False
    is_important: bool = False
    sort_order: int = 0
    estimated_minutes: int | None = None


class TaskWithProofs(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    goal_id: str
    status: str
    requires_proof: bool
    due_date: str | None = None
    habit_frequency: str = "daily"
    pinned_date: str | None = None
    deferred_until: str | None = None
    plan_date: str | None = None
    parent_task_id: str | None = None
    is_urgent: bool = False
    is_important: bool = False
    sort_order: int = 0
    estimated_minutes: int | None = None
    proofs: list[ProofRead] = []
    comments: list[CommentRead] = []
    sub_tasks: list[TaskRead] = []
