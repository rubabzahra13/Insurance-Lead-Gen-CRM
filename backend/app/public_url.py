from __future__ import annotations

import os
import re


_LOCAL_LANDING_RE = re.compile(
    r"https?://(?:localhost|127\.0\.0\.1)(?::\d+)?(/landing-page/[^\s]*)",
    re.IGNORECASE,
)


def public_app_base_url() -> str:
    """Resolve the public frontend origin for landing-page links in drafts."""
    value = (
        os.getenv("PUBLIC_APP_URL")
        or os.getenv("FRONTEND_BASE_URL")
        or os.getenv("NEXT_PUBLIC_FRONTEND_URL")
        or os.getenv("VERCEL_PROJECT_PRODUCTION_URL")
        or os.getenv("VERCEL_URL")
        or "http://localhost:3000"
    ).strip().rstrip("/")

    if value and not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    return value


def rewrite_local_landing_urls(text: str | None) -> str:
    """Replace localhost landing links with the configured public app URL."""
    if not text:
        return text or ""
    base = public_app_base_url()
    if "localhost" in base or "127.0.0.1" in base:
        return text
    return _LOCAL_LANDING_RE.sub(lambda match: f"{base}{match.group(1)}", text)
