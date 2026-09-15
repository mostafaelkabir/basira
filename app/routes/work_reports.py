from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.company import Company
from app.services.work_reports import summarize_work, work_entries

router = APIRouter(prefix="/work-reports", tags=["work reports"])


@router.get("")
def get_work_report(
    date_from: date,
    date_to: date,
    company_id: str | None = None,
    db: Session = Depends(get_db),
):
    if date_to < date_from:
        raise HTTPException(400, "End date must be on or after start date")
    if (date_to - date_from).days > 365:
        raise HTTPException(400, "Choose a range of up to 366 days")
    company = db.query(Company.name).filter(Company.id == company_id).first() if company_id else None
    if company_id and not company:
        raise HTTPException(404, "Company not found")
    entries = work_entries(db, date_from.isoformat(), date_to.isoformat(), company_id)
    return {
        **summarize_work(entries, date_from, date_to),
        "company_name": company.name if company else "All companies",
    }
