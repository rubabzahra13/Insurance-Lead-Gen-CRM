from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.models.avatar12 import AvatarLead, AvatarType, FunnelEvent, FunnelEventType, LeadDraft
from app.public_url import public_app_base_url, rewrite_local_landing_urls


logger = logging.getLogger(__name__)

# Stable demo lead for local funnel testing (do not randomly regenerate).
FUNNEL_TEST_LEAD_ID = uuid.UUID("f11e1000-0000-4000-8000-000000000001")
FUNNEL_TEST_EMAIL = "rubabzahra248@gmail.com"


def ensure_funnel_test_lead(*, db: Session) -> dict[str, Any]:
    """Idempotently seed a draft Job Seeker lead for end-to-end funnel testing."""
    landing_page_url = f"{public_app_base_url()}/landing-page/{FUNNEL_TEST_LEAD_ID}"

    lead = db.scalar(
        select(AvatarLead)
        .where(AvatarLead.id == FUNNEL_TEST_LEAD_ID)
        .options(selectinload(AvatarLead.drafts))
    )

    if lead is None:
        lead = AvatarLead(
            id=FUNNEL_TEST_LEAD_ID,
            avatar_type=AvatarType.avatar1,
            name="Rubab Zahra",
            headline="Funnel Test, Insurance Sales Professional",
            role="Insurance Sales Representative",
            company="InsureLead Demo",
            past_experience="Hardcoded test lead for intake funnel verification.",
            location="Islamabad, Pakistan",
            linkedin_url=None,
            contact_email=FUNNEL_TEST_EMAIL,
            search_prompt="funnel test lead",
            source_snapshot="Hardcoded funnel test fixture",
            source_query="funnel test lead",
        )
        db.add(lead)
        db.flush()
    else:
        lead.avatar_type = AvatarType.avatar1
        lead.name = "Rubab Zahra"
        lead.headline = "Funnel Test, Insurance Sales Professional"
        lead.role = "Insurance Sales Representative"
        lead.company = "InsureLead Demo"
        lead.past_experience = "Hardcoded test lead for intake funnel verification."
        lead.location = "Islamabad, Pakistan"
        lead.contact_email = FUNNEL_TEST_EMAIL
        lead.source_query = "funnel test lead"
        lead.search_prompt = "funnel test lead"

    draft_message = (
        "Hi Rubab,\n\n"
        "This is a test outreach draft so you can verify the tracked intake funnel end to end. "
        "Open the link below, fill the form, and book a meeting when you're ready.\n\n"
        f"{landing_page_url}\n\n"
        "Best regards,\n"
        "Peter"
    )
    draft_reasoning = (
        "Hardcoded Job Seeker test fixture with contact email "
        f"{FUNNEL_TEST_EMAIL} for manual funnel QA. Do not treat as a real prospect."
    )

    drafts = list(lead.drafts or [])
    latest = sorted(drafts, key=lambda item: item.created_at)[-1] if drafts else None

    if latest is None:
        db.add(
            LeadDraft(
                avatar12_lead_id=lead.id,
                status="draft",
                message=draft_message,
                reasoning=draft_reasoning,
            )
        )
    elif latest.status != "sent":
        # Keep the lead sendable for testing; refresh message/link if still a draft.
        latest.message = draft_message
        latest.reasoning = draft_reasoning
        latest.status = "draft"

    db.commit()
    db.refresh(lead)
    return {
        "id": str(lead.id),
        "name": lead.name,
        "contact_email": lead.contact_email,
        "landing_page_url": landing_page_url,
        "status": "draft" if latest is None or latest.status != "sent" else latest.status,
    }


