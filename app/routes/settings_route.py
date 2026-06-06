from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.setting import Setting

router = APIRouter(prefix="/settings", tags=["settings"])

DEFAULTS = {
    "reminder_enabled": "true",
    "reminder_time": "21:00",
}


def get_all_settings(db: Session) -> dict[str, str]:
    rows = db.query(Setting).all()
    result = {**DEFAULTS}
    for row in rows:
        result[row.key] = row.value
    return result


@router.get("")
def read_settings(db: Session = Depends(get_db)) -> dict:
    return get_all_settings(db)


class SettingsUpdate(BaseModel):
    reminder_enabled: bool | None = None
    reminder_time: str | None = None  # HH:MM


@router.patch("")
def update_settings(data: SettingsUpdate, db: Session = Depends(get_db)) -> dict:
    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        row = db.query(Setting).filter(Setting.key == key).first()
        str_value = str(value).lower() if isinstance(value, bool) else str(value)
        if row:
            row.value = str_value
        else:
            db.add(Setting(key=key, value=str_value))
    db.commit()
    return get_all_settings(db)
