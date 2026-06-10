"""
Weekly planning route — AI generates a 5-day plan based on behavioral profile.
"""
import json
import os
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.goal import Goal
from app.models.task import Task
from app.models.weekly_plan import WeeklyPlan

router = APIRouter(prefix="/plans", tags=["plans"])


def _monday_of(date_str: str) -> str:
    d = date.fromisoformat(date_str)
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


def _serialize_plan(p: WeeklyPlan):
    return {
        "id": p.id,
        "week_start": p.week_start,
        "plan": json.loads(p.plan_json),
        "ai_rationale": p.ai_rationale,
        "generated_at": p.generated_at.isoformat() if p.generated_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@router.get("/week/{week_start}")
def get_week_plan(week_start: str, db: Session = Depends(get_db)):
    p = db.query(WeeklyPlan).filter(WeeklyPlan.week_start == week_start).first()
    if not p:
        return None
    return _serialize_plan(p)


class SavePlanBody(BaseModel):
    plan: dict   # { mon: [task_ids], tue: [...], ... }
    ai_rationale: str | None = None


@router.post("/week/{week_start}")
def save_week_plan(week_start: str, body: SavePlanBody, db: Session = Depends(get_db)):
    """Save/update an accepted week plan and set plan_date on tasks."""
    now = datetime.now(UTC)
    p = db.query(WeeklyPlan).filter(WeeklyPlan.week_start == week_start).first()
    if not p:
        p = WeeklyPlan(id=str(uuid4()), week_start=week_start, generated_at=now)
        db.add(p)
    p.plan_json = json.dumps(body.plan)
    if body.ai_rationale:
        p.ai_rationale = body.ai_rationale
    p.updated_at = now

    # Map day name → YYYY-MM-DD offset from week_start
    day_offset = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
    base = date.fromisoformat(week_start)
    for day_key, task_ids in body.plan.items():
        offset = day_offset.get(day_key.lower(), 0)
        plan_date = (base + timedelta(days=offset)).isoformat()
        for task_id in task_ids:
            task = db.get(Task, task_id)
            if task:
                task.plan_date = plan_date

    db.commit()
    db.refresh(p)
    return _serialize_plan(p)


class GenerateWeekBody(BaseModel):
    week_start: str   # YYYY-MM-DD


@router.post("/generate-week")
def generate_week_plan(body: GenerateWeekBody, db: Session = Depends(get_db)):
    """AI-generate a 5-day task plan for the given week."""
    week_start = _monday_of(body.week_start)
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(500, "GROQ_API_KEY not set")

    # Load active tasks (todo + not archived)
    tasks = (
        db.query(Task)
        .join(Goal, Task.goal_id == Goal.id)
        .filter(
            Task.status == "todo",
            Goal.archived_at.is_(None),
        )
        .order_by(
            Task.is_urgent.desc(),
            Task.is_important.desc(),
        )
        .limit(40)
        .all()
    )

    # Build task context
    task_lines = []
    for t in tasks:
        goal = db.get(Goal, t.goal_id)
        flags = []
        if t.is_urgent:
            flags.append("URGENT")
        if t.is_important:
            flags.append("IMPORTANT")
        if t.deferred_until:
            flags.append(f"deferred to {t.deferred_until}")
        flag_str = f" [{', '.join(flags)}]" if flags else ""
        est = f" ~{t.estimated_minutes}min" if t.estimated_minutes else ""
        goal_name = goal.title if goal else "?"
        task_lines.append(f"- [{t.id}] {t.title}{flag_str}{est} (goal: {goal_name})")

    tasks_text = "\n".join(task_lines) if task_lines else "No pending tasks."

    # Build the AI prompt
    system_prompt = (
        "You are a personal productivity planner. Your job is to create a focused, "
        "realistic 5-day work plan for Monday through Friday. "
        "Rules: (1) Max 4 tasks per day. (2) Place URGENT+IMPORTANT tasks early in the week. "
        "(3) Leave some breathing room — not every task needs to be assigned. "
        "(4) Group similar tasks on the same day when possible. "
        "(5) Respond ONLY with valid JSON in this exact format: "
        '{"mon":["task_id1","task_id2"],"tue":[...],"wed":[...],"thu":[...],"fri":[...]} '
        "followed by a newline, then a 2-3 sentence rationale starting with 'RATIONALE:'"
    )

    user_msg = f"Week of {week_start}. Here are the pending tasks:\n\n{tasks_text}\n\nCreate the week plan."

    client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.4,
    )

    raw = resp.choices[0].message.content or ""

    # Parse JSON + rationale
    plan_json = {}
    rationale = ""
    try:
        # Find first { ... } block
        start = raw.index("{")
        # Find the end by finding RATIONALE: line
        rat_idx = raw.find("RATIONALE:")
        if rat_idx > 0:
            json_part = raw[start:rat_idx].strip()
            rationale = raw[rat_idx + len("RATIONALE:"):].strip()
        else:
            json_part = raw[start:]
        plan_json = json.loads(json_part)
    except Exception:
        # Fallback: return empty plan
        plan_json = {"mon": [], "tue": [], "wed": [], "thu": [], "fri": []}
        rationale = "Could not parse AI plan. Showing empty plan for manual filling."

    # Validate task IDs exist
    valid_ids = {t.id for t in tasks}
    plan_json = {
        day: [tid for tid in ids if tid in valid_ids]
        for day, ids in plan_json.items()
    }

    return {
        "week_start": week_start,
        "plan": plan_json,
        "ai_rationale": rationale,
        "task_pool": [
            {
                "id": t.id,
                "title": t.title,
                "is_urgent": t.is_urgent or False,
                "is_important": t.is_important or False,
                "estimated_minutes": t.estimated_minutes,
                "goal_id": t.goal_id,
            }
            for t in tasks
        ],
    }
