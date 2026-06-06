from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.proof import Proof
from app.models.task import Task
from app.schemas.proof import ProofCreate, ProofRead

router = APIRouter(prefix="/tasks", tags=["proofs"])


@router.post("/{task_id}/proof", response_model=ProofRead, status_code=201)
def create_proof(task_id: str, proof_data: ProofCreate, db: Session = Depends(get_db)) -> Proof:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    proof = Proof(
        id=str(uuid4()),
        task_id=task_id,
        type=proof_data.type,
        content=proof_data.content,
        date=proof_data.date,
    )
    db.add(proof)
    db.commit()
    db.refresh(proof)
    return proof
