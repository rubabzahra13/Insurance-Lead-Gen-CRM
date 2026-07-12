from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.avatar12 import AvatarLead, FunnelEvent, FunnelEventType, LeadDraft
from app.models.business import BusinessLead, PipelineStage


def get_dashboard_kpis(db: Session) -> dict[str, int]:
    leads_sourced = db.scalar(select(func.count(AvatarLead.id))) or 0
    messages_sent = db.scalar(select(func.count(LeadDraft.id)).where(LeadDraft.status == "sent")) or 0
    meetings_booked = db.scalar(
        select(func.count(FunnelEvent.id)).where(FunnelEvent.event_type == FunnelEventType.meeting_booked)
    ) or 0
    active_pipeline_count = db.scalar(
        select(func.count(BusinessLead.id)).where(
            ~BusinessLead.pipeline_stage.in_([PipelineStage.sealed_won, PipelineStage.lost, PipelineStage.not_interested])
        )
    ) or 0

    return {
        "leads_sourced": int(leads_sourced),
        "messages_sent": int(messages_sent),
        "meetings_booked": int(meetings_booked),
        "active_pipeline_count": int(active_pipeline_count),
    }


def get_recruitment_funnel(db: Session, days: int = 30) -> dict:
    window_days = max(1, days)
    today = datetime.now(timezone.utc).date()
    start_date = today - timedelta(days=window_days - 1)
    cutoff = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
    events = db.scalars(select(FunnelEvent).where(FunnelEvent.created_at >= cutoff)).all()
    leads = db.scalars(select(AvatarLead)).all()
    lead_by_id = {lead.id: lead for lead in leads}

    event_types = [event_type.value for event_type in FunnelEventType]
    date_counts: dict[str, Counter[str]] = defaultdict(Counter)
    lead_counts: dict[str, Counter[str]] = defaultdict(Counter)
    latest_event: dict[str, datetime] = {}

    for event in events:
        created_at = event.created_at
        if created_at is None:
            continue
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        date_key = created_at.date().isoformat()
        event_key = event.event_type.value
        date_counts[date_key][event_key] += 1
        lead_counts[str(event.avatar12_lead_id)][event_key] += 1
        latest_event[str(event.avatar12_lead_id)] = max(latest_event.get(str(event.avatar12_lead_id), created_at), created_at)

    chart_rows = []
    for offset in range(window_days):
        day = (start_date + timedelta(days=offset)).isoformat()
        row = {"date": day}
        for event_type in event_types:
            row[event_type] = int(date_counts[day][event_type])
        chart_rows.append(row)

    table_rows = []
    for lead_id, lead in lead_by_id.items():
        counts = lead_counts.get(str(lead_id), Counter())
        table_rows.append(
            {
                "lead_id": str(lead.id),
                "name": lead.name,
                "avatar_type": lead.avatar_type.value if lead.avatar_type else None,
                "headline": lead.headline,
                "company": lead.company,
                "location": lead.location,
                "link_clicked": int(counts["link_clicked"]),
                "form_started": int(counts["form_started"]),
                "form_submitted": int(counts["form_submitted"]),
                "meeting_booked": int(counts["meeting_booked"]),
                "latest_event_at": latest_event.get(str(lead_id)),
            }
        )

    table_rows.sort(key=lambda row: (row["latest_event_at"] or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)

    return {
        "chart": chart_rows,
        "items": table_rows,
    }
