from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

pytest.skip("Supabase integration coverage is exercised manually via live verification.", allow_module_level=True)

from app.routes.avatar3_leads import (
    LeadCreate,
    LeadStageUpdate,
    NoteCreate,
    create_lead,
    create_note,
    get_lead,
    update_stage,
)
from app.session import SessionLocal


def test_duplicate_detection_and_event_logging():
    place_id = f"test-{uuid.uuid4()}"

    with SessionLocal() as db:
        first_body = create_lead(
            LeadCreate(
                business_name="Test Lead LLC",
                google_place_id=place_id,
                pipeline_stage="new",
            ),
            db=db,
        )
        assert first_body["duplicate"] is False
        assert first_body["pipeline_stage"] == "new"

    with SessionLocal() as db:
        second_body = create_lead(
            LeadCreate(
                business_name="Test Lead LLC 2",
                google_place_id=place_id,
                pipeline_stage="qualified",
            ),
            db=db,
        )
        assert second_body["duplicate"] is True
        assert second_body["id"] == first_body["id"]
        assert second_body["pipeline_stage"] == "new"

    with SessionLocal() as db:
        stage_body = update_stage(
            uuid.UUID(first_body["id"]),
            LeadStageUpdate(to_stage="qualified"),
            db=db,
        )
        assert stage_body["pipeline_stage"] == "qualified"

    with SessionLocal() as db:
        detail_body = get_lead(uuid.UUID(first_body["id"]), db=db)
        assert detail_body["pipeline_stage"] == "qualified"
        assert detail_body["events"][0]["event_type"] == "stage_change"
        assert detail_body["events"][0]["from_stage"] is None
        assert detail_body["events"][0]["to_stage"] == "new"
        assert detail_body["events"][1]["from_stage"] == "new"
        assert detail_body["events"][1]["to_stage"] == "qualified"


def test_note_creation_and_validation(monkeypatch):
    def fake_reclassify_note(**kwargs):
        return {"new_stage": kwargs["current_stage"].value, "reasoning": "Kept unchanged."}

    monkeypatch.setattr("app.routes.avatar3_leads.reclassify_note", fake_reclassify_note)

    def fake_plan_follow_up(**kwargs):
        return {
            "recommended_action": "Send a short email.",
            "suggested_channel": "email",
            "reasoning": "The lead is responsive.",
        }

    monkeypatch.setattr("app.routes.avatar3_leads.plan_follow_up", fake_plan_follow_up)

    place_id = f"note-{uuid.uuid4()}"

    with SessionLocal() as db:
        lead = create_lead(
            LeadCreate(
                business_name="Note Lead LLC",
                google_place_id=place_id,
            ),
            db=db,
        )

    with SessionLocal() as db:
        note_body = create_note(
            uuid.UUID(lead["id"]),
            NoteCreate(content="Call after 2pm tomorrow", author="Agent"),
            db=db,
        )
        assert note_body["content"] == "Call after 2pm tomorrow"
        assert note_body["author"] == "Agent"

    with SessionLocal() as db:
        detail_body = get_lead(uuid.UUID(lead["id"]), db=db)
        assert detail_body["notes"][0]["content"] == "Call after 2pm tomorrow"
        assert detail_body["events"][1]["event_type"] == "note_added"
        assert detail_body["events"][-1]["event_type"] == "follow_up_generated"

    with pytest.raises(ValidationError):
        NoteCreate(content="", author="Agent")
