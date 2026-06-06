from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.call_log import CallLog
from app.models.contact import Contact

router = APIRouter(prefix="/contacts", tags=["contacts"])


class ContactCreate(BaseModel):
    name: str = Field(..., min_length=1)
    photo: str | None = None
    notes: str | None = None


class ContactUpdate(BaseModel):
    name: str | None = None
    photo: str | None = None
    notes: str | None = None


class CallLogCreate(BaseModel):
    called_at: str  # YYYY-MM-DD
    summary: str = Field(..., min_length=1)


def _serialize(contact: Contact) -> dict:
    calls = sorted(contact.calls, key=lambda c: c.called_at, reverse=True)
    last = calls[0].called_at if calls else None
    days_since = None
    if last:
        days_since = (date.today() - date.fromisoformat(last)).days
    return {
        "id": contact.id,
        "name": contact.name,
        "photo": contact.photo,
        "notes": contact.notes,
        "created_at": contact.created_at,
        "call_count": len(calls),
        "last_called": last,
        "days_since_call": days_since,
        "calls": [
            {
                "id": c.id,
                "called_at": c.called_at,
                "summary": c.summary,
                "created_at": c.created_at,
            }
            for c in calls
        ],
    }


@router.get("")
def list_contacts(db: Session = Depends(get_db)):
    contacts = (
        db.query(Contact)
        .options(joinedload(Contact.calls))
        .order_by(Contact.name)
        .all()
    )
    result = [_serialize(c) for c in contacts]
    # Sort: never called last, otherwise oldest call first (needs attention)
    return sorted(result, key=lambda c: (
        c["last_called"] is None,
        c["days_since_call"] if c["days_since_call"] is not None else 0
    ), reverse=True)


@router.post("", status_code=201)
def create_contact(data: ContactCreate, db: Session = Depends(get_db)):
    contact = Contact(
        id=str(uuid4()),
        name=data.name.strip(),
        photo=data.photo,
        notes=data.notes,
        created_at=datetime.now(UTC).isoformat(),
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return _serialize(contact)


@router.patch("/{contact_id}")
def update_contact(contact_id: str, data: ContactUpdate, db: Session = Depends(get_db)):
    contact = db.query(Contact).options(joinedload(Contact.calls)).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(contact, field, value)
    db.commit()
    db.refresh(contact)
    return _serialize(contact)


@router.delete("/{contact_id}", status_code=204)
def delete_contact(contact_id: str, db: Session = Depends(get_db)):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()


@router.post("/{contact_id}/calls", status_code=201)
def log_call(contact_id: str, data: CallLogCreate, db: Session = Depends(get_db)):
    contact = db.query(Contact).options(joinedload(Contact.calls)).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    call = CallLog(
        id=str(uuid4()),
        contact_id=contact_id,
        called_at=data.called_at,
        summary=data.summary.strip(),
        created_at=datetime.now(UTC).isoformat(),
    )
    db.add(call)
    db.commit()
    db.refresh(contact)
    return _serialize(contact)


@router.delete("/calls/{call_id}", status_code=204)
def delete_call(call_id: str, db: Session = Depends(get_db)):
    call = db.query(CallLog).filter(CallLog.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call log not found")
    db.delete(call)
    db.commit()
