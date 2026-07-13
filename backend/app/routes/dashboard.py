from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.session import SessionLocal
from app.services.dashboard import get_dashboard_kpis, get_recruitment_funnel


router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/kpis")
def dashboard_kpis(db: Session = Depends(get_db)):
    return get_dashboard_kpis(db)


@router.get("/funnel")
def recruitment_funnel(days: int = Query(default=30, ge=1, le=365), db: Session = Depends(get_db)):
    return get_recruitment_funnel(db, days=days)
