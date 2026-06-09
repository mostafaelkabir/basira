import os
from fastapi import APIRouter
from openai import OpenAI
from pydantic import BaseModel

router = APIRouter(prefix="/ai", tags=["ai"])

CONTEXT_PROMPTS = {
    "journal":     "You are polishing a personal journal entry. Keep the author's voice, emotions, and meaning intact. Fix grammar, improve flow, and make it clearer — but never make it sound formal or generic.",
    "comment":     "You are polishing a short work note or comment. Keep it concise, clear, and professional. Fix grammar and improve clarity without changing the meaning.",
    "intention":   "You are polishing a daily intention statement. Make it focused, motivating, and clear. Keep it personal and in first person.",
    "reflection":  "You are polishing a brief end-of-day reflection. Keep it honest, personal, and concise.",
    "wins":        "You are polishing a 'what went well today' note. Keep it positive, specific, and in first person.",
    "improve":     "You are polishing a 'what to improve' note. Keep it constructive, honest, and actionable.",
    "gratitude":   "You are polishing a gratitude note. Keep it warm, sincere, and personal.",
    "default":     "You are a writing assistant. Polish the following text: fix grammar, improve clarity, and make it more concise — while preserving the original meaning and tone.",
}


class PolishRequest(BaseModel):
    text: str
    context: str = "default"   # journal | comment | intention | reflection | wins | improve | gratitude


@router.post("/polish")
def polish_text(body: PolishRequest):
    if not body.text or not body.text.strip():
        return {"polished": body.text}

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return {"polished": body.text, "error": "No GROQ_API_KEY configured."}

    system_prompt = CONTEXT_PROMPTS.get(body.context, CONTEXT_PROMPTS["default"])

    client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": system_prompt + "\n\nRespond with ONLY the polished text — no explanations, no quotes, no preamble."},
            {"role": "user", "content": body.text},
        ],
        temperature=0.4,
        max_tokens=1024,
    )
    polished = resp.choices[0].message.content.strip()
    return {"polished": polished}
