"""Clean company/location values written before the extraction fix.

Rows sourced by the old SERP structurer hold job titles in Company ("Aspiring
Financial Advisor") and job-status or school fragments in Location ("Student,
Class", "University, Northridge", a bare ZIP). Searches now reject these, but the
rows already in the table still show them.

Validation is delegated to src/lead-fields.js through a small Node CLI so there
is exactly one definition of what a company or a place looks like.

Usage (from backend/):
    venv/bin/python -m app.scripts.backfill_lead_fields            # dry run
    venv/bin/python -m app.scripts.backfill_lead_fields --apply    # write
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.models.avatar12 import AvatarLead
from app.session import SessionLocal


_BACKEND_DIR = Path(__file__).resolve().parents[2]
_CLI = _BACKEND_DIR / "src" / "sanitize-lead-fields-cli.js"

# The sync appends this to values it could not verify. Detach it before
# validating so the note itself is not judged, then restore it.
WEAK_NOTE = " [found via other sources — not strong evidence]"


def _split_note(value: Any) -> tuple[Any, bool]:
    if isinstance(value, str) and value.endswith(WEAK_NOTE):
        return value[: -len(WEAK_NOTE)], True
    return value, False


def _sanitize(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Run the shared JS validators over the rows and index results by id."""
    result = subprocess.run(
        ["node", str(_CLI)],
        input=json.dumps(rows),
        capture_output=True,
        text=True,
        cwd=str(_BACKEND_DIR),
        check=True,
    )
    return {row["id"]: row for row in json.loads(result.stdout or "[]")}


def main() -> int:
    apply_changes = "--apply" in sys.argv

    with SessionLocal() as db:
        leads = db.scalars(select(AvatarLead)).all()

        payload: list[dict[str, Any]] = []
        notes: dict[str, tuple[bool, bool]] = {}
        for lead in leads:
            company, company_weak = _split_note(lead.company)
            location, location_weak = _split_note(lead.location)
            payload.append(
                {"id": str(lead.id), "company": company, "location": location}
            )
            notes[str(lead.id)] = (company_weak, location_weak)

        cleaned = _sanitize(payload)

        changes: list[tuple[AvatarLead, str, Any, Any]] = []
        for lead in leads:
            key = str(lead.id)
            new = cleaned.get(key)
            if not new:
                continue
            company_weak, location_weak = notes[key]

            new_company = new["company"]
            if new_company and company_weak:
                new_company = new_company + WEAK_NOTE
            new_location = new["location"]
            if new_location and location_weak:
                new_location = new_location + WEAK_NOTE

            if new_company != lead.company:
                changes.append((lead, "company", lead.company, new_company))
            if new_location != lead.location:
                changes.append((lead, "location", lead.location, new_location))

        print(f"leads scanned : {len(leads)}")
        print(f"fields to fix : {len(changes)}")
        print()
        for lead, field, old, new in changes:
            print(f"  {str(lead.name)[:22]:22} {field:8} {str(old)[:44]!r} -> {new!r}")

        if not apply_changes:
            print()
            print("dry run — nothing written. Re-run with --apply to save.")
            return 0

        for lead, field, _old, new in changes:
            setattr(lead, field, new)
        db.commit()
        print()
        print(f"applied {len(changes)} field updates.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
