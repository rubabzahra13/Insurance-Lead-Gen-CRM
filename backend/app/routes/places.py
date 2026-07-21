from __future__ import annotations

import os
import re
import unicodedata
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/places", tags=["places"])

AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places"

_ADMIN_FLUFF_RE = re.compile(
    r"\b(capital territory|metropolitan area|metro area|greater|area|region|province|district|territory|city of)\b",
    re.I,
)


def _places_key() -> str:
    return (
        os.getenv("PLACES_API_KEY")
        or os.getenv("GOOGLE_PLACES_API_KEY")
        or ""
    ).strip()


def _is_geo_suggestion(types: list[str] | None) -> bool:
    if not types:
        return True
    geo = {
        "locality",
        "sublocality",
        "postal_town",
        "administrative_area_level_1",
        "administrative_area_level_2",
        "country",
        "geocode",
        "political",
    }
    return any(t in geo for t in types)


def _is_metro_or_county(types: list[str] | None) -> bool:
    type_set = set(types or [])
    return "administrative_area_level_2" in type_set


def _normalize_place_text(value: str) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]+", " ", text)
    text = _ADMIN_FLUFF_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _country_from_secondary(secondary: str) -> str:
    parts = [part.strip() for part in (secondary or "").split(",") if part.strip()]
    return _normalize_place_text(parts[-1]) if parts else ""


def _type_priority(types: list[str] | None) -> int:
    """Lower is better: city → metro/county → state → country."""
    type_set = set(types or [])
    if "locality" in type_set or "postal_town" in type_set:
        return 0
    if "administrative_area_level_2" in type_set:
        return 1
    if "administrative_area_level_1" in type_set:
        return 2
    if "country" in type_set:
        return 3
    return 4


def _query_mentions_place_context(query: str, secondary: str) -> bool:
    """True when the user typed enough to pick a specific state/region."""
    q = _normalize_place_text(query)
    if not q:
        return False
    for part in (secondary or "").split(","):
        token = _normalize_place_text(part.strip())
        if len(token) >= 2 and token in q:
            return True
    return False


def _is_city(types: list[str] | None) -> bool:
    type_set = set(types or [])
    return "locality" in type_set or "postal_town" in type_set


def _is_admin_region(types: list[str] | None) -> bool:
    type_set = set(types or [])
    if _is_city(types) or "country" in type_set:
        return False
    return "administrative_area_level_1" in type_set or "administrative_area_level_2" in type_set


def _secondary_is_country_only(secondary: str) -> bool:
    parts = [part.strip() for part in (secondary or "").split(",") if part.strip()]
    return len(parts) <= 1


def _is_simple_state_city_secondary(secondary: str) -> bool:
    """True for rows like 'TX, USA' — many US towns share a name."""
    parts = [p.strip() for p in (secondary or "").split(",") if p.strip()]
    if len(parts) != 2:
        return False
    state, country = parts[0], _normalize_place_text(parts[1])
    return len(state) <= 3 and country in {"usa", "us", "united states"}


def _collapse_obscure_duplicate_cities(
    items: list[dict[str, Any]],
    query: str,
    *,
    max_same_name_cities: int = 1,
) -> list[dict[str, Any]]:
    """
    For bare city searches (e.g. "Dallas"), keep Google's top-ranked city match
    and drop obscure same-name US towns (Dallas GA, Dallas OR, …).
    Metro/county/state rows and distinct places (different region text) are kept.
    """
    if not items:
        return items

    kept: list[dict[str, Any]] = []
    simple_us_city_counts: dict[str, int] = {}

    for item in items:
        types = item.get("types") or []
        if not _is_city(types):
            kept.append(item)
            continue

        secondary = str(item.get("secondaryText") or "")
        if _query_mentions_place_context(query, secondary):
            kept.append(item)
            continue

        if not _is_simple_state_city_secondary(secondary):
            kept.append(item)
            continue

        main = _normalize_place_text(str(item.get("mainText") or item.get("label") or ""))
        seen = simple_us_city_counts.get(main, 0)
        if seen >= max_same_name_cities:
            continue
        simple_us_city_counts[main] = seen + 1
        kept.append(item)

    return kept


