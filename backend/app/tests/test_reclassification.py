from __future__ import annotations

from app.services.llm.client import LLMResponseError
from app.models.business import PipelineStage
from app.services.reclassification import reclassify_note


def test_reclassify_note_happy_path():
    calls = []

    def fake_generate_structured(**kwargs):
        calls.append(kwargs)
        return {"new_stage": "warm", "reasoning": "Real interest shown."}

    result = reclassify_note(
        current_stage=PipelineStage.new,
        new_note="Please call me tomorrow.",
        prior_notes=["Earlier note"],
        timeout_seconds=1,
        client_call=fake_generate_structured,
    )
    assert result["new_stage"] == "warm"
    assert result["reasoning"] == "Real interest shown."
    assert calls


def test_reclassify_note_falls_back_on_client_failure():
    def fake_generate_structured(**kwargs):
        raise LLMResponseError("invalid JSON")

    result = reclassify_note(
        current_stage=PipelineStage.new,
        new_note="Maybe later.",
        prior_notes=[],
        timeout_seconds=1,
        client_call=fake_generate_structured,
    )

    assert result["new_stage"] == PipelineStage.new.value
    assert "left unchanged" in result["reasoning"]
