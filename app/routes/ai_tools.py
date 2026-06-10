import os
from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.comment import Comment
from app.models.journal_entry import JournalEntry
from app.models.work_ticket import WorkTicketComment

router = APIRouter(prefix="/ai", tags=["ai"])

CONTEXT_PROMPTS = {
    "journal":    "You are polishing a personal journal entry. Keep the author's voice, emotions, and meaning intact. Fix grammar, improve flow, and make it clearer — but never make it sound formal or generic.",
    "comment":    "You are polishing a short work note or comment. Keep it concise, clear, and professional. Fix grammar and improve clarity without changing the meaning.",
    "intention":  "You are polishing a daily intention statement. Make it focused, motivating, and clear. Keep it personal and in first person.",
    "reflection": "You are polishing a brief end-of-day reflection. Keep it honest, personal, and concise.",
    "wins":       "You are polishing a 'what went well today' note. Keep it positive, specific, and in first person.",
    "improve":    "You are polishing a 'what to improve' note. Keep it constructive, honest, and actionable.",
    "gratitude":  "You are polishing a gratitude note. Keep it warm, sincere, and personal.",
    "default":    "You are a writing assistant. Polish the following text: fix grammar, improve clarity, and make it more concise — while preserving the original meaning and tone.",
}


def _run_polish(text: str, context: str) -> str:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(503, "No GROQ_API_KEY configured")
    prompt = CONTEXT_PROMPTS.get(context, CONTEXT_PROMPTS["default"])
    client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": prompt + "\n\nRespond with ONLY the polished text — no explanations, no quotes, no preamble."},
            {"role": "user", "content": text},
        ],
        temperature=0.4,
        max_tokens=1024,
    )
    return resp.choices[0].message.content.strip()


# ── Pre-save polish (used in compose forms) ────────────────────────────────

class PolishRequest(BaseModel):
    text: str
    context: str = "default"


@router.post("/polish")
def polish_text(body: PolishRequest):
    if not body.text or not body.text.strip():
        return {"polished": body.text}
    try:
        return {"polished": _run_polish(body.text, body.context)}
    except HTTPException as e:
        return {"polished": body.text, "error": e.detail}


# ── Polish saved records (persists both versions to DB) ────────────────────

class ToggleRequest(BaseModel):
    show: str   # "polished" | "original"


@router.post("/polish/ticket-comment/{comment_id}")
def polish_ticket_comment(comment_id: str, db: Session = Depends(get_db)):
    c = db.get(WorkTicketComment, comment_id)
    if not c:
        raise HTTPException(404, "Comment not found")
    # Always polish from the original (or current body if first time)
    source = c.body_original if c.body_original else c.body
    polished = _run_polish(source, "comment")
    if not c.body_original:
        c.body_original = c.body   # snapshot original on first polish
    c.body = polished
    db.commit()
    db.refresh(c)
    return {"id": c.id, "body": c.body, "body_original": c.body_original, "type": c.type, "created_at": c.created_at.isoformat()}


@router.post("/restore/ticket-comment/{comment_id}")
def restore_ticket_comment(comment_id: str, db: Session = Depends(get_db)):
    c = db.get(WorkTicketComment, comment_id)
    if not c or not c.body_original:
        raise HTTPException(404, "No original found")
    c.body = c.body_original
    c.body_original = None
    db.commit()
    db.refresh(c)
    return {"id": c.id, "body": c.body, "body_original": None, "type": c.type, "created_at": c.created_at.isoformat()}


@router.post("/polish/task-comment/{comment_id}")
def polish_task_comment(comment_id: str, db: Session = Depends(get_db)):
    c = db.get(Comment, comment_id)
    if not c:
        raise HTTPException(404, "Comment not found")
    source = c.content_original if c.content_original else c.content
    polished = _run_polish(source, "comment")
    if not c.content_original:
        c.content_original = c.content
    c.content = polished
    db.commit()
    db.refresh(c)
    return {"id": c.id, "content": c.content, "content_original": c.content_original, "type": c.type, "created_at": c.created_at}


@router.post("/restore/task-comment/{comment_id}")
def restore_task_comment(comment_id: str, db: Session = Depends(get_db)):
    c = db.get(Comment, comment_id)
    if not c or not c.content_original:
        raise HTTPException(404, "No original found")
    c.content = c.content_original
    c.content_original = None
    db.commit()
    db.refresh(c)
    return {"id": c.id, "content": c.content, "content_original": None, "type": c.type, "created_at": c.created_at}


JOURNAL_FIELDS = {"body": "journal", "wins": "wins", "improve": "improve", "gratitude": "gratitude"}

