from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
import json
import logging
import os
import uuid
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.models.avatar12 import AvatarLead, AvatarType, FunnelEvent, FunnelEventType, LeadDraft
from app.services.llm.client import LLMResponseError, generate_structured


logger = logging.getLogger(__name__)


def _avatar_prompt(avatar_type: AvatarType) -> str:
    if avatar_type == AvatarType.avatar1:
        return (
            "You write personalized outreach emails for Avatar 1 leads: open-to-work insurance or sales professionals.\n"
            "Write the message as a real short outreach email:\n"
            "- Open with 'Hi {first_name},' using the lead's REAL first name (parsed from their full name), never a placeholder like {{first_name}}.\n"
            "- Write 2-4 sentences of genuinely personalized body text that references the lead's actual profile data "
            "(their role, company, headline, location, background). Do not use generic filler.\n"
            "- Include the landing page link provided in the context naturally in the body, e.g. inviting them to "
            "learn more or book a quick call via the link. The link must appear as a full URL on its own line so it's clearly visible.\n"
            "- End with a clear, natural sign-off (e.g. 'Best regards,' or 'Looking forward to connecting,' followed by a name like 'Peter' or 'The InsureLead Team').\n"
            "- Keep the tone warm, human, and direct. This is the entire message body — not a subject line.\n"
            "Return only a single JSON object with exactly two string keys: draft_message and reasoning."
        )

    return (
        "You write personalized outreach emails for Avatar 2 leads: upgraders at smaller insurance firms who want a bigger team.\n"
        "Write the message as a real short outreach email:\n"
        "- Open with 'Hi {first_name},' using the lead's REAL first name (parsed from their full name), never a placeholder like {{first_name}}.\n"
        "- Write 2-4 sentences of genuinely personalized body text that references the lead's current role, company, "
        "and background, framing the opportunity as a step up for someone seeking more scale, support, or growth.\n"
        "- Include the landing page link provided in the context naturally in the body, e.g. inviting them to "
        "learn more or book a quick call via the link. The link must appear as a full URL on its own line so it's clearly visible.\n"
        "- End with a clear, natural sign-off (e.g. 'Best regards,' or 'Looking forward to connecting,' followed by a name like 'Peter' or 'The InsureLead Team').\n"
        "- Keep the tone warm, human, and direct. This is the entire message body — not a subject line.\n"
        "Return only a single JSON object with exactly two string keys: draft_message and reasoning."
    )


def _schema() -> dict[str, Any]:
    return {
        "draft_message": "string",
        "reasoning": "string",
    }


def _lead_prompt_context(
    *,
    avatar_type: AvatarType,
    name: str,
    headline: str | None,
    role: str | None,
    company: str | None,
    past_experience: str | None,
    location: str | None,
    landing_page_url: str | None = None,
) -> str:
    first_name = name.split()[0] if name else "there"
    return (
        f"Avatar type: {avatar_type.value}\n"
        f"Full Name: {name}\n"
        f"First Name (use this for the greeting): {first_name}\n"
        f"Headline: {headline or ''}\n"
        f"Role: {role or ''}\n"
        f"Company: {company or ''}\n"
        f"Location: {location or ''}\n"
        f"Past experience: {past_experience or ''}\n"
        f"Landing page URL to include in the email body: {landing_page_url or 'N/A'}\n"
        "Write the outreach draft email and explain your reasoning.\n"
        "The greeting MUST use the lead's real first name, not a placeholder.\n"
        "The landing page URL MUST appear in the draft as a full clickable URL.\n"
        "The draft should sound different for Avatar 1 versus Avatar 2, and should clearly reflect the lead's background.\n"
        "Do not include markdown, code fences, or any text outside the JSON object."
    )


