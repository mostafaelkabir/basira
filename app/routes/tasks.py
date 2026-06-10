import os
import time
from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.defer_log import DeferLog
from app.models.execution_log import ExecutionLog
from app.models.goal import Goal
from app.models.task import Task
from app.models.comment import Comment
from app.models.proof import Proof
from app.schemas.task import TaskCreate, TaskRead, TaskStatus, TaskUpdate, TaskWithProofs

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("", response_model=TaskRead, status_code=201)
def create_task(task_data: TaskCreate, db: Session = Depends(get_db)) -> Task:
    goal = db.query(Goal).filter(Goal.id == task_data.goal_id).first()
    if not goal:
        raise HTTPException(status_code=400, detail="goal_id must reference an existing goal")

    # New tasks go to the end by default (high sort_order = appears last)
    max_order = db.query(Task).filter(Task.goal_id == task_data.goal_id).count()

    task = Task(
        id=str(uuid4()),
        title=task_data.title,
        goal_id=task_data.goal_id,
        status=task_data.status,
        requires_proof=task_data.requires_proof,
        due_date=task_data.due_date,
        parent_task_id=task_data.parent_task_id,
        is_urgent=task_data.is_urgent,
        is_important=task_data.is_important,
        sort_order=max_order * 1000 + 1000,
        created_at=date.today().isoformat(),
        estimated_minutes=task_data.estimated_minutes,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(task_id: str, data: TaskUpdate, db: Session = Depends(get_db)) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    updates = data.model_dump(exclude_unset=True)
    defer_reason = updates.pop("defer_reason", None)
    # Log deferral events when deferred_until is explicitly set to a future date
    if "deferred_until" in updates and updates["deferred_until"]:
        dl = DeferLog(
            id=str(uuid4()),
            task_id=task_id,
            deferred_on=date.today().isoformat(),
            deferred_until=updates["deferred_until"],
        )
        if defer_reason:
            dl.defer_reason = defer_reason
        db.add(dl)
    for field, value in updates.items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


class ReorderItem(BaseModel):
    id: str
    sort_order: int


@router.get("/{task_id}", response_model=TaskWithProofs)
def get_task(task_id: str, db: Session = Depends(get_db)):
    from app.schemas.comment import CommentRead
    from app.schemas.proof import ProofRead
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    proofs    = db.query(Proof).filter(Proof.task_id == task_id).all()
    comments  = db.query(Comment).filter(Comment.task_id == task_id).order_by(Comment.created_at).all()
    sub_tasks = db.query(Task).filter(Task.parent_task_id == task_id).all()
    return TaskWithProofs(
        id=task.id,
        title=task.title,
        goal_id=task.goal_id,
        status=task.status,
        requires_proof=task.requires_proof,
        due_date=task.due_date,
        habit_frequency=task.habit_frequency or "daily",
        pinned_date=task.pinned_date,
        deferred_until=task.deferred_until,
        plan_date=task.plan_date,
        parent_task_id=task.parent_task_id,
        is_urgent=task.is_urgent or False,
        is_important=task.is_important or False,
        sort_order=task.sort_order or 0,
        estimated_minutes=task.estimated_minutes,
        proofs=[ProofRead.model_validate(p) for p in proofs],
        comments=[CommentRead.model_validate(c) for c in comments],
        sub_tasks=[TaskRead.model_validate(s) for s in sub_tasks],
    )


class AIQueryBody(BaseModel):
    prompt: str

@router.post("/{task_id}/ai")
def task_ai_query(task_id: str, body: AIQueryBody, db: Session = Depends(get_db)):
    from app.schemas.comment import CommentRead

    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Gather text comments as context
    comments = (
        db.query(Comment)
        .filter(Comment.task_id == task_id, Comment.type.in_(["text", "ai"]))
        .order_by(Comment.created_at)
        .all()
    )

    comment_lines = []
    for c in comments:
        prefix = "AI" if c.type == "ai" else "You"
        comment_lines.append(f"[{prefix}]: {c.content}")

    context_block = "\n".join(comment_lines) if comment_lines else "(no comments yet)"

    system_prompt = (
        "You are a focused productivity assistant embedded inside a task management app. "
        "The user will ask you questions or give instructions about the task and its notes. "
        "Be concise and helpful. When extracting or listing items, use a clean numbered or bulleted format."
    )
    user_message = (
        f"Task: {task.title}\n\n"
        f"Notes / comments so far:\n{context_block}\n\n"
        f"User request: {body.prompt}"
    )

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="GROQ_API_KEY not configured — add it to your .env file (free at console.groq.com)")

    try:
        from openai import OpenAI
        client = OpenAI(
            api_key=api_key,
            base_url="https://api.groq.com/openai/v1",
        )
        resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_message},
            ],
            max_tokens=1024,
        )
        reply = resp.choices[0].message.content.strip()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI error: {str(e)}")

    # Save AI reply as a comment so it persists with the task
    now = datetime.now(UTC).isoformat()
    comment = Comment(
        id=str(uuid4()),
        task_id=task_id,
        type="ai",
        content=reply,
        created_at=now,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    return {"reply": reply, "comment": CommentRead.model_validate(comment)}


@router.post("/reorder", status_code=204)
def reorder_tasks(items: list[ReorderItem], db: Session = Depends(get_db)) -> None:
    ids = [item.id for item in items]
    tasks_map = {t.id: t for t in db.query(Task).filter(Task.id.in_(ids)).all()}
    for item in items:
        if item.id in tasks_map:
            tasks_map[item.id].sort_order = item.sort_order
    db.commit()


class CompleteTaskBody(BaseModel):
    feeling: str | None = None  # 'grind' | 'flow' | 'loved'


@router.post("/{task_id}/complete", response_model=TaskRead)
def complete_task(task_id: str, body: CompleteTaskBody = CompleteTaskBody(), db: Session = Depends(get_db)) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.requires_proof and not task.proofs:
        raise HTTPException(status_code=400, detail="Proof is required before completing this task")

    task.status = TaskStatus.done
    log = ExecutionLog(
        id=str(uuid4()),
        task_id=task.id,
        completed_at=datetime.now(UTC),
    )
    if body.feeling:
        log.task_feeling = body.feeling
    db.add(log)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: str, db: Session = Depends(get_db)) -> None:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
