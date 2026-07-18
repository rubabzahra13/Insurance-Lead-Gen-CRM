from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from app.services.avatar3_tools import (
    Avatar3APIError,
    enrich_business_website,
    fetch_business_photo,
    fetch_place_photo_bytes,
    is_valid_place_photo_name,
    search_google_places,
)


router = APIRouter(prefix="/api/avatar3", tags=["avatar3"])


class Avatar3SearchRequest(BaseModel):
    query: str
    location_bias: str | None = None


class Avatar3EnrichRequest(BaseModel):
    website: str | None = None
    business_name: str | None = None


@router.post("/search")
def search_avatar3(payload: Avatar3SearchRequest):
    try:
        preview = search_google_places(payload.query, payload.location_bias)
        return {"preview": preview}
    except Avatar3APIError as exc:
        if exc.retry_after:
            headers = {"Retry-After": str(exc.retry_after)}
        else:
            headers = None
        raise HTTPException(status_code=exc.status_code, detail=str(exc), headers=headers)


@router.get("/place-photo")
def get_place_photo(
    name: str = Query(..., min_length=8),
    max_width_px: int = Query(400, ge=64, le=800),
):
    if not is_valid_place_photo_name(name):
        raise HTTPException(status_code=400, detail="Invalid photo name")
    img_bytes, content_type = fetch_place_photo_bytes(name, max_width_px=max_width_px)
    if not img_bytes:
        raise HTTPException(status_code=404, detail="Photo not found")
    return Response(
        content=img_bytes,
        media_type=content_type or "image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/places/{place_id}/photo")
def get_place_photo_by_place_id(place_id: str):
    """Fallback photo fetch by place id when search cache lacks photo_name."""
    import base64

    trimmed = str(place_id or "").strip()
    if not trimmed or trimmed.startswith("dev-mock-place"):
        raise HTTPException(status_code=404, detail="Photo not found")
    img_b64, content_type = fetch_business_photo(trimmed)
    if not img_b64:
        raise HTTPException(status_code=404, detail="Photo not found")
    try:
        img_bytes = base64.b64decode(img_b64)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Invalid image encoding") from exc
    return Response(
        content=img_bytes,
        media_type=content_type or "image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/enrich")
def enrich_avatar3(payload: Avatar3EnrichRequest):
    try:
        return enrich_business_website(payload.website, payload.business_name)
    except Avatar3APIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
