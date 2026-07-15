from __future__ import annotations

import json
import os
import re
from html import unescape
from urllib.parse import urljoin

import httpx

from app.db import load_root_env
from app.services.llm.client import generate_structured


GOOGLE_PLACES_TEXT_SEARCH = "https://places.googleapis.com/v1/places:searchText"
DEFAULT_TIMEOUT = 8.0


class Avatar3APIError(RuntimeError):
    def __init__(self, message: str, status_code: int = 500, retry_after: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after


def map_google_place_to_business_lead(place: dict, details: dict | None = None) -> dict:
    details = details or {}
    current_open = place.get("currentOpeningHours") or {}
    return {
        "business_name": (place.get("displayName") or {}).get("text") or place.get("name") or "",
        "address": place.get("formattedAddress") or place.get("vicinity") or None,
        "website": place.get("websiteUri") or details.get("website") or None,
        "google_place_id": place.get("id") or place.get("place_id") or None,
        "rating": place.get("rating") or None,
        "open_status": (
            place.get("businessStatus")
            or place.get("business_status")
            or (("OPEN" if current_open.get("openNow") is True else "CLOSED_TEMPORARILY") if "openNow" in current_open else None)
        ),
        "phone": (
            place.get("nationalPhoneNumber")
            or place.get("internationalPhoneNumber")
            or details.get("formatted_phone_number")
            or details.get("international_phone_number")
            or None
        ),
    }


def _places_api_key() -> str:
    load_root_env()
    return (
        os.getenv("PLACES_API_KEY")
        or os.getenv("GOOGLE_PLACES_API_KEY")
        or ""
    ).strip()


def _dev_mock_places(query: str) -> list[dict]:
    location = query.split(" in ")[-1].strip() if " in " in query.lower() else "your area"
    return [
        {
            "business_name": "Summit Roofing & Restoration",
            "address": f"1200 Commerce St, {location}",
            "website": "https://example.com/summit-roofing",
            "google_place_id": "dev-mock-place-1",
            "rating": 4.6,
            "open_status": "OPEN",
            "phone": "+1-555-0101",
        },
        {
            "business_name": "Northline Contractors",
            "address": f"88 Market Ave, {location}",
            "website": "https://example.com/northline",
            "google_place_id": "dev-mock-place-2",
            "rating": 4.3,
            "open_status": "OPEN",
            "phone": "+1-555-0102",
        },
    ]


def search_google_places(query: str, location_bias: str | None = None, api_key: str | None = None) -> list[dict]:
    trimmed_query = str(query or "").strip()
    trimmed_key = str(api_key or _places_api_key()).strip()
    if not trimmed_query:
        raise Avatar3APIError("query is required", status_code=400)
    if not trimmed_key:
        if os.getenv("NODE_ENV", "").strip().lower() == "development":
            return _dev_mock_places(trimmed_query)
        raise Avatar3APIError(
            "PLACES_API_KEY is missing. Add it to the root .env file to enable Google Places search.",
            status_code=503,
        )

    body = {"textQuery": f"{trimmed_query} {str(location_bias).strip()}".strip() if location_bias else trimmed_query}
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": trimmed_key,
        "X-Goog-FieldMask": (
            "places.displayName,places.formattedAddress,places.id,places.rating,places.businessStatus,"
            "places.currentOpeningHours,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber"
        ),
    }

    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        response = client.post(GOOGLE_PLACES_TEXT_SEARCH, json=body, headers=headers)

    if response.status_code == 429:
        raise Avatar3APIError("Google Places rate limit reached", status_code=429, retry_after=response.headers.get("retry-after"))

    try:
        data = response.json()
    except ValueError:
        data = {}

    if not response.is_success:
        raise Avatar3APIError(data.get("error_message") or "Google Places request failed", status_code=502)
    if data.get("error"):
        raise Avatar3APIError(data["error"].get("message") or "Google Places request failed", status_code=502)

    return [map_google_place_to_business_lead(place) for place in data.get("places", []) or []]


