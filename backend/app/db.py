from __future__ import annotations

import os
import socket
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from dotenv import load_dotenv


def load_root_env() -> None:
    root_env = Path(__file__).resolve().parents[2] / ".env"
    # override=True so a fresh .env key wins over a stale shell-exported value.
    load_dotenv(root_env, override=True)
    # Also allow backend/.env for local overrides.
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)


def _force_ipv4(url: str) -> str:
    """Pin Supabase host to IPv4 — Vercel often cannot open outbound IPv6."""
    try:
        parsed = urlparse(url)
        if not parsed.hostname or "hostaddr=" in (parsed.query or ""):
            return url
        infos = socket.getaddrinfo(
            parsed.hostname, parsed.port or 5432, socket.AF_INET, socket.SOCK_STREAM
        )
        ipv4 = infos[0][4][0]
        separator = "&" if parsed.query else "?"
        return f"{url}{separator}hostaddr={ipv4}"
    except (socket.gaierror, OSError, IndexError):
        return url


def _ensure_sslmode(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.hostname or parsed.hostname in {"localhost", "127.0.0.1"}:
        return url
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if "sslmode" not in params:
        params["sslmode"] = "require"
    return urlunparse(parsed._replace(query=urlencode(params)))


def supabase_connection_string() -> str:
    load_root_env()
    value = (
        os.getenv("SUPABASE_CONNECTION_STRING")
        or os.getenv("DATABASE_URL")
        or ""
    ).strip()
    if not value:
        raise RuntimeError(
            "SUPABASE_CONNECTION_STRING (or DATABASE_URL) is missing. "
            "Set it in the root .env locally, or in Vercel Environment Variables."
        )
    value = _force_ipv4(value)
    return _ensure_sslmode(value)
