"""TC-API: Match tier fields exposed on avatar12 lead API from source_snapshot."""

from __future__ import annotations

import json

from app.routes.avatar12_leads import _lead_payload, _match_fields_from_snapshot
from app.models.avatar12 import AvatarLead, AvatarType


def test_tc_api_001_match_fields_parsed_from_source_snapshot():
    snap = json.dumps(
        {
            "match_tier": "perfect",
            "match_label": "Best Match",
            "match_reason": "Junior Software Engineer matches role_synonyms",
            "confidence": 0.95,
        }
    )
    fields = _match_fields_from_snapshot(snap)
    assert fields["match_tier"] == "perfect"
    assert fields["match_label"] == "Best Match"
    assert fields["match_reason"] == "Junior Software Engineer matches role_synonyms"


def test_tc_api_002_invalid_snapshot_returns_empty_match_fields():
    assert _match_fields_from_snapshot(None) == {}
    assert _match_fields_from_snapshot("not-json") == {}
    assert _match_fields_from_snapshot(json.dumps(["array"])) == {}


def test_tc_api_003_lead_payload_includes_match_fields():
    lead = AvatarLead(
        avatar_type=AvatarType.avatar1,
        name="Jane Doe",
        source_snapshot=json.dumps(
            {"match_tier": "strong", "match_label": "Good Match", "match_reason": "Close title"}
        ),
    )
    payload = _lead_payload(lead)
    assert payload["match_tier"] == "strong"
    assert payload["match_label"] == "Good Match"
    assert payload["match_reason"] == "Close title"


def test_tc_api_004_lead_without_snapshot_has_no_match_keys():
    lead = AvatarLead(avatar_type=AvatarType.avatar2, name="No Snap")
    payload = _lead_payload(lead)
    assert "match_tier" not in payload
    assert "match_label" not in payload
