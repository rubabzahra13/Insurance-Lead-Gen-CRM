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


def sync_single_lead(lead: dict[str, Any]) -> dict[str, Any]:
    with SessionLocal() as db:
        try:
            result = persist_avatar12_lead(
                db=db,
                avatar_type=AvatarType(lead["avatar_type"]),
                name=lead["name"],
                headline=lead.get("headline") or lead.get("title"),
                role=lead.get("role") or lead.get("title"),
                company=lead.get("company"),
                past_experience=lead.get("past_experience") or lead.get("snippet") or lead.get("evidence"),
                location=lead.get("location"),
                linkedin_url=lead.get("link"),
                search_prompt=lead.get("searchPrompt"),
                source_snapshot=json.dumps(lead, default=str),
                source_query=lead.get("searchPrompt"),
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

