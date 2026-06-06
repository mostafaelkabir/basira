import json
import os
from datetime import date, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.journal_entry import JournalEntry

router = APIRouter(prefix="/journal", tags=["journal"])

ENERGY_LABEL = {1: "Low", 2: "Medium", 3: "High"}
MOOD_EMOJI   = {1: "😔", 2: "😐", 3: "🙂", 4: "😊", 5: "🌟"}


def _serialize(e: JournalEntry):
    return {
        "id": e.id,
        "date": e.date,
        "mood": e.mood,
        "energy": e.energy,
        "body": e.body,
        "wins": e.wins,
        "improve": e.improve,
        "gratitude": e.gratitude,
        "tags": json.loads(e.tags) if e.tags else [],
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


@router.get("")
def list_entries(limit: int = 30, offset: int = 0, db: Session = Depends(get_db)):
    entries = (
        db.query(JournalEntry)
        .order_by(JournalEntry.date.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_serialize(e) for e in entries]


@router.get("/date/{date_str}")
def get_by_date(date_str: str, db: Session = Depends(get_db)):
    e = db.query(JournalEntry).filter(JournalEntry.date == date_str).first()
    if not e:
        return None
    return _serialize(e)


@router.get("/{entry_id}")
def get_entry(entry_id: str, db: Session = Depends(get_db)):
    e = db.get(JournalEntry, entry_id)
    if not e:
        raise HTTPException(404, "Entry not found")
    return _serialize(e)


class JournalIn(BaseModel):
    date: str
    mood: int | None = None
    energy: int | None = None
    body: str | None = None
    wins: str | None = None
    improve: str | None = None
    gratitude: str | None = None
    tags: list[str] = []


@router.post("")
def create_entry(body: JournalIn, db: Session = Depends(get_db)):
    # One entry per day — upsert
    e = db.query(JournalEntry).filter(JournalEntry.date == body.date).first()
    if not e:
        e = JournalEntry(id=str(uuid4()), date=body.date)
        db.add(e)
    e.mood = body.mood
    e.energy = body.energy
    e.body = body.body
    e.wins = body.wins
    e.improve = body.improve
    e.gratitude = body.gratitude
    e.tags = json.dumps(body.tags)
    db.commit()
    db.refresh(e)
    return _serialize(e)


@router.put("/{entry_id}")
def update_entry(entry_id: str, body: JournalIn, db: Session = Depends(get_db)):
    e = db.get(JournalEntry, entry_id)
    if not e:
        raise HTTPException(404, "Entry not found")
    e.mood = body.mood
    e.energy = body.energy
    e.body = body.body
    e.wins = body.wins
    e.improve = body.improve
    e.gratitude = body.gratitude
    e.tags = json.dumps(body.tags)
    db.commit()
    db.refresh(e)
    return _serialize(e)


@router.delete("/{entry_id}")
def delete_entry(entry_id: str, db: Session = Depends(get_db)):
    e = db.get(JournalEntry, entry_id)
    if not e:
        raise HTTPException(404, "Entry not found")
    db.delete(e)
    db.commit()
    return {"ok": True}


@router.post("/ai/reflect")
def ai_reflect(db: Session = Depends(get_db)):
    """AI analysis of the last 14 days of journal entries."""
    two_weeks_ago = (date.today() - timedelta(days=14)).isoformat()
    entries = (
        db.query(JournalEntry)
        .filter(JournalEntry.date >= two_weeks_ago)
        .order_by(JournalEntry.date.asc())
        .all()
    )
    if not entries:
        return {"insight": "No journal entries in the last 14 days. Start writing to unlock AI reflections."}

    lines = []
    for e in entries:
        mood_str = MOOD_EMOJI.get(e.mood, "?") if e.mood else "—"
        energy_str = ENERGY_LABEL.get(e.energy, "—") if e.energy else "—"
        lines.append(
            f"Date: {e.date} | Mood: {mood_str} | Energy: {energy_str}\n"
            f"Entry: {e.body or '—'}\n"
            f"Wins: {e.wins or '—'} | Improve: {e.improve or '—'} | Gratitude: {e.gratitude or '—'}"
        )

    prompt = "\n\n".join(lines)
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return {"insight": "Add a GROQ_API_KEY to your .env to enable AI reflections."}

    client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a thoughtful, empathetic life coach reviewing someone's personal journal. "
                    "Your role is to surface meaningful patterns, celebrate wins, and offer gentle, honest insight. "
                    "Be warm but direct. Keep it under 150 words. No bullet points — write in flowing prose."
                ),
            },
            {
                "role": "user",
                "content": f"Here are my journal entries from the last 14 days:\n\n{prompt}\n\nWhat patterns do you notice? What would you reflect back to me?",
            },
        ],
    )
    return {"insight": resp.choices[0].message.content}
