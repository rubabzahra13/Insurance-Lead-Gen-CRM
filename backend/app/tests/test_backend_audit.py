from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.avatar12 import AvatarLead, AvatarType, FunnelEvent, FunnelEventType, LeadDraft
from app.models.base import Base
from app.models.business import BusinessLead, PipelineStage
from app.services.classification import classify_search_query
from app.services.dashboard import get_dashboard_kpis, get_recruitment_funnel


def _make_session():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)()


def test_classify_search_uses_fallback_on_llm_failure():
    def fake_generate_structured(**kwargs):
        raise RuntimeError("Claude unavailable")

    result = classify_search_query("Roofing companies in Dallas", client_call=fake_generate_structured)
    assert result["avatar_type"] == "avatar3"
    assert result["query"] == "Roofing companies in Dallas"


def test_dashboard_kpis_and_funnel_aggregate():
    db = _make_session()

    avatar_lead = AvatarLead(
        avatar_type=AvatarType.avatar1,
        name="Jane Doe",
        headline="Open to work",
        role="Sales Manager",
        company="Acme Insurance",
        location="Dallas, TX",
    )
    business_lead = BusinessLead(
        business_name="Test Business LLC",
        pipeline_stage=PipelineStage.warm,
    )
    db.add_all([avatar_lead, business_lead])
    db.flush()
    db.add(
        LeadDraft(
            avatar12_lead_id=avatar_lead.id,
            status="sent",
            message="Hello",
            reasoning="Reason",
        )
    )
    db.add(
        FunnelEvent(
            avatar12_lead_id=avatar_lead.id,
            event_type=FunnelEventType.link_clicked,
            payload='{"source":"email"}',
            created_at=datetime.now(timezone.utc),
        )
    )
    db.add(
        FunnelEvent(
            avatar12_lead_id=avatar_lead.id,
            event_type=FunnelEventType.form_submitted,
            payload='{"city":"Dallas"}',
            created_at=datetime.now(timezone.utc),
        )
    )
    db.commit()

    kpis = get_dashboard_kpis(db)
    funnel = get_recruitment_funnel(db, days=7)

    assert kpis == {
        "leads_sourced": 1,
        "messages_sent": 1,
        "meetings_booked": 0,
        "active_pipeline_count": 1,
    }
    assert funnel["items"][0]["name"] == "Jane Doe"
    assert funnel["items"][0]["link_clicked"] == 1
    assert funnel["items"][0]["form_submitted"] == 1
    assert len(funnel["chart"]) == 7
