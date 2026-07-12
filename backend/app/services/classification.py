from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
import logging
from typing import Any, TypedDict

from app.services.llm.client import LLMResponseError, generate_structured


logger = logging.getLogger(__name__)


class SearchClassificationState(TypedDict, total=False):
    query: str
    candidate: dict[str, Any]
    avatar_type: str
    confidence: float
    reasoning: str


def _build_system_prompt() -> str:
    return (
        "You classify an insurance CRM search query into one of three workflows.\n"
        "Avatar 1: open-to-work individuals with insurance or sales experience.\n"
        "Avatar 2: upgraders at smaller insurance firms.\n"
        "Avatar 3: founder-led or small business targets.\n"
        "Return only JSON."
    )


def _schema() -> dict[str, Any]:
    return {
        "avatar_type": "string",
        "confidence": "number",
        "reasoning": "string",
    }


def _heuristic_classification(query: str) -> dict[str, Any]:
    lower = query.lower()
    business_tokens = ["company", "companies", "business", "founder", "founders", "agency", "firms", "roofing", "shop"]
    upgrade_tokens = ["upgrade", "bigger team", "larger team", "small firm", "smaller firm", "agency", "carrier"]
    open_to_work_tokens = ["open to work", "open-to-work", "job seeker", "looking for work", "sales pro", "sales professional"]

    if any(token in lower for token in business_tokens):
        return {
            "avatar_type": "avatar3",
            "confidence": 0.82,
            "reasoning": "The query looks business-focused rather than individual-focused.",
        }
    if any(token in lower for token in open_to_work_tokens):
        return {
            "avatar_type": "avatar1",
            "confidence": 0.8,
            "reasoning": "The query references open-to-work or individual candidate intent.",
        }
    if any(token in lower for token in upgrade_tokens):
        return {
            "avatar_type": "avatar2",
            "confidence": 0.76,
            "reasoning": "The query suggests an individual at a smaller insurance firm seeking a bigger platform.",
        }
    return {
        "avatar_type": "avatar2",
        "confidence": 0.55,
        "reasoning": "The query is ambiguous, so it defaults to the recruitment workflow.",
    }


def classify_search_query(
    query: str,
    *,
    timeout_seconds: int = 15,
    client_call=generate_structured,
) -> dict[str, Any]:
    trimmed_query = str(query or "").strip()
    if not trimmed_query:
        raise ValueError("query is required")

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            client_call,
            system_prompt=_build_system_prompt(),
            user_prompt=(
                f"Search query: {trimmed_query}\n"
                "Classify the query as avatar1, avatar2, or avatar3.\n"
                "Avatar 3 means business/founder/company discovery. Avatar 1 and 2 mean individual recruiting searches.\n"
                "Return avatar_type, confidence from 0 to 1, and reasoning."
            ),
            response_schema=_schema(),
        )
        try:
            result = future.result(timeout=timeout_seconds)
        except FuturesTimeoutError:
            logger.warning("Search classifier timed out after %s seconds.", timeout_seconds)
            return {**_heuristic_classification(trimmed_query), "query": trimmed_query}
        except Exception as exc:
            logger.warning("Search classifier failed: %s", exc)
            return {**_heuristic_classification(trimmed_query), "query": trimmed_query}

    candidate = result if isinstance(result, dict) else {}
    avatar_type = str(candidate.get("avatar_type") or "").strip().lower()
    confidence = candidate.get("confidence")
    reasoning = str(candidate.get("reasoning") or "").strip()

    if avatar_type not in {"avatar1", "avatar2", "avatar3"}:
        fallback = _heuristic_classification(trimmed_query)
        return {**fallback, "query": trimmed_query}

    try:
        confidence_value = float(confidence)
    except (TypeError, ValueError):
        confidence_value = 0.5

    return {
        "query": trimmed_query,
        "avatar_type": avatar_type,
        "confidence": max(0.0, min(1.0, confidence_value)),
        "reasoning": reasoning or "Claude classified the search query.",
    }
