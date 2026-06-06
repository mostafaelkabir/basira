from uuid import uuid4
from datetime import datetime, UTC

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.company import Company

router = APIRouter(prefix="/companies", tags=["companies"])


class CompanyCreate(BaseModel):
    name: str
    color: str = "#2D7A6B"
    role: str = ""


class CompanyUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    role: str | None = None


def _serialize_company(c: Company) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "color": c.color,
        "role": c.role,
        "created_at": str(c.created_at),
    }


@router.get("")
def list_companies(db: Session = Depends(get_db)):
    return [_serialize_company(c) for c in db.query(Company).order_by(Company.created_at).all()]


@router.post("", status_code=201)
def create_company(body: CompanyCreate, db: Session = Depends(get_db)):
    company = Company(
        id=str(uuid4()),
        name=body.name,
        color=body.color,
        role=body.role,
        created_at=datetime.now(UTC),
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return _serialize_company(company)


@router.put("/{company_id}")
def update_company(company_id: str, body: CompanyUpdate, db: Session = Depends(get_db)):
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    if body.name is not None:
        company.name = body.name
    if body.color is not None:
        company.color = body.color
    if body.role is not None:
        company.role = body.role
    db.commit()
    db.refresh(company)
    return _serialize_company(company)


@router.delete("/{company_id}", status_code=204)
def delete_company(company_id: str, db: Session = Depends(get_db)):
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(company)
    db.commit()
