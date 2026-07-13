from __future__ import annotations

import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.avatar12 import AvatarLead, AvatarType, LeadDraft
from app.routes.avatar12_leads import get_lead
from app.models.base import Base
from app.services.avatar12_drafts import persist_avatar12_lead
from app.services.llm.client import LLMResponseError


def _make_session():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)()


def test_persist_avatar12_lead_skips_draft_when_llm_fails():
    db = _make_session()

    def fake_generate_structured(**kwargs):
        raise LLMResponseError("invalid JSON")

    result = persist_avatar12_lead(
        db=db,
        avatar_type=AvatarType.avatar1,
        name="Jane Doe",
        headline="Open to work",
        role="Sales Manager",
        company="Acme Insurance",
        past_experience="Former broker with B2B insurance background",
        location="Dallas, TX",
        linkedin_url="https://linkedin.com/in/jane-doe",
        search_prompt="open to work insurance sales",
        source_snapshot="{}",
        client_call=fake_generate_structured,
    )

    assert result["draft_created"] is False
    assert db.query(AvatarLead).count() == 1
    assert db.query(LeadDraft).count() == 0


def test_persist_avatar12_lead_creates_retrievable_draft():
    db = _make_session()

    def fake_generate_structured(**kwargs):
        prompt_lines = {
            line.split(": ", 1)[0]: line.split(": ", 1)[1]
            for line in kwargs["user_prompt"].splitlines()
            if ": " in line
        }
        name_val = prompt_lines.get('Full Name') or prompt_lines.get('Name')
        return {
            "draft_message": (
                f"Hi {name_val}, I saw your {prompt_lines['Headline'].lower()} note and "
                f"your background in {prompt_lines['Role'].lower()} at {prompt_lines['Company']}. "
                "We have a role that fits that mix."
            ),
            "reasoning": "Used the lead's name, role, company, and open-to-work signal.",
        }

    result = persist_avatar12_lead(
        db=db,
        avatar_type=AvatarType.avatar1,
        name="Jane Doe",
        headline="Open to work",
        role="Sales Manager",
        company="Acme Insurance",
        past_experience="Former broker with B2B insurance background",
        location="Dallas, TX",
        linkedin_url="https://linkedin.com/in/jane-doe",
        search_prompt="open to work insurance sales",
        source_snapshot="{}",
        client_call=fake_generate_structured,
    )

    lead_id = result["id"]
    assert result["draft_created"] is True
    assert db.query(AvatarLead).count() == 1
    assert db.query(LeadDraft).count() == 1

    detail_body = get_lead(uuid.UUID(lead_id), db=db)
    assert detail_body["name"] == "Jane Doe"
    assert len(detail_body["drafts"]) == 1
    assert detail_body["drafts"][0]["status"] == "draft"
    assert "open to work" in detail_body["drafts"][0]["message"].lower()
