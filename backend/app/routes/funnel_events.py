from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models.avatar12 import FunnelEventType
from app.session import SessionLocal
from app.services.avatar12_drafts import record_avatar12_funnel_event


router = APIRouter(prefix="/api/funnel-events", tags=["funnel-events"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class FunnelEventCreate(BaseModel):
    lead_id: uuid.UUID
    payload: dict | None = None


@router.post("/{event_type}")
def create_funnel_event(event_type: FunnelEventType, payload: FunnelEventCreate, db: Session = Depends(get_db)):
    result = record_avatar12_funnel_event(
        db=db,
        lead_id=payload.lead_id,
        event_type=event_type,
        payload=payload.payload,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")
    return result