def _dedupe_place_suggestions(
    items: list[dict[str, Any]],
    query: str = "",
) -> list[dict[str, Any]]:
    """Prefer cities, drop redundant admin regions, collapse bare vs country-qualified labels."""

    indexed = [{**item, "_sourceIndex": idx} for idx, item in enumerate(items)]

    def sort_key(item: dict[str, Any]) -> tuple:
        return (
            _type_priority(item.get("types")),
            0 if str(item.get("secondaryText") or "").strip() else 1,
            len(str(item.get("label") or "")),
            item.get("_sourceIndex", 999),
        )

    ranked = sorted(indexed, key=sort_key)
    chosen: list[dict[str, Any]] = []

    for item in ranked:
        main = _normalize_place_text(str(item.get("mainText") or item.get("label") or ""))
        if not main:
            continue
        secondary = _normalize_place_text(str(item.get("secondaryText") or ""))
        country = _country_from_secondary(str(item.get("secondaryText") or ""))
        types = item.get("types") or []

        # Drop "Islamabad Capital Territory" when primary city "Islamabad, Pakistan" is kept.
        # Do not drop "California" state just because "California, MO" exists.
        if _is_admin_region(types):
            redundant = False
            for kept in chosen:
                if not _is_city(kept.get("types")):
                    continue
                kept_main = _normalize_place_text(str(kept.get("mainText") or kept.get("label") or ""))
                kept_secondary_raw = str(kept.get("secondaryText") or "")
                kept_country = _country_from_secondary(kept_secondary_raw)
                if not kept_main or not _secondary_is_country_only(kept_secondary_raw):
                    continue
                same_country = not country or not kept_country or country == kept_country
                overlapping_name = (
                    main == kept_main
                    or main.startswith(f"{kept_main} ")
                    or kept_main.startswith(f"{main} ")
                )
                if same_country and overlapping_name:
                    redundant = True
                    break
            if redundant:
                continue

        # Collapse same-type duplicates (city vs city, state vs state).
        duplicate = False
        for kept in chosen:
            if _type_priority(types) != _type_priority(kept.get("types")):
                continue
            kept_main = _normalize_place_text(str(kept.get("mainText") or kept.get("label") or ""))
            kept_secondary = _normalize_place_text(str(kept.get("secondaryText") or ""))
            if main != kept_main:
                continue
            # Bare "Islamabad" after "Islamabad, Pakistan"
            if not secondary and kept_secondary:
                duplicate = True
                break
            if secondary and kept_secondary and secondary == kept_secondary:
                duplicate = True
                break
            if not secondary and not kept_secondary:
                duplicate = True
                break
            # Two country-only city labels for the same name ("Islamabad, Pakistan")
            if (
                _is_city(types)
                and _is_city(kept.get("types"))
                and secondary
                and kept_secondary
                and secondary == country
                and kept_secondary == _country_from_secondary(str(kept.get("secondaryText") or ""))
                and country
                and country == _country_from_secondary(str(kept.get("secondaryText") or ""))
            ):
                duplicate = True
                break
        if duplicate:
            continue

        chosen.append(item)

    chosen = _collapse_obscure_duplicate_cities(chosen, query)
    chosen.sort(
        key=lambda item: (
            _type_priority(item.get("types")),
            item.get("_sourceIndex", 999),
        )
    )
    return [{k: v for k, v in item.items() if k != "_sourceIndex"} for item in chosen]


@router.get("/autocomplete")
async def places_autocomplete(q: str = Query(..., min_length=1, max_length=120)):
    """Searchable world cities / regions / countries (LinkedIn-style)."""
    key = _places_key()
    if not key:
        raise HTTPException(
            status_code=502,
            detail="PLACES_API_KEY is missing. Add it to the root .env file.",
        )

    text = q.strip()
    if len(text) < 2:
        return {"items": []}

    body: dict[str, Any] = {
        "input": text,
        "includedPrimaryTypes": [
            "locality",
            "administrative_area_level_2",
            "administrative_area_level_1",
            "country",
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(
                AUTOCOMPLETE_URL,
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": key,
                },
                json=body,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Places request failed: {exc}") from exc

    if res.status_code == 429:
        raise HTTPException(status_code=429, detail="Google Places rate limit reached")

    data = res.json() if res.content else {}
    if not res.is_success:
        message = (
            (data.get("error") or {}).get("message")
            if isinstance(data.get("error"), dict)
            else data.get("error_message")
        ) or "Google Places autocomplete failed"
        raise HTTPException(status_code=502, detail=message)

    items = []
    for row in data.get("suggestions") or []:
        pred = row.get("placePrediction") or {}
        place_id = pred.get("placeId") or ""
        structured = pred.get("structuredFormat") or {}
        main = ((structured.get("mainText") or {}).get("text")) or ""
        secondary = ((structured.get("secondaryText") or {}).get("text")) or ""
        text_obj = pred.get("text") or {}
        full = text_obj.get("text") or (f"{main}, {secondary}".strip(", ") if main else "")
        types = pred.get("types") or []
        if not place_id or not full:
            continue
        if not _is_geo_suggestion(types):
            continue
        items.append(
            {
                "placeId": place_id,
                "label": full,
                "mainText": main or full,
                "secondaryText": secondary,
                "types": types,
            }
        )

    return {"items": _dedupe_place_suggestions(items, text)[:8]}


@router.get("/details")
async def places_details(place_id: str = Query(..., alias="placeId", min_length=3)):
    """Resolve a selected place into city/country for SerpAPI geo bias."""
    key = _places_key()
    if not key:
        raise HTTPException(status_code=502, detail="PLACES_API_KEY is missing.")

    url = f"{PLACE_DETAILS_URL}/{place_id}"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(
                url,
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": key,
                    "X-Goog-FieldMask": "id,displayName,formattedAddress,addressComponents,types",
                },
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Places details failed: {exc}") from exc

    data = res.json() if res.content else {}
    if not res.is_success:
        message = (
            (data.get("error") or {}).get("message")
            if isinstance(data.get("error"), dict)
            else "Google Places details failed"
        )
        raise HTTPException(status_code=502, detail=message)

    components = data.get("addressComponents") or []
    city = None
    region = None
    country = None
    country_code = None
    for comp in components:
        types = comp.get("types") or []
        name = comp.get("longText") or comp.get("shortText") or ""
        short = comp.get("shortText") or ""
        if "locality" in types or "postal_town" in types:
            city = name
        elif "administrative_area_level_1" in types:
            region = name
        elif "country" in types:
            country = name
            country_code = short.lower() if short else None

    types = data.get("types") or []
    scope = "country" if "country" in types and not city else "city"
    if "administrative_area_level_1" in types and not city:
        scope = "country"

    display = (data.get("displayName") or {}).get("text") or ""
    formatted = data.get("formattedAddress") or display
    label = display or formatted

    return {
        "placeId": data.get("id") or place_id,
        "label": label,
        "formattedAddress": formatted,
        "city": city,
        "region": region,
        "country": country,
        "countryCode": country_code,
        "scope": scope,
        "types": types,
    }
