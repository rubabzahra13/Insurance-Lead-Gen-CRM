from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.business import (
    BusinessInteraction,
    BusinessLead,
    BusinessNote,
    FollowUpPlan,
    InteractionChannel,
    InteractionDirection,
    PipelineEvent,
    PipelineEventType,
    PipelineStage,
)
from app.session import SessionLocal
from app.services.followup_planning import plan_follow_up
from app.services.reclassification import reclassify_note
from app.services.avatar3_tools import enrich_business_website
from app.services.outreach_send import OutreachSendError, dispatch_outreach


router = APIRouter(prefix="/api/avatar3", tags=["avatar3"])
logger = logging.getLogger(__name__)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class LeadCreate(BaseModel):
    business_name: str
    address: str | None = None
    website: str | None = None
    google_place_id: str | None = None
    rating: str | None = None
    open_status: str | None = None
    phone: str | None = None
    owner_name: str | None = None
    manager_name: str | None = None
    contact_email: str | None = None
    contact_linkedin: str | None = None
    pipeline_stage: PipelineStage = PipelineStage.new
    source_query: str | None = None


class LeadStageUpdate(BaseModel):
    to_stage: str


class NoteCreate(BaseModel):
    content: str = Field(min_length=3, max_length=5000)
    author: str


def _lead_payload(lead: BusinessLead) -> dict:
    return {
        "id": str(lead.id),
        "business_name": lead.business_name,
        "address": lead.address,
        "website": lead.website,
        "google_place_id": lead.google_place_id,
        "rating": lead.rating,
        "open_status": lead.open_status,
        "phone": lead.phone,
        "owner_name": lead.owner_name,
        "manager_name": lead.manager_name,
        "contact_email": lead.contact_email,
        "contact_linkedin": lead.contact_linkedin,
        "pipeline_stage": lead.pipeline_stage.value if lead.pipeline_stage else None,
        "source_query": lead.source_query,
        "has_image": lead.image_data is not None,
        "created_at": lead.created_at,
        "updated_at": lead.updated_at,
    }


def _event_payload(event: PipelineEvent) -> dict:
    return {
        "id": str(event.id),
        "business_lead_id": str(event.business_lead_id),
        "event_type": event.event_type.value if event.event_type else None,
        "from_stage": event.from_stage.value if event.from_stage else None,
        "to_stage": event.to_stage.value if event.to_stage else None,
        "description": event.description,
        "created_at": event.created_at,
    }


def _note_payload(note: BusinessNote) -> dict:
    return {
        "id": str(note.id),
        "business_lead_id": str(note.business_lead_id),
        "content": note.content,
        "author": note.author,
        "created_at": note.created_at,
    }


def update_stage_in_db(*, lead: BusinessLead, next_stage: PipelineStage, db: Session, description: str) -> None:
    previous = lead.pipeline_stage
    lead.pipeline_stage = next_stage
    db.add(
        PipelineEvent(
            business_lead_id=lead.id,
            event_type=PipelineEventType.stage_change,
            from_stage=previous,
            to_stage=next_stage,
            description=description,
        )
    )
    db.commit()
    db.refresh(lead)


@router.post("/leads")
def create_lead(payload: LeadCreate, db: Session = Depends(get_db)):
    if payload.google_place_id:
        existing = db.scalar(
            select(BusinessLead).where(BusinessLead.google_place_id == payload.google_place_id)
        )
        if existing:
            return {**_lead_payload(existing), "duplicate": True}

    lead = BusinessLead(**payload.model_dump())
    if payload.google_place_id:
        try:
            from app.services.avatar3_tools import fetch_business_photo
            img_data, img_type = fetch_business_photo(payload.google_place_id)
            lead.image_data = img_data
            lead.image_content_type = img_type
        except Exception as exc:
            logger.exception("Failed to fetch photo for place %s: %s", payload.google_place_id, exc)
    db.add(lead)
    try:
        db.flush()
        db.add(
            PipelineEvent(
                business_lead_id=lead.id,
                event_type=PipelineEventType.stage_change,
                from_stage=None,
                to_stage=lead.pipeline_stage,
                description=f"Lead created at stage {lead.pipeline_stage.value}",
            )
        )
        db.commit()
        db.refresh(lead)
        return {**_lead_payload(lead), "duplicate": False}
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(BusinessLead).where(BusinessLead.google_place_id == payload.google_place_id)
        )
        if not existing:
            raise
        return {**_lead_payload(existing), "duplicate": True}


