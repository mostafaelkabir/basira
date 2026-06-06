import os
import shutil
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile

UPLOAD_DIR = "uploads"
ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
ALLOWED_FILE_EXTS = {".pdf", ".doc", ".docx", ".txt", ".md", ".pages", ".rtf", ".csv", ".xlsx", ".xls"}

router = APIRouter(prefix="/proofs", tags=["proofs"])


@router.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="Only image files are allowed (jpg, png, gif, webp)")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{uuid4()}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as out:
        shutil.copyfileobj(file.file, out)
    return {"url": f"/uploads/{filename}"}


@router.post("/upload-file")
async def upload_file(file: UploadFile = File(...)):
    original_name = file.filename or "file"
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in ALLOWED_FILE_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Supported: pdf, doc, docx, txt, md, pages, rtf, csv, xlsx"
        )
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{uuid4()}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as out:
        shutil.copyfileobj(file.file, out)
    return {"url": f"/uploads/{filename}", "name": original_name}
