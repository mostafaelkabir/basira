from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.comment import Comment
from app.models.task import Task
from app.schemas.comment import CommentCreate, CommentRead

router = APIRouter(tags=["comments"])


class CommentUpdate(BaseModel):
    content: str


@router.post("/tasks/{task_id}/comments", response_model=CommentRead, status_code=201)
def add_comment(task_id: str, data: CommentCreate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    comment = Comment(
        id=str(uuid4()),
        task_id=task_id,
        type=data.type,
        content=data.content.strip(),
        created_at=datetime.now(UTC).isoformat(),
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.patch("/comments/{comment_id}", response_model=CommentRead)
def update_comment(comment_id: str, data: CommentUpdate, db: Session = Depends(get_db)):
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    comment.content = data.content.strip()
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: str, db: Session = Depends(get_db)):
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    db.delete(comment)
    db.commit()