@router.get("/leads")
def list_leads(
    stage: PipelineStage | None = Query(default=None),
    source_query: str | None = Query(default=None),
    db: Session = Depends(get_db)
):
    stmt = select(BusinessLead).order_by(desc(BusinessLead.updated_at))
    if stage is not None:
        stmt = stmt.where(BusinessLead.pipeline_stage == stage)
    if source_query is not None:
        stmt = stmt.where(BusinessLead.source_query == source_query)
    leads = db.scalars(stmt).all()
    return {"items": [_lead_payload(lead) for lead in leads]}


@router.patch("/leads/{lead_id}/stage")
def update_stage(lead_id: uuid.UUID, payload: LeadStageUpdate, db: Session = Depends(get_db)):
    lead = db.get(BusinessLead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    try:
        next_stage = PipelineStage(payload.to_stage)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid pipeline stage") from exc

    update_stage_in_db(
        lead=lead,
        next_stage=next_stage,
        db=db,
        description=f"Stage changed from {lead.pipeline_stage.value} to {next_stage.value}",
    )
    return _lead_payload(lead)


@router.get("/leads/{lead_id}")
def get_lead(lead_id: uuid.UUID, db: Session = Depends(get_db)):
    lead = db.scalar(
        select(BusinessLead)
        .where(BusinessLead.id == lead_id)
        .options(
            selectinload(BusinessLead.notes),
            selectinload(BusinessLead.interactions),
            selectinload(BusinessLead.follow_up_plans),
            selectinload(BusinessLead.pipeline_events),
        )
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    return {
        **_lead_payload(lead),
        "notes": [
            _note_payload(note)
            for note in lead.notes
        ],
        "interactions": [
            {
                "id": str(item.id),
                "business_lead_id": str(item.business_lead_id),
                "channel": item.channel.value if item.channel else None,
                "direction": item.direction.value if item.direction else None,
                "summary": item.summary,
                "created_at": item.created_at,
            }
            for item in lead.interactions
        ],
        "follow_up_plans": [
            {
                "id": str(item.id),
                "business_lead_id": str(item.business_lead_id),
                "note_id": str(item.note_id) if item.note_id else None,
                "recommended_action": item.recommended_action,
                "suggested_channel": item.suggested_channel,
                "reasoning": item.reasoning,
                "status": item.status,
                "created_at": item.created_at,
            }
            for item in lead.follow_up_plans
        ],
        "events": sorted(
            [_event_payload(event) for event in lead.pipeline_events],
            key=lambda item: item["created_at"],
        ),
    }


@router.get("/leads/{lead_id}/image")
def get_lead_image(lead_id: uuid.UUID, db: Session = Depends(get_db)):
    lead = db.get(BusinessLead, lead_id)
    if not lead or not lead.image_data:
        raise HTTPException(status_code=404, detail="Image not found")
    
    import base64
    try:
        img_bytes = base64.b64decode(lead.image_data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Invalid image encoding") from exc
        
    return Response(content=img_bytes, media_type=lead.image_content_type or "image/jpeg")


@router.post("/leads/{lead_id}/notes")
def create_note(lead_id: uuid.UUID, payload: NoteCreate, db: Session = Depends(get_db)):
    lead = db.get(BusinessLead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    note = BusinessNote(
        business_lead_id=lead.id,
        content=payload.content,
        author=payload.author,
    )
    db.add(note)
    db.flush()
    db.add(
        PipelineEvent(
            business_lead_id=lead.id,
            event_type=PipelineEventType.note_added,
            from_stage=None,
            to_stage=None,
            description=f"Note added by {payload.author}",
        )
    )
    db.commit()
    db.refresh(note)

    db.refresh(lead)
    prior_notes = [existing_note.content for existing_note in lead.notes if existing_note.id != note.id]
    try:
        reclassifying = reclassify_note(
            current_stage=lead.pipeline_stage,
            new_note=payload.content,
            prior_notes=prior_notes,
            timeout_seconds=10,
        )
        requested_stage = reclassifying.get("new_stage") or lead.pipeline_stage.value
        reasoning = reclassifying.get("reasoning") or ""
        if requested_stage != lead.pipeline_stage.value:
            try:
                previous_stage = lead.pipeline_stage
                next_stage = PipelineStage(requested_stage)
                update_stage_in_db(
                    lead=lead,
                    next_stage=next_stage,
                    db=db,
                    description=f"Stage changed by reclassification agent from {previous_stage.value} to {next_stage.value}",
                )
                db.add(
                    PipelineEvent(
                        business_lead_id=lead.id,
                        event_type=PipelineEventType.follow_up_generated,
                        from_stage=previous_stage,
                        to_stage=next_stage,
                        description=reasoning or "Reclassification agent changed the stage.",
                    )
                )
                db.commit()
            except ValueError:
                logger.warning(
                    "Reclassification agent returned invalid stage '%s' for lead %s.",
                    requested_stage,
                    lead.id,
                )
                db.add(
                    PipelineEvent(
                        business_lead_id=lead.id,
                        event_type=PipelineEventType.follow_up_generated,
                        from_stage=lead.pipeline_stage,
                        to_stage=lead.pipeline_stage,
                        description=f"Reclassification agent returned invalid stage '{requested_stage}': {reasoning or 'no reasoning'}",
                    )
                )
                db.commit()
        else:
            db.add(
                PipelineEvent(
                    business_lead_id=lead.id,
                    event_type=PipelineEventType.follow_up_generated,
                    from_stage=lead.pipeline_stage,
                    to_stage=lead.pipeline_stage,
                    description=reasoning or "Reclassification agent kept the stage unchanged.",
                )
            )
            db.commit()
    except Exception as exc:
        logger.exception("Reclassification processing failed for lead %s", lead.id)
        db.add(
            PipelineEvent(
                business_lead_id=lead.id,
                event_type=PipelineEventType.follow_up_generated,
                from_stage=lead.pipeline_stage,
                to_stage=lead.pipeline_stage,
                description=f"Reclassification agent failed: {exc.__class__.__name__}",
            )
        )
        db.commit()

    db.refresh(lead)
    try:
        follow_up = plan_follow_up(
            business_name=lead.business_name,
            current_stage=lead.pipeline_stage,
            note_content=payload.content,
            timeout_seconds=10,
        )
        if follow_up:
            db.add(
                FollowUpPlan(
                    business_lead_id=lead.id,
                    note_id=note.id,
                    recommended_action=follow_up["recommended_action"],
                    suggested_channel=follow_up["suggested_channel"],
                    reasoning=follow_up["reasoning"],
                )
            )
            db.add(
                PipelineEvent(
                    business_lead_id=lead.id,
                    event_type=PipelineEventType.follow_up_generated,
                    from_stage=lead.pipeline_stage,
                    to_stage=lead.pipeline_stage,
                    description=(
                        f"{follow_up['reasoning']} Recommended action: {follow_up['recommended_action']} "
                        f"via {follow_up['suggested_channel']}."
                    ),
                )
            )
            db.commit()
    except Exception:
        logger.exception("Follow-up planning failed for lead %s", lead.id)

    # Re-fetch lead with all relationships so the frontend gets the full updated
    # state (new stage, follow-up plans, events) in a single round-trip.
    lead = db.scalar(
        select(BusinessLead)
        .where(BusinessLead.id == lead.id)
        .options(
            selectinload(BusinessLead.notes),
            selectinload(BusinessLead.interactions),
            selectinload(BusinessLead.follow_up_plans),
            selectinload(BusinessLead.pipeline_events),
        )
    )
    return {
        **_lead_payload(lead),
        "notes": [_note_payload(n) for n in lead.notes],
        "interactions": [
            {
                "id": str(item.id),
                "business_lead_id": str(item.business_lead_id),
                "channel": item.channel.value if item.channel else None,
                "direction": item.direction.value if item.direction else None,
                "summary": item.summary,
                "created_at": item.created_at,
            }
            for item in lead.interactions
        ],
        "follow_up_plans": [
            {
                "id": str(item.id),
                "business_lead_id": str(item.business_lead_id),
                "note_id": str(item.note_id) if item.note_id else None,
                "recommended_action": item.recommended_action,
                "suggested_channel": item.suggested_channel,
                "reasoning": item.reasoning,
                "status": item.status,
                "created_at": item.created_at,
            }
            for item in lead.follow_up_plans
        ],
        "events": sorted(
            [_event_payload(event) for event in lead.pipeline_events],
            key=lambda item: item["created_at"],
        ),
    }


@router.post("/leads/{lead_id}/enrich")
def enrich_lead_contacts(lead_id: uuid.UUID, db: Session = Depends(get_db)):
    lead = db.get(BusinessLead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    enriched = enrich_business_website(lead.website, lead.business_name)
    for field in ("owner_name", "manager_name", "contact_email", "contact_linkedin"):
        value = enriched.get(field)
        if value:
            setattr(lead, field, value)

    db.add(
        PipelineEvent(
            business_lead_id=lead.id,
            event_type=PipelineEventType.note_added,
            from_stage=None,
            to_stage=None,
            description="Contact details enriched from website.",
        )
    )
    db.commit()
    db.refresh(lead)
    return {**_lead_payload(lead), "enrichment": enriched}


class FollowUpApproveRequest(BaseModel):
    send: bool = True


@router.post("/leads/{lead_id}/follow-up-plans/{plan_id}/approve")
def approve_follow_up_plan(
    lead_id: uuid.UUID,
    plan_id: uuid.UUID,
    payload: FollowUpApproveRequest,
    db: Session = Depends(get_db),
):
    lead = db.scalar(
        select(BusinessLead)
        .where(BusinessLead.id == lead_id)
        .options(selectinload(BusinessLead.follow_up_plans))
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    plan = next((item for item in lead.follow_up_plans if item.id == plan_id), None)
    if not plan:
        raise HTTPException(status_code=404, detail="Follow-up plan not found")
    if plan.status == "approved":
        return {"lead_id": str(lead.id), "plan_id": str(plan.id), "status": plan.status}

    delivery: list[dict] = []
    if payload.send:
        channel = str(plan.suggested_channel or "email").strip().lower()
        channels = ["email", "sms"] if channel in {"both", "email+sms", "email and sms"} else (
            ["sms"] if channel in {"sms", "text", "phone"} else ["email"]
        )
        try:
            delivery = dispatch_outreach(
                channels=channels,
                to_email=lead.contact_email,
                to_phone=lead.phone,
                subject=f"Follow-up: {lead.business_name}",
                body=plan.recommended_action,
            )
        except OutreachSendError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        interaction_channel = InteractionChannel.email if "email" in channels else InteractionChannel.phone
        db.add(
            BusinessInteraction(
                business_lead_id=lead.id,
                channel=interaction_channel,
                direction=InteractionDirection.outbound,
                summary=plan.recommended_action[:500],
            )
        )

    plan.status = "approved"
    db.add(
        PipelineEvent(
            business_lead_id=lead.id,
            event_type=PipelineEventType.follow_up_generated,
            from_stage=lead.pipeline_stage,
            to_stage=lead.pipeline_stage,
            description=f"Follow-up plan approved{' and sent' if payload.send else ''}: {plan.recommended_action[:120]}",
        )
    )
    db.commit()
    db.refresh(plan)
    return {
        "lead_id": str(lead.id),
        "plan_id": str(plan.id),
        "status": plan.status,
        "delivery": delivery,
    }