def _avatar_prompt(avatar_type: AvatarType) -> str:
    if avatar_type == AvatarType.avatar1:
        return (
            "You write personalized outreach emails for job seekers: open-to-work insurance or sales professionals.\n"
            "Write the message as a real short outreach email:\n"
            "- Open with 'Hi {first_name},' using the lead's REAL first name (parsed from their full name), never a placeholder like {{first_name}}.\n"
            "- Write 2-4 sentences of genuinely personalized body text that references the lead's actual profile data "
            "(their role, company, headline, location, background). Do not use generic filler.\n"
            "- Clearly invite them to book a meeting. The provided link is their meeting booking page. "
            "Say that in plain language (for example: book a meeting with the link below). "
            "Put the full URL on its own line so it is clearly visible.\n"
            "- End with a clear, natural sign-off (e.g. 'Best regards,' or 'Looking forward to connecting,' followed by a name like 'Peter' or 'The InsureLead Team').\n"
            "- Keep the tone warm, human, and direct. This is the entire message body, not a subject line.\n"
            "- Never use the word avatar, Avatar 1, or Avatar 2 in the draft or reasoning.\n"
            "Return only a single JSON object with exactly two string keys: draft_message and reasoning.\n"
            "For reasoning, summarize what we learned about this person from their profile (background, role, and why they fit as a job seeker). "
            "Use plain sentences. Do not use em dashes."
        )

    return (
        "You write personalized outreach emails for job upgraders: working professionals changing jobs for better opportunities.\n"
        "Write the message as a real short outreach email:\n"
        "- Open with 'Hi {first_name},' using the lead's REAL first name (parsed from their full name), never a placeholder like {{first_name}}.\n"
        "- Write 2-4 sentences of genuinely personalized body text that references the lead's current role, company, "
        "and background, framing the opportunity as a better next role for someone open to a career move.\n"
        "- Clearly invite them to book a meeting. The provided link is their meeting booking page. "
        "Say that in plain language (for example: book a meeting with the link below). "
        "Put the full URL on its own line so it is clearly visible.\n"
        "- End with a clear, natural sign-off (e.g. 'Best regards,' or 'Looking forward to connecting,' followed by a name like 'Peter' or 'The InsureLead Team').\n"
        "- Keep the tone warm, human, and direct. This is the entire message body, not a subject line.\n"
        "- Never use the word avatar, Avatar 1, or Avatar 2 in the draft or reasoning.\n"
        "- Do not mention growing teams, bigger teams, or building a team.\n"
        "Return only a single JSON object with exactly two string keys: draft_message and reasoning.\n"
        "For reasoning, summarize what we learned about this person from their profile (background, role, and why they fit as a job upgrader). "
        "Use plain sentences. Do not use em dashes."
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
    segment_label = "job seeker" if avatar_type == AvatarType.avatar1 else "job upgrader"
    return (
        f"Lead segment: {segment_label}\n"
        f"Full Name: {name}\n"
        f"First Name (use this for the greeting): {first_name}\n"
        f"Headline: {headline or ''}\n"
        f"Role: {role or ''}\n"
        f"Company: {company or ''}\n"
        f"Location: {location or ''}\n"
        f"Past experience: {past_experience or ''}\n"
        f"Meeting booking URL to include in the email body: {landing_page_url or 'N/A'}\n"
        "Write the outreach draft email and explain what we learned about this person from their profile.\n"
        "The greeting MUST use the lead's real first name, not a placeholder.\n"
        "Invite them to book a meeting. The URL is specifically for booking a meeting.\n"
        "The meeting booking URL MUST appear in the draft as a full clickable URL on its own line.\n"
        "The draft should sound different for job seekers versus job upgraders, and should clearly reflect the lead's background.\n"
        "Never use the word avatar.\n"
        "Do not include markdown, code fences, or any text outside the JSON object."
    )


def _template_avatar_draft(
    *,
    avatar_type: AvatarType,
    name: str,
    headline: str | None,
    role: str | None,
    company: str | None,
    location: str | None,
    lead_id: str | None = None,
) -> dict[str, str]:
    """Always-available draft when OpenAI cannot generate one."""
    first_name = (name or "there").split()[0]
    landing = f"{public_app_base_url()}/landing-page/{lead_id}" if lead_id else public_app_base_url()
    role_bit = role or headline or "your background"
    company_bit = f" at {company}" if company else ""
    location_bit = f" in {location}" if location else ""
    if avatar_type == AvatarType.avatar1:
        body = (
            f"Hi {first_name},\n\n"
            f"I came across your profile and noticed your work as {role_bit}{company_bit}{location_bit}. "
            "We're connecting with early-career talent who may be exploring stronger insurance or sales opportunities.\n\n"
            f"If you're open to it, book a meeting with this link:\n{landing}\n\n"
            "Best regards,\nThe InsureLead Team"
        )
        reasoning = (
            f"Template draft for a job seeker. Role: {role_bit}. "
            "OpenAI was unavailable, so a ready-to-edit message was created instead."
        )
    else:
        body = (
            f"Hi {first_name},\n\n"
            f"I saw your experience as {role_bit}{company_bit}{location_bit} and thought you might be "
            "open to a better next role and stronger opportunities.\n\n"
            f"Book a meeting with this link if you'd like to talk it through:\n{landing}\n\n"
            "Best regards,\nThe InsureLead Team"
        )
        reasoning = (
            f"Template draft for a job upgrader. Role: {role_bit}. "
            "OpenAI was unavailable, so a ready-to-edit message was created instead."
        )
    return {
        "draft_message": rewrite_local_landing_urls(body),
        "reasoning": reasoning,
    }


def _generate_avatar_draft_openai(
    *,
    system_prompt: str,
    user_prompt: str,
    timeout_seconds: int = 45,
) -> dict[str, str] | None:
    """Generate outreach draft JSON via OpenAI."""
    api_key = (os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_KEY") or "").strip()
    if not api_key:
        return None
    model = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()
    try:
        import urllib.request

        body = json.dumps(
            {
                "model": model,
                "temperature": 0,
                "messages": [
                    {
                        "role": "system",
                        "content": system_prompt
                        + "\nReturn only valid JSON with keys draft_message and reasoning.",
                    },
                    {"role": "user", "content": user_prompt},
                ],
            }
        ).encode()
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout_seconds) as res:
            payload = json.loads(res.read().decode())
        text = (
            payload.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:].strip()
        parsed = json.loads(text)
        draft_message = rewrite_local_landing_urls(str(parsed.get("draft_message") or "").strip())
        reasoning = str(parsed.get("reasoning") or "").strip()
        if not draft_message:
            return None
        if not reasoning:
            reasoning = "OpenAI generated a personalized outreach draft."
        return {"draft_message": draft_message, "reasoning": reasoning}
    except Exception as exc:
        logger.warning("OpenAI draft generation failed: %s", exc)
        return None


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
    openai_call=_generate_avatar_draft_openai,
) -> dict[str, str]:
    landing_page_url = f"{public_app_base_url()}/landing-page/{lead_id}" if lead_id else None

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

    draft = openai_call(
        system_prompt=_avatar_prompt(avatar_type),
        user_prompt=prompt_context,
        timeout_seconds=min(45, timeout_seconds),
    )
    if draft:
        return draft

    return _template_avatar_draft(
        avatar_type=avatar_type,
        name=name,
        headline=headline,
        role=role,
        company=company,
        location=location,
        lead_id=lead_id,
    )


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
    school: str | None = None,
    contact_email: str | None = None,
    contact_phone: str | None = None,
    search_prompt: str | None = None,
    source_snapshot: str | None = None,
    source_query: str | None = None,
    fit_evidence: str | None = None,
    fit_source: str | None = None,
    timeout_seconds: int = 60,
    openai_call=_generate_avatar_draft_openai,
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

    def _fill_blank(target: AvatarLead, field: str, value: str | None) -> None:
        if not value or not str(value).strip():
            return
        current = getattr(target, field, None)
        if current and str(current).strip():
            return
        setattr(target, field, str(value).strip())

    if existing:
        lead = existing
        lead.headline = headline
        lead.role = role
        lead.company = company
        lead.school = school
        lead.past_experience = past_experience
        lead.location = location
        lead.search_prompt = search_prompt
        lead.source_snapshot = source_snapshot
        if source_query is not None:
            lead.source_query = source_query
        if fit_evidence is not None:
            lead.fit_evidence = fit_evidence
            lead.fit_source = fit_source
        _fill_blank(lead, "contact_email", contact_email)
        _fill_blank(lead, "contact_phone", contact_phone)
    else:
        lead = AvatarLead(
            avatar_type=avatar_type,
            name=name,
            headline=headline,
            role=role,
            company=company,
            school=school,
            past_experience=past_experience,
            location=location,
            linkedin_url=linkedin_url,
            contact_email=(contact_email or "").strip() or None,
            contact_phone=(contact_phone or "").strip() or None,
            search_prompt=search_prompt,
            source_snapshot=source_snapshot,
            source_query=source_query or search_prompt,
            fit_evidence=fit_evidence,
            fit_source=fit_source,
        )
        db.add(lead)
        db.flush()

    # Snapshot everything the draft generator and return payload need, then
    # COMMIT before the LLM call. Holding the transaction open through a slow
    # network call leaves the pooled connection "idle in transaction", which
    # blocks other queries and schema changes.
    snapshot = {
        "id": str(lead.id),
        "avatar_type": lead.avatar_type.value,
        "name": lead.name,
        "headline": lead.headline,
        "role": lead.role,
        "company": lead.company,
        "past_experience": lead.past_experience,
        "location": lead.location,
        "linkedin_url": lead.linkedin_url,
    }
    lead_uuid = lead.id
    had_drafts = bool(lead.drafts)
    db.commit()

    draft = generate_avatar_draft(
        avatar_type=avatar_type,
        name=snapshot["name"],
        headline=snapshot["headline"],
        role=snapshot["role"],
        company=snapshot["company"],
        past_experience=snapshot["past_experience"],
        location=snapshot["location"],
        lead_id=snapshot["id"],
        timeout_seconds=timeout_seconds,
        openai_call=openai_call,
    )
    # generate_avatar_draft always returns a draft (OpenAI → template).
    if draft and not had_drafts:
        db.add(
            LeadDraft(
                avatar12_lead_id=lead_uuid,
                status="draft",
                message=draft["draft_message"],
                reasoning=draft["reasoning"],
            )
        )
        db.commit()
    return {
        **snapshot,
        "draft_created": bool(draft) and not had_drafts,
    }