class JournalPolishRequest(BaseModel):
    field: str   # body | wins | improve | gratitude


@router.post("/polish/journal/{entry_id}")
def polish_journal_field(entry_id: str, body: JournalPolishRequest, db: Session = Depends(get_db)):
    e = db.get(JournalEntry, entry_id)
    if not e:
        raise HTTPException(404, "Entry not found")
    field = body.field
    if field not in JOURNAL_FIELDS:
        raise HTTPException(400, f"Unknown field: {field}")

    original_field = f"{field}_original"
    current = getattr(e, field) or ""
    original = getattr(e, original_field, None)
    source = original if original else current
    if not source.strip():
        raise HTTPException(400, "Field is empty")

    polished = _run_polish(source, JOURNAL_FIELDS[field])
    if not original:
        setattr(e, original_field, current)   # snapshot on first polish
    setattr(e, field, polished)
    db.commit()
    db.refresh(e)
    return _journal_serialize(e)


@router.post("/restore/journal/{entry_id}")
def restore_journal_field(entry_id: str, body: JournalPolishRequest, db: Session = Depends(get_db)):
    e = db.get(JournalEntry, entry_id)
    if not e:
        raise HTTPException(404, "Entry not found")
    field = body.field
    original_field = f"{field}_original"
    original = getattr(e, original_field, None)
    if not original:
        raise HTTPException(404, "No original saved")
    setattr(e, field, original)
    setattr(e, original_field, None)
    db.commit()
    db.refresh(e)
    return _journal_serialize(e)


def _journal_serialize(e: JournalEntry):
    import json
    return {
        "id": e.id, "date": e.date,
        "mood": e.mood, "energy": e.energy,
        "body": e.body, "body_original": e.body_original,
        "wins": e.wins, "wins_original": e.wins_original,
        "improve": e.improve, "improve_original": e.improve_original,
        "gratitude": e.gratitude, "gratitude_original": e.gratitude_original,
        "tags": json.loads(e.tags) if e.tags else [],
    }


# ── Profile Narrative ─────────────────────────────────────────────────────────

class ProfileNarrativeRequest(BaseModel):
    profile: dict  # full /insights/profile response


@router.post("/profile-narrative")
def profile_narrative(body: ProfileNarrativeRequest):
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(503, "No GROQ_API_KEY configured")

    p = body.profile
    scores = p.get("dimension_scores", {})
    best_hour = p.get("best_hour")
    best_day = p.get("best_day", "")
    affinity = p.get("task_type_affinity", [])
    procrastination = p.get("procrastination", {})
    eisenhower = p.get("eisenhower", {})

    # Build a compact data summary for the prompt
    lines = [
        f"Performance window: peak hour {best_hour}:00, best day {best_day}.",
        f"Execution score: {scores.get('execution', '?')}% | Consistency: {scores.get('consistency', '?')}% | Growth: {scores.get('growth', '?')}%",
        f"Focus score: {scores.get('focus') or 'not yet rated (no timer ratings)'}",
        f"Planning (Q2 work): {scores.get('planning', '?')}%",
        f"Balance score: {scores.get('balance', '?')}",
    ]

    if affinity:
        top = affinity[0]
        lines.append(f"Top task type: {top.get('goal_type')} ({top.get('completions')} completions, feeling: {top.get('feeling_label', 'unrated')})")

    reasons = procrastination.get("reason_distribution", [])
    if reasons:
        top_reason = reasons[0]
        lines.append(f"Top deferral reason: {top_reason.get('reason')} ({top_reason.get('pct')}% of deferrals)")

    most_deferred = procrastination.get("most_deferred_tasks", [])
    if most_deferred:
        lines.append(f"Most deferred task: \"{most_deferred[0].get('title')}\" ({most_deferred[0].get('defer_count')} times)")

    q2 = eisenhower.get("q2", {})
    lines.append(f"Q2 work (important, not urgent): {q2.get('pct', 0)}% of completions")

    data_summary = "\n".join(lines)

    client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are Basira, a self-knowledge mirror. "
                    "Based on 30–90 days of behavioral data, write a clear-eyed, warm, and specific "
                    "narrative about this person as a performer. "
                    "Mention their strongest pattern, their main friction point, and one concrete "
                    "structural recommendation. Do not use generic motivational language. "
                    "Be specific to the numbers. Write in flowing prose, 150–200 words."
                ),
            },
            {
                "role": "user",
                "content": f"Here is my behavioral data summary:\n\n{data_summary}\n\nWhat does this say about me as a performer?",
            },
        ],
    )
    return {"narrative": resp.choices[0].message.content}