def generate_avatar_draft(
    *,
    avatar_type: AvatarType,
    name: str,
    headline: str | None,
    role: str | None,
    company: str | None,
    past_experience: str | None,
    location: str | None,
    lead_id: str | None = None,
    timeout_seconds: int = 60,
    client_call=generate_structured,
) -> dict[str, str] | None:
    # Build landing page URL from env
    frontend_base = os.getenv("PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")
    landing_page_url = f"{frontend_base}/landing-page/{lead_id}" if lead_id else None

    prompt_context = _lead_prompt_context(
        avatar_type=avatar_type,
        name=name,
        headline=headline,
        role=role,
        company=company,
        past_experience=past_experience,
        location=location,
        landing_page_url=landing_page_url,
    )

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            client_call,
            system_prompt=_avatar_prompt(avatar_type),
            user_prompt=prompt_context,
            response_schema=_schema(),
        )
        try:
            result = future.result(timeout=timeout_seconds)
        except FuturesTimeoutError:
            logger.warning("Avatar draft generator timed out after %s seconds.", timeout_seconds)
            return None
        except LLMResponseError as exc:
            logger.warning("Avatar draft generator failed: %s", exc)
            return None
        except Exception as exc:
            logger.warning("Avatar draft generator failed: %s", exc)
            return None

    draft_message = str(result.get("draft_message") or "").strip()
    reasoning = str(result.get("reasoning") or "").strip()
    if not draft_message:
        logger.warning("Avatar draft generator returned an empty draft message.")
        return None
    if not reasoning:
        reasoning = "Claude generated a personalized outreach draft."
    return {"draft_message": draft_message, "reasoning": reasoning}


def persist_avatar12_lead(
    *,
    db: Session,
    avatar_type: AvatarType,
    name: str,
    headline: str | None,
    role: str | None,
    company: str | None,
    past_experience: str | None,
    location: str | None,
    linkedin_url: str | None,
    search_prompt: str | None = None,
    source_snapshot: str | None = None,
    source_query: str | None = None,
    timeout_seconds: int = 60,
    client_call=generate_structured,
) -> dict[str, Any]:
    existing = None
    if linkedin_url:
        existing = db.scalar(
            select(AvatarLead).where(AvatarLead.linkedin_url == linkedin_url, AvatarLead.avatar_type == avatar_type)
        )
    if not existing:
        existing = db.scalar(
            select(AvatarLead).where(
                AvatarLead.avatar_type == avatar_type,
                AvatarLead.name == name,
                AvatarLead.company == company,
            )
        )

    if existing:
        lead = existing
        lead.headline = headline
        lead.role = role
        lead.company = company
        lead.past_experience = past_experience
        lead.location = location
        lead.search_prompt = search_prompt
        lead.source_snapshot = source_snapshot
        if source_query is not None:
            lead.source_query = source_query
    else:
        lead = AvatarLead(
            avatar_type=avatar_type,
            name=name,
            headline=headline,
            role=role,
            company=company,
            past_experience=past_experience,
            location=location,
            linkedin_url=linkedin_url,
            search_prompt=search_prompt,
            source_snapshot=source_snapshot,
            source_query=source_query or search_prompt,
        )
        db.add(lead)
        db.flush()

    draft = generate_avatar_draft(
        avatar_type=avatar_type,
        name=lead.name,
        headline=lead.headline,
        role=lead.role,
        company=lead.company,
        past_experience=lead.past_experience,
        location=lead.location,
        lead_id=str(lead.id),
        timeout_seconds=timeout_seconds,
        client_call=client_call,
    )
    if draft and not lead.drafts:
        db.add(
            LeadDraft(
                avatar12_lead_id=lead.id,
                status="draft",
                message=draft["draft_message"],
                reasoning=draft["reasoning"],
            )
        )
    db.commit()
    db.refresh(lead)
    return {
        "id": str(lead.id),
        "avatar_type": lead.avatar_type.value,
        "name": lead.name,
        "headline": lead.headline,
        "role": lead.role,
        "company": lead.company,
        "past_experience": lead.past_experience,
        "location": lead.location,
        "linkedin_url": lead.linkedin_url,
        "draft_created": bool(draft),
    }


def _draft_payload(draft: LeadDraft) -> dict[str, Any]:
    return {
        "id": str(draft.id),
        "avatar12_lead_id": str(draft.avatar12_lead_id),
        "status": draft.status,
        "message": draft.message,
        "reasoning": draft.reasoning,
        "created_at": draft.created_at,
    }


