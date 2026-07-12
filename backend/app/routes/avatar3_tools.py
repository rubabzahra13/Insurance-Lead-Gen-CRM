from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.avatar3_tools import Avatar3APIError, enrich_business_website, search_google_places


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


@router.post("/enrich")
def enrich_avatar3(payload: Avatar3EnrichRequest):
    try:
        return enrich_business_website(payload.website, payload.business_name)
    except Avatar3APIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
