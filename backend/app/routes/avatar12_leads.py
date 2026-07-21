from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.models.avatar12 import AvatarLead, AvatarType
from app.public_url import rewrite_local_landing_urls
from app.session import SessionLocal
from app.services.avatar12_drafts import (
    persist_avatar12_lead,
    latest_avatar12_draft,
    list_avatar12_leads as service_list_avatar12_leads,
    mark_avatar12_draft_sent,
    update_avatar12_draft,
)
from app.services.outreach_send import OutreachSendError


router = APIRouter(prefix="/api/avatar12", tags=["avatar12"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class AvatarLeadCreate(BaseModel):
    avatar_type: AvatarType
    name: str
    headline: str | None = None
    role: str | None = None
    company: str | None = None
    school: str | None = None
    past_experience: str | None = None
    location: str | None = None
    linkedin_url: str | None = None
    search_prompt: str | None = None
    source_snapshot: str | None = None
    source_query: str | None = None


import json

def _match_fields_from_snapshot(source_snapshot: str | None) -> dict:
    if not source_snapshot:
        return {}
    try:
        snap = json.loads(source_snapshot)
        if not isinstance(snap, dict):
            return {}
        out = {}
        if snap.get("match_tier"):
            out["match_tier"] = snap.get("match_tier")
        if snap.get("match_label"):
            out["match_label"] = snap.get("match_label")
        if snap.get("match_reason"):
            out["match_reason"] = snap.get("match_reason")
        return out
    except (json.JSONDecodeError, TypeError):
        return {}


def _lead_payload(lead: AvatarLead) -> dict:
    payload = {
        "id": str(lead.id),
        "avatar_type": lead.avatar_type.value if lead.avatar_type else None,
        "name": lead.name,
        "headline": lead.headline,
        "role": lead.role,
        "company": lead.company,
        "school": lead.school,
        "past_experience": lead.past_experience,
        "location": lead.location,
        "linkedin_url": lead.linkedin_url,
        "contact_email": lead.contact_email,
        "contact_phone": lead.contact_phone,
        "search_prompt": lead.search_prompt,
        "source_snapshot": lead.source_snapshot,
        "source_query": lead.source_query,
        "fit_evidence": lead.fit_evidence,
        "fit_source": lead.fit_source,
        "created_at": lead.created_at,
        "updated_at": lead.updated_at,
    }
    payload.update(_match_fields_from_snapshot(lead.source_snapshot))
    return payload


def _draft_payload(draft) -> dict:
    return {
        "id": str(draft.id),
        "avatar12_lead_id": str(draft.avatar12_lead_id),
        "status": draft.status,
        "message": rewrite_local_landing_urls(draft.message),
        "reasoning": draft.reasoning,
        "created_at": draft.created_at,
        "sent_at": draft.sent_at,
    }


def _funnel_event_payload(event) -> dict:
    return {
        "id": str(event.id),
        "event_type": event.event_type.value if event.event_type else None,
        "payload": event.payload,
        "created_at": event.created_at,
    }


class SendMessageRequest(BaseModel):
    channel: str | None = None
    channels: list[str] | None = None
    note: str | None = None
    message: str | None = None
    to_email: str | None = None
    to_phone: str | None = None
    mark_only: bool = False


class DraftUpdateRequest(BaseModel):
    message: str


class AvatarLeadUpdate(BaseModel):
    name: str | None = None
    headline: str | None = None
    role: str | None = None
    company: str | None = None
    school: str | None = None
    past_experience: str | None = None
    location: str | None = None
    linkedin_url: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None


@router.get("/leads")
def list_leads(
    avatar_type: AvatarType | None = Query(default=None),
    source_query: str | None = Query(default=None),
    db: Session = Depends(get_db)
):
    return {"items": service_list_avatar12_leads(db=db, avatar_type=avatar_type, source_query=source_query)}


@router.post("/leads")
def create_lead(payload: AvatarLeadCreate, db: Session = Depends(get_db)):
    result = persist_avatar12_lead(
        db=db,
        avatar_type=payload.avatar_type,
        name=payload.name,
        headline=payload.headline,
        role=payload.role,
        company=payload.company,
        school=payload.school,
        past_experience=payload.past_experience,
        location=payload.location,
        linkedin_url=payload.linkedin_url,
        search_prompt=payload.search_prompt,
        source_snapshot=payload.source_snapshot,
        source_query=payload.source_query or payload.search_prompt,
    )
    return result


@router.get("/leads/{lead_id}")
def get_lead(lead_id: uuid.UUID, db: Session = Depends(get_db)):
    lead = db.scalar(
        select(AvatarLead)
        .where(AvatarLead.id == lead_id)
        .options(
            selectinload(AvatarLead.drafts),
            selectinload(AvatarLead.funnel_events),
        )
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    events = sorted(
        lead.funnel_events or [],
        key=lambda item: item.created_at or "",
    )

    return {
        **_lead_payload(lead),
        "drafts": [_draft_payload(draft) for draft in lead.drafts],
        "funnel_events": [_funnel_event_payload(event) for event in events],
    }


@router.patch("/leads/{lead_id}")
def update_lead(lead_id: uuid.UUID, payload: AvatarLeadUpdate, db: Session = Depends(get_db)):
    lead = db.scalar(select(AvatarLead).where(AvatarLead.id == lead_id))
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(lead, key, value)

    db.commit()
    db.refresh(lead)
    return _lead_payload(lead)


@router.get("/leads/{lead_id}/drafts/latest")
def get_latest_draft(lead_id: uuid.UUID, db: Session = Depends(get_db)):
    draft = latest_avatar12_draft(db=db, lead_id=lead_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    return _draft_payload(draft)


@router.patch("/leads/{lead_id}/drafts/latest")
def patch_latest_draft(lead_id: uuid.UUID, payload: DraftUpdateRequest, db: Session = Depends(get_db)):
    try:
        draft = update_avatar12_draft(db=db, lead_id=lead_id, message=payload.message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not draft:
        raise HTTPException(status_code=404, detail="Lead not found")
    return draft


@router.post("/leads/{lead_id}/messages/send")
def send_message(lead_id: uuid.UUID, payload: SendMessageRequest, db: Session = Depends(get_db)):
    try:
        result = mark_avatar12_draft_sent(
            db=db,
            lead_id=lead_id,
            channel=payload.channel,
            message=payload.message,
            to_email=payload.to_email,
            to_phone=payload.to_phone,
            channels=payload.channels,
            mark_only=payload.mark_only,
        )
    except OutreachSendError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not result:
        raise HTTPException(status_code=404, detail="Lead not found")
    return result


@router.delete("/leads/{lead_id}")
def delete_lead(lead_id: uuid.UUID, db: Session = Depends(get_db)):
    lead = db.scalar(select(AvatarLead).where(AvatarLead.id == lead_id))
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    db.delete(lead)
    db.commit()
    return {"ok": True, "message": f"Lead {lead_id} successfully deleted"}

