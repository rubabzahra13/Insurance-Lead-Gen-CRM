from __future__ import annotations

from app.models.business import PipelineStage
from app.services.followup_planning import plan_follow_up
from app.services.llm.client import LLMResponseError


def test_plan_follow_up_happy_path():
    calls = []

    def fake_generate_structured(**kwargs):
        calls.append(kwargs)
        return {
            "recommended_action": "Send a short email with two scheduling options.",
            "suggested_channel": "email",
            "reasoning": "The lead is responsive and deserves a concrete next step.",
        }

    result = plan_follow_up(
        business_name="Test Lead LLC",
        current_stage=PipelineStage.warm,
        note_content="Please send over the details.",
        timeout_seconds=1,
        client_call=fake_generate_structured,
    )

    assert result is not None
    assert result["recommended_action"] == "Send a short email with two scheduling options."
    assert result["suggested_channel"] == "email"
    assert result["reasoning"] == "The lead is responsive and deserves a concrete next step."
    assert calls


def test_plan_follow_up_falls_back_on_client_failure():
    def fake_generate_structured(**kwargs):
        raise LLMResponseError("invalid JSON")

    result = plan_follow_up(
        business_name="Test Lead LLC",
        current_stage=PipelineStage.new,
        note_content="Maybe later.",
        timeout_seconds=1,
        client_call=fake_generate_structured,
    )

    assert result is None
