"""Read-only work suggestions endpoint. Never writes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.work_suggestions import suggest_work

router = APIRouter(prefix="/work-suggestions", tags=["work suggestions"])


@router.get("")
def get_work_suggestions(
    q: str = Query("", description="Partial title / reference / client / project / tag"),
    limit: int = Query(5, ge=1, le=50),
    show_all: bool = False,
    db: Session = Depends(get_db),
):
    return suggest_work(db, q, limit=limit, show_all=show_all)
