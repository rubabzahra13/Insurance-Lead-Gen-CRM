from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/places", tags=["places"])

AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places"


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

    return {"items": items[:10]}


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