def _strip_html(html: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", str(html or ""), flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _extract_candidate_contact_links(html: str, base_url: str) -> list[str]:
    links: list[str] = []
    for href, inner in re.findall(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>', html, flags=re.I):
        href = href.strip()
        text = _strip_html(inner)
        if not href:
            continue
        haystack = f"{href} {text}".lower()
        if "contact" in haystack or "about" in haystack:
            try:
                links.append(urljoin(base_url, href))
            except Exception:
                continue
    return list(dict.fromkeys(links))[:2]


def _extract_signals(text: str) -> dict[str, list[str]]:
    emails = sorted({match.strip() for match in re.findall(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, flags=re.I)})
    linkedin_urls = sorted({match.strip() for match in re.findall(r"https?://(?:www\.)?linkedin\.com/[^\s)]+", text, flags=re.I)})
    return {"emails": emails, "linkedin_urls": linkedin_urls}


def _fetch_html(url: str) -> dict[str, str | int | bool]:
    try:
        response = httpx.get(
            url,
            timeout=DEFAULT_TIMEOUT,
            headers={
                "user-agent": "Mozilla/5.0 (compatible; LeadGenBot/1.0)",
                "accept": "text/html,application/xhtml+xml",
            },
        )
    except httpx.TimeoutException:
        return {"ok": False, "status": 408, "html": "", "content_type": ""}
    except Exception:
        return {"ok": False, "status": 500, "html": "", "content_type": ""}

    content_type = response.headers.get("content-type", "")
    if not response.is_success:
        return {"ok": False, "status": response.status_code, "html": "", "content_type": content_type}
    if "text/html" not in content_type:
        return {"ok": False, "status": 415, "html": "", "content_type": content_type}
    return {"ok": True, "status": response.status_code, "html": response.text, "content_type": content_type}


def enrich_business_website(website: str | None, business_name: str | None = None) -> dict:
    null_result = {
        "owner_name": None,
        "manager_name": None,
        "contact_email": None,
        "contact_linkedin": None,
        "source_text": "",
    }
    homepage = str(website or "").strip()
    if not homepage:
        return null_result

    home_result = _fetch_html(homepage)
    if not home_result["ok"]:
        return null_result

    about_links = _extract_candidate_contact_links(str(home_result["html"]), homepage)
    pages = [{"url": homepage, "html": str(home_result["html"])}]
    for link in about_links:
        if len(pages) >= 2:
            break
        if link != homepage:
            page = _fetch_html(link)
            if page["ok"]:
                pages.append({"url": link, "html": str(page["html"])})

    source_text = "\n\n".join(f"URL: {page['url']}\n{_strip_html(page['html'])}" for page in pages)
    signals = _extract_signals(source_text)
    response_schema = {
        "owner_name": ["string", "null"],
        "manager_name": ["string", "null"],
        "contact_email": ["string", "null"],
        "contact_linkedin": ["string", "null"],
    }
    system_prompt = (
        "You extract contact details from business website text. Return only valid JSON. "
        "Use null for any field you cannot confirm from the provided source text. Never fabricate."
    )
    user_prompt = (
        f"Business name: {business_name or ''}\n"
        f"Detected emails: {', '.join(signals['emails']) or 'none'}\n"
        f"Detected LinkedIn URLs: {', '.join(signals['linkedin_urls']) or 'none'}\n"
        f"Website text:\n{source_text}\n\n"
        "Extract owner_name, manager_name, contact_email, contact_linkedin. If unknown, use null."
    )

    try:
        result = generate_structured(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            response_schema=response_schema,
        )
    except Exception:
        return null_result | {"source_text": source_text}

    return {
        "owner_name": result.get("owner_name"),
        "manager_name": result.get("manager_name"),
        "contact_email": result.get("contact_email"),
        "contact_linkedin": result.get("contact_linkedin"),
        "source_text": source_text,
    }


def fetch_business_photo(place_id: str) -> tuple[str | None, str | None]:
    """
    Fetches the first photo of the given Google Place ID using the Google Places API (New).
    Returns (image_base64_string, content_type).
    """
    import base64
    import logging
    logger = logging.getLogger(__name__)

    api_key = _places_api_key()
    if not api_key:
        logger.warning("PLACES_API_KEY is missing; skipping photo fetching.")
        return None, None

    if not place_id or place_id.startswith("dev-mock-place"):
        logger.info("Mock place ID or empty ID; skipping photo fetching.")
        return None, None

    url = f"https://places.googleapis.com/v1/places/{place_id}"
    headers = {
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "photos"
    }

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code != 200:
                logger.warning("Failed to fetch place details for photo: %s status: %d", place_id, resp.status_code)
                return None, None
            
            place_data = resp.json()
            photos = place_data.get("photos")
            if not photos or not isinstance(photos, list) or len(photos) == 0:
                logger.info("No photos found for place ID: %s", place_id)
                return None, None
            
            photo_name = photos[0].get("name")
            if not photo_name:
                logger.info("First photo has no resource name for place ID: %s", place_id)
                return None, None

            media_url = f"https://places.googleapis.com/v1/{photo_name}/media"
            params = {
                "maxHeightPx": 800,
                "key": api_key
            }
            
            media_resp = client.get(media_url, params=params, follow_redirects=True)
            if media_resp.status_code != 200:
                logger.warning("Failed to fetch photo media for %s status: %d", photo_name, media_resp.status_code)
                return None, None
            
            content_type = media_resp.headers.get("content-type") or "image/jpeg"
            img_bytes = media_resp.content
            img_base64 = base64.b64encode(img_bytes).decode("utf-8")
            return img_base64, content_type

    except Exception as exc:
        logger.exception("Error fetching business photo for place ID %s: %s", place_id, exc)
        return None, None

