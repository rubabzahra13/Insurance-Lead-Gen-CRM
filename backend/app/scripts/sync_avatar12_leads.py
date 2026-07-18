from __future__ import annotations

import json
import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from dotenv import load_dotenv

from app.config import _project_root
from app.models.avatar12 import AvatarType
from app.session import SessionLocal
from app.services.avatar12_drafts import persist_avatar12_lead


# Headlines like "Open to work" / "Seeking new opportunities" are job-status
# phrases, not employers or roles. Keep them as the headline but never store
# them as company/role — that would be wrong data in the CRM.
_STATUS_PHRASES = ("open to work", "opentowork", "seeking new opportunities", "looking for opportunities")


def _drop_status_phrase(value: Any) -> Any:
    if isinstance(value, str) and any(p in value.lower() for p in _STATUS_PHRASES):
        return None
    return value


WEAK_NOTE = " [found via other sources — not strong evidence]"


def _mark_weak(value: Any, field: str, weak_fields: Any) -> Any:
    """Requirement: enriched data found outside the person's own profile/post is
    stored, but labelled so nobody treats it as verified."""
    if isinstance(value, str) and isinstance(weak_fields, list) and field in weak_fields:
        return value + WEAK_NOTE
    return value


def sync_single_lead(lead: dict[str, Any]) -> dict[str, Any]:
    weak_fields = lead.get("weak_fields")
    fit_source = lead.get("fit_source")
    fit_evidence = lead.get("fit_evidence") or lead.get("evidence")
    if isinstance(fit_evidence, str) and fit_source == "other":
        fit_evidence = fit_evidence + WEAK_NOTE
    with SessionLocal() as db:
        try:
            result = persist_avatar12_lead(
                db=db,
                avatar_type=AvatarType(lead["avatar_type"]),
                name=lead["name"],
                headline=lead.get("headline") or lead.get("title"),
                role=_drop_status_phrase(lead.get("role") or lead.get("title")),
                company=_drop_status_phrase(_mark_weak(lead.get("company"), "company", weak_fields)),
                school=lead.get("school"),
                past_experience=_mark_weak(
                    lead.get("past_experience"), "past_experience", weak_fields
                ) or lead.get("snippet") or lead.get("evidence"),
                location=_mark_weak(lead.get("location"), "location", weak_fields),
                linkedin_url=lead.get("link"),
                search_prompt=lead.get("searchPrompt"),
                source_snapshot=json.dumps(lead, default=str),
                source_query=os.environ.get("SOURCE_QUERY") or lead.get("searchPrompt"),
                fit_evidence=fit_evidence,
                fit_source=fit_source,
            )
            return {"ok": True, **result}
        except Exception as exc:
            db.rollback()
            return {"ok": False, "error": exc.__class__.__name__, "message": str(exc)}


def main() -> None:
    load_dotenv(_project_root() / ".env")
    payload = json.loads(os.environ.get("AVATAR12_PAYLOAD", "[]"))

    max_workers = min(8, max(1, len(payload)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = list(executor.map(sync_single_lead, payload))

    print(json.dumps(results))


if __name__ == "__main__":
    main()

