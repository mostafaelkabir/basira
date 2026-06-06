from pydantic import BaseModel

from app.schemas.comment import CommentRead
from app.schemas.proof import ProofRead
from app.schemas.task import TaskRead, TaskWithProofs


class FocusTaskRead(BaseModel):
    id: str
    title: str
    goal_id: str
    goal_title: str
    status: str
    requires_proof: bool
    pinned_date: str | None = None
    parent_task_id: str | None = None
    parent_task_title: str | None = None
    is_urgent: bool = False
    is_important: bool = False
    sort_order: int = 0
    proofs: list[ProofRead] = []
    comments: list[CommentRead] = []
    sub_tasks: list[TaskRead] = []


class HabitItem(BaseModel):
    id: str
    title: str
    goal_id: str
    goal_title: str
    checked_today: bool
    today_count: int
    today_target: int
    habit_frequency: str
    requires_proof: bool
    has_proof_today: bool
    streak: int
    weekly_checkins: list[str]
    monthly_checkins: list[str]
    plan_date: str | None = None


class ProjectSummary(BaseModel):
    goal_id: str
    goal_title: str
    tasks: list[TaskWithProofs]


class TodayResponse(BaseModel):
    date: str
    focus: list[FocusTaskRead]
    daily: list[TaskWithProofs]
    habits: list[HabitItem]
    projects: list[ProjectSummary]