def _draft_payload(draft: LeadDraft) -> dict[str, Any]:
    return {
        "id": str(draft.id),
        "avatar12_lead_id": str(draft.avatar12_lead_id),
        "status": draft.status,
        "message": rewrite_local_landing_urls(draft.message),
        "reasoning": draft.reasoning,
        "created_at": draft.created_at,
        "sent_at": draft.sent_at,
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


def update_avatar12_draft(
    *,
    db: Session,
    lead_id: uuid.UUID,
    message: str,
) -> dict[str, Any] | None:
    lead = db.scalar(
        select(AvatarLead).where(AvatarLead.id == lead_id).options(selectinload(AvatarLead.drafts))
    )
    if not lead:
        return None

    body = rewrite_local_landing_urls((message or "").strip())
    if not lead.drafts:
        draft = LeadDraft(
            avatar12_lead_id=lead.id,
            status="draft",
            message=body,
            reasoning="Draft created by user.",
        )
        db.add(draft)
    else:
        draft = sorted(lead.drafts, key=lambda item: item.created_at)[-1]
        if draft.status == "sent":
            raise ValueError("Cannot edit a draft that has already been marked as sent.")
        draft.message = body

    db.commit()
    db.refresh(draft)
    return _draft_payload(draft)


def mark_avatar12_draft_sent(
    *,
    db: Session,
    lead_id: uuid.UUID,
    channel: str | None = None,
    message: str | None = None,
    to_email: str | None = None,
    to_phone: str | None = None,
    channels: list[str] | None = None,
    mark_only: bool = False,
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
            draft.message = rewrite_local_landing_urls(message)

    body = rewrite_local_landing_urls(
        (message if message is not None else draft.message or "").strip()
    )
    if not body:
        raise OutreachSendError("Message body is empty.")

    email_target = (to_email or lead.contact_email or "").strip()
    phone_target = (to_phone or lead.contact_phone or "").strip()

    if email_target:
        lead.contact_email = email_target
    if phone_target:
        lead.contact_phone = phone_target

    delivery: list[dict[str, Any]] = []
    selected_channels = channels or []

    # Commit draft/contact updates BEFORE dispatching so the transaction is not
    # held open across the network send (avoids idle-in-transaction connections).
    db.commit()

    if not mark_only:
        if not selected_channels:
            normalized = (channel or "email").strip().lower()
            if normalized in {"both", "email+sms", "email_sms"}:
                selected_channels = ["email", "sms"]
            elif normalized == "sms":
                selected_channels = ["sms"]
            else:
                selected_channels = ["email"]

        delivery = dispatch_outreach(
            channels=selected_channels,
            to_email=email_target,
            to_phone=phone_target,
            subject=f"Opportunity for {lead.name.split()[0] if lead.name else 'you'}",
            body=body,
        )

    draft.status = "sent"
    draft.sent_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(draft)
    db.refresh(lead)
    return {
        "lead_id": str(lead.id),
        "channel": "manual" if mark_only else (channel or ",".join(selected_channels)),
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