def list_avatar12_leads(*, db: Session, avatar_type: AvatarType | None = None, source_query: str | None = None) -> list[dict[str, Any]]:
    stmt = select(AvatarLead).options(selectinload(AvatarLead.drafts))
    if avatar_type is not None:
        stmt = stmt.where(AvatarLead.avatar_type == avatar_type)
    if source_query is not None:
        stmt = stmt.where(AvatarLead.source_query == source_query)
    stmt = stmt.order_by(desc(AvatarLead.created_at))
    leads = db.scalars(stmt).all()
    return [
        {
            "id": str(lead.id),
            "avatar_type": lead.avatar_type.value if lead.avatar_type else None,
            "name": lead.name,
            "headline": lead.headline,
            "role": lead.role,
            "company": lead.company,
            "past_experience": lead.past_experience,
            "location": lead.location,
        "linkedin_url": lead.linkedin_url,
        "contact_email": lead.contact_email,
        "contact_phone": lead.contact_phone,
        "search_prompt": lead.search_prompt,
            "source_snapshot": lead.source_snapshot,
            "source_query": lead.source_query,
            "created_at": lead.created_at,
            "updated_at": lead.updated_at,
            "draft_count": len(lead.drafts),
            "latest_draft": _draft_payload(sorted(lead.drafts, key=lambda item: item.created_at)[-1]) if lead.drafts else None,
        }
        for lead in leads
    ]


def latest_avatar12_draft(*, db: Session, lead_id: uuid.UUID) -> LeadDraft | None:
    lead = db.scalar(select(AvatarLead).where(AvatarLead.id == lead_id).options(selectinload(AvatarLead.drafts)))
    if not lead or not lead.drafts:
        return None
    return sorted(lead.drafts, key=lambda item: item.created_at)[-1]


def mark_avatar12_draft_sent(
    *,
    db: Session,
    lead_id: uuid.UUID,
    channel: str | None = None,
    message: str | None = None,
    to_email: str | None = None,
    to_phone: str | None = None,
    channels: list[str] | None = None,
) -> dict[str, Any] | None:
    from app.services.outreach_send import OutreachSendError, dispatch_outreach

    lead = db.scalar(select(AvatarLead).where(AvatarLead.id == lead_id).options(selectinload(AvatarLead.drafts)))
    if not lead:
        return None

    if not lead.drafts:
        draft = LeadDraft(
            avatar12_lead_id=lead.id,
            status="draft",
            message=message or "",
            reasoning="Draft created from scratch by user.",
        )
        db.add(draft)
        db.flush()
    else:
        draft = sorted(lead.drafts, key=lambda item: item.created_at)[-1]
        if message is not None:
            draft.message = message

    body = (message if message is not None else draft.message or "").strip()
    if not body:
        raise OutreachSendError("Message body is empty.")

    selected_channels = channels or []
    if not selected_channels:
        normalized = (channel or "email").strip().lower()
        if normalized in {"both", "email+sms", "email_sms"}:
            selected_channels = ["email", "sms"]
        elif normalized == "sms":
            selected_channels = ["sms"]
        else:
            selected_channels = ["email"]

    email_target = (to_email or lead.contact_email or "").strip()
    phone_target = (to_phone or lead.contact_phone or "").strip()

    if email_target:
        lead.contact_email = email_target
    if phone_target:
        lead.contact_phone = phone_target

    delivery = dispatch_outreach(
        channels=selected_channels,
        to_email=email_target,
        to_phone=phone_target,
        subject=f"Opportunity for {lead.name.split()[0] if lead.name else 'you'}",
        body=body,
    )

    draft.status = "sent"
    db.commit()
    db.refresh(draft)
    db.refresh(lead)
    return {
        "lead_id": str(lead.id),
        "channel": channel or ",".join(selected_channels),
        "delivery": delivery,
        "contact_email": lead.contact_email,
        "contact_phone": lead.contact_phone,
        "draft": _draft_payload(draft),
    }


def record_avatar12_funnel_event(
    *,
    db: Session,
    lead_id: uuid.UUID,
    event_type: FunnelEventType,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    lead = db.scalar(select(AvatarLead).where(AvatarLead.id == lead_id))
    if not lead:
        return None

    event = FunnelEvent(
        avatar12_lead_id=lead.id,
        event_type=event_type,
        payload=None if payload is None else json.dumps(payload, default=str),
    )
    db.add(event)

    if event_type == FunnelEventType.form_submitted and payload:
        email = str(payload.get("email") or "").strip()
        phone = str(payload.get("phone") or "").strip()
        if email:
            lead.contact_email = email
        if phone:
            lead.contact_phone = phone

    db.commit()
    db.refresh(event)
    return {
        "id": str(event.id),
        "avatar12_lead_id": str(event.avatar12_lead_id),
        "event_type": event.event_type.value,
        "payload": event.payload,
        "created_at": event.created_at,
    }
