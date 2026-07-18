"""Live SerpAPI / Serper search quota for the Individual Leads search UI.

SerpAPI: GET https://serpapi.com/account.json
Docs fields used: plan_searches_left, searches_per_month, this_month_usage,
total_searches_left, plan_name.

Never returns the API key. Short in-memory cache to avoid hammering the
account endpoint when the UI polls.
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx

SERPAPI_ACCOUNT_URL = "https://serpapi.com/account.json"
CACHE_TTL_S = 30.0
TIMEOUT_S = 12.0

_cache: dict[str, Any] = {"at": 0.0, "payload": None}


def _serp_config() -> dict[str, str] | None:
    serpapi = (os.getenv("SERPAPI_KEY") or os.getenv("SERP_API") or "").strip()
    if serpapi:
        return {"provider": "serpapi", "key": serpapi}
    serper = (os.getenv("SERPER_API_KEY") or "").strip()
    if serper:
        return {"provider": "serper", "key": serper}
    return None


def serp_provider_available() -> bool:
    return _serp_config() is not None


def _int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _from_serpapi_account(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize SerpAPI account.json into a UI-safe quota payload."""
    searches_per_month = _int_or_none(data.get("searches_per_month"))
    plan_left = _int_or_none(data.get("plan_searches_left"))
    total_left = _int_or_none(data.get("total_searches_left"))
    used = _int_or_none(data.get("this_month_usage"))
    extra = _int_or_none(data.get("extra_credits")) or 0
    renewal = _clean_date(data.get("plan_renewal_date"))

    # Prefer plan remaining; fall back to total (plan + extras).
    left = plan_left if plan_left is not None else total_left
    limit = searches_per_month
    if limit is None and left is not None and used is not None:
        limit = left + used
    if limit is None and left is not None:
        limit = left

    return {
        "available": True,
        "provider": "serpapi",
        "plan_name": (data.get("plan_name") or data.get("plan_id") or "").strip() or None,
        "searches_left": left,
        "searches_limit": limit,
        "searches_used": used,
        "extra_credits": extra if extra else None,
        "total_searches_left": total_left,
        "this_hour_searches": _int_or_none(data.get("this_hour_searches")),
        "plan_renewal_date": renewal,
        "label": _format_label(left, limit),
        "exhausted_message": _format_exhausted_message(renewal),
    }


def _clean_date(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    # SerpAPI returns YYYY-MM-DD; keep only the date part if a timestamp sneaks in.
    return raw[:10] if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-" else raw


def _format_exhausted_message(renewal: str | None) -> str:
    if renewal:
        return f"No searches left for this month. Plan resets on {_friendly_date(renewal)}."
    return "No searches left for this month. Plan resets next month."


def _friendly_date(iso_date: str) -> str:
    """Format YYYY-MM-DD as 'Aug 16, 2026' without depending on locale."""
    months = (
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    )
    try:
        year_s, month_s, day_s = iso_date.split("-", 2)
        month = int(month_s)
        day = int(day_s)
        if 1 <= month <= 12 and 1 <= day <= 31:
            return f"{months[month - 1]} {day}, {int(year_s)}"
    except (TypeError, ValueError):
        pass
    return iso_date


def _format_label(left: int | None, limit: int | None) -> str | None:
    if left is None:
        return None
    if limit is not None and limit >= 0:
        return f"{left}/{limit} searches left"
    return f"{left} searches left"


def _from_serper() -> dict[str, Any]:
    # Serper does not expose a public account/usage JSON comparable to SerpAPI.
    return {
        "available": True,
        "provider": "serper",
        "plan_name": None,
        "searches_left": None,
        "searches_limit": None,
        "searches_used": None,
        "extra_credits": None,
        "total_searches_left": None,
        "this_hour_searches": None,
        "plan_renewal_date": None,
        "label": "Serper search active",
        "exhausted_message": None,
        "note": "Live remaining counts require SerpAPI (serpapi.com).",
    }


def fetch_serp_quota(*, force: bool = False) -> dict[str, Any]:
    now = time.monotonic()
    if (
        not force
        and _cache["payload"] is not None
        and (now - float(_cache["at"])) < CACHE_TTL_S
    ):
        return dict(_cache["payload"])

    config = _serp_config()
    if not config:
        payload = {
            "available": False,
            "provider": None,
            "plan_name": None,
            "searches_left": None,
            "searches_limit": None,
            "searches_used": None,
            "extra_credits": None,
            "total_searches_left": None,
            "this_hour_searches": None,
            "plan_renewal_date": None,
            "label": None,
            "exhausted_message": None,
            "error": "SERPAPI_KEY (or SERPER_API_KEY) is not configured",
        }
        _cache["at"] = now
        _cache["payload"] = payload
        return dict(payload)

    if config["provider"] == "serper":
        payload = _from_serper()
        _cache["at"] = now
        _cache["payload"] = payload
        return dict(payload)

    try:
        with httpx.Client(timeout=TIMEOUT_S) as client:
            res = client.get(SERPAPI_ACCOUNT_URL, params={"api_key": config["key"]})
        if res.status_code in (401, 403):
            payload = {
                "available": False,
                "provider": "serpapi",
                "label": None,
                "error": "SerpAPI rejected the API key",
                "searches_left": None,
                "searches_limit": None,
                "searches_used": None,
            }
        elif res.status_code >= 400:
            payload = {
                "available": False,
                "provider": "serpapi",
                "label": None,
                "error": f"SerpAPI account error {res.status_code}",
                "searches_left": None,
                "searches_limit": None,
                "searches_used": None,
            }
        else:
            data = res.json() if res.content else {}
            if not isinstance(data, dict):
                raise ValueError("Unexpected SerpAPI account payload")
            if data.get("error"):
                payload = {
                    "available": False,
                    "provider": "serpapi",
                    "label": None,
                    "error": str(data.get("error")),
                    "searches_left": None,
                    "searches_limit": None,
                    "searches_used": None,
                }
            else:
                payload = _from_serpapi_account(data)
    except Exception as exc:  # noqa: BLE001 — surface soft failure to UI
        payload = {
            "available": False,
            "provider": "serpapi",
            "label": None,
            "error": str(exc)[:180],
            "searches_left": None,
            "searches_limit": None,
            "searches_used": None,
        }

    _cache["at"] = now
    _cache["payload"] = payload
    return dict(payload)


def invalidate_serp_quota_cache() -> None:
    _cache["at"] = 0.0
    _cache["payload"] = None
