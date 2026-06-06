from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ExecutionLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    completed_at: datetime
    notes: str
