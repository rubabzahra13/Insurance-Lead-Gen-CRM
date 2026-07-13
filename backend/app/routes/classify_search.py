from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.classification import classify_search_query


router = APIRouter(prefix="/api", tags=["classification"])


class SearchClassificationRequest(BaseModel):
    query: str


@router.post("/classify-search")
def classify_search(payload: SearchClassificationRequest):
    return classify_search_query(payload.query)
